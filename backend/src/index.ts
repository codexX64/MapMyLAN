import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, verifierSecrets } from "./config";
import { prisma } from "./db";
import { csrfProtection } from "./middleware/csrf";
import authRoute from "./routes/auth";
import devicesRoute from "./routes/devices";
import vlansRoute from "./routes/vlans";
import sshRoute from "./routes/ssh";
import topologyRoute from "./routes/topology";
import hostRoute from "./routes/host";
import systemRoute from "./routes/system";
import commandsRoute from "./routes/commands";
import botCommandsRoute from "./routes/botCommands";
import routerRoute from "./routes/router";
import { dedupeDevices } from "./services/dedupe";
import { attachSocketIO } from "./ws/realtime";
import { startScheduler } from "./workers/scheduler";
import { startTelegramBot } from "./services/notifier";

async function main() {
  const app = express();
  const httpServer = http.createServer(app);

  // Behind a proxy: without this line, every request appears to come from the
  // same address and the attempt limiter goes blind.
  // First of all: without strong secrets, nothing should start.
  verifierSecrets();

  app.set("trust proxy", 1);

  // The content security policy is the main protection against script
  // injection. The interface only loads its own resources and the declared
  // fonts; everything else is refused by the browser.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
  // A "*" origin and sending credentials do not go together: that is the
  // configuration that lets any site act on the user's behalf. When no origin
  // is set, we do not enable credentials and we flag it, rather than silently
  // combining the two.
  const corsWildcard = config.corsOrigin === "*";
  if (corsWildcard) {
    console.warn("[cors] CORS_ORIGIN not set: origin \"*\" without credentials. " +
      "Set CORS_ORIGIN to the exact frontend URL in production.");
  }
  app.use(cors({ origin: config.corsOrigin, credentials: !corsWildcard }));
  app.use(express.json({ limit: "512kb" }));

  // Anti-CSRF protection (double submit) on every request that modifies state
  // and authenticates via cookie. Placed before the routes, after body
  // parsing.
  app.use(csrfProtection);

  // Two separate limiters: login deserves a lower cap than the rest of the
  // API, since it is the one attacked by repetition.
  const authLimiter = rateLimit({
    windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: "Too many attempts. Try again in a minute." },
  });
  const apiLimiter = rateLimit({
    windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false,
  });

  app.get("/api/health", async (_req, res) => {
    try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ok", time: new Date().toISOString() }); }
    catch { res.status(503).json({ status: "degraded" }); }
  });

  app.use("/api/auth", authLimiter, authRoute);
  app.use("/api", apiLimiter);
  app.use("/api/devices", devicesRoute);
  app.use("/api/vlans", vlansRoute);
  app.use("/api/ssh", sshRoute);
  app.use("/api/topology", topologyRoute);
  app.use("/api/host", hostRoute);
  app.use("/api/commands", commandsRoute);
  app.use("/api/bot-commands", botCommandsRoute);
  app.use("/api/router", routerRoute);
  app.use("/api", systemRoute);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[error]", err);
    res.status(500).json({ error: err.message || "Internal error" });
  });

  attachSocketIO(httpServer);
  // A cleanup pass at startup: one IP, one device.
  dedupeDevices().catch(() => {});
  startScheduler();
  startTelegramBot().catch(() => {});

  httpServer.listen(config.port, () => {
    console.log(`╔════════════════════════════════════════════════════╗`);
    console.log(`║  MapMyLAN v2 ready — listening on :${config.port}             ║`);
    console.log(`║  Subnet: ${config.scan.subnet.padEnd(40)}║`);
    console.log(`║  Scan interval: ${String(config.scan.interval).padEnd(34)}s ║`);
    console.log(`╚════════════════════════════════════════════════════╝`);
  });

  const shutdown = async () => {
    console.log("\nShutting down…");
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

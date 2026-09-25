import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, verifierSecrets } from "./config";
import { prisma } from "./db";
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
import netRoute from "./routes/net";
import trafficRoute from "./routes/traffic";
import usersRoute from "./routes/users";
import integrationsRoute from "./routes/integrations";
import logosRoute from "./routes/logos";
import { logEvent } from "./services/logger";
import mfaRoute from "./routes/mfa";
import mailRoute from "./routes/mail";
import assistantRoute from "./routes/assistant";
import { dedupeDevices } from "./services/dedupe";
import { attachSocketIO } from "./ws/realtime";
import { startScheduler } from "./workers/scheduler";
import { startTelegramBot } from "./services/notifier";
import { annoncerPoste } from "./services/poste";
import { csrfProtection } from "./middleware/csrf";

async function main() {
  // Avant toute chose : sans secrets solides, rien ne doit démarrer.
  verifierSecrets();

  // Tables ajoutées après coup, hors migrations. La préparation est aussi
  // paresseuse côté service : ceci n'est qu'un raccourci, et un endroit où
  // l'échec se voit au lieu d'être découvert par une page qui casse.
  try {
    await (await import("./services/mfa")).preparerTables();
  } catch (e: any) {
    console.error("[démarrage] tables du second facteur :", e?.message || e);
  }

  // Extensions déposées dans `extensions/`. L'absence du dossier est le cas
  // ordinaire et ne dit rien ; un fichier refusé, lui, est signalé — sans quoi
  // on chercherait longtemps pourquoi une extension reste muette.
  try {
    const { chargerExtensions, extensions } = await import("./services/extensions");
    chargerExtensions((niveau, message) =>
      void logEvent(niveau === "warn" ? "warn" : "info", "extensions", message));
    const n = extensions.nombre();
    if (n > 0) await logEvent("info", "extensions", `${n} extension(s) chargee(s)`);
  } catch (e: any) {
    console.error("[démarrage] extensions :", e?.message || e);
  }

  // Amorce du jeton d'intégration, si l'installeur en a posé une. Jamais
  // bloquant : une base indisponible à cet instant ne doit pas empêcher le
  // service de démarrer, elle reviendra au redémarrage suivant.
  try {
    const { amorcerJeton, NOM_AMORCE, NOM_AMORCE_COMPTES } =
      await import("./services/integrations");

    const amorces = [
      { valeur: config.integrationSeed, nom: NOM_AMORCE, portee: "service" as const,
        role: "operator", variable: "INTEGRATION_TOKEN_SEED" },
      { valeur: config.adminSeed, nom: NOM_AMORCE_COMPTES, portee: "accounts" as const,
        role: "operator", variable: "ADMIN_TOKEN_SEED" },
    ];

    for (const a of amorces) {
      const r = await amorcerJeton(a.valeur, { nom: a.nom, portee: a.portee, role: a.role });
      if (r.fait === "cree" || r.fait === "mis-a-jour") {
        await logEvent("info", "integrations",
          `Jeton d'integration « ${a.nom} » ${r.fait === "cree" ? "cree" : "mis a jour"} depuis l'environnement`);
      } else if (r.fait === "ignore" && r.raison === "prefixe") {
        console.warn(
          `[démarrage] ${a.variable} ignorée : la valeur doit commencer ` +
          "par « hub_ » ou « mml_ » pour être reconnue à l'authentification.");
      }
    }
  } catch (e: any) {
    console.error("[démarrage] amorce du jeton d'intégration :", e?.message || e);
  }

  const app = express();
  const httpServer = http.createServer(app);

  // Derrière nginx puis Cloudflare : sans cela, Express attribue toutes les
  // requêtes à la même adresse et le limiteur de tentatives devient aveugle —
  // dix essais par minute partagés par tout le monde au lieu d'un par client.
  app.set("trust proxy", 1);
  // La politique de contenu est la principale protection contre l'injection de
  // script. L'interface ne charge que ses propres ressources et les polices
  // déclarées ; tout le reste est refusé par le navigateur.
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
  // Origines croisees.
  //
  // -- Correctif de securite ------------------------------------------------
  // La valeur par defaut de CORS_ORIGIN est « * », et elle etait associee a
  // credentials: true. Les navigateurs refusent cette combinaison, donc
  // l'effet pratique etait nul -- mais c'est un piege pose : le jour ou
  // quelqu'un remplace l'etoile par une liste trop large, les identifiants
  // partent avec.
  //
  // Le deploiement normal sert l'interface et l'API sur la meme origine : il
  // n'a besoin d'aucun CORS. On ne laisse donc passer les identifiants que
  // lorsqu'une origine est nommee explicitement.
  const origineNommee = config.corsOrigin && config.corsOrigin !== "*";
  if (!origineNommee) {
    console.warn(
      "[cors] CORS_ORIGIN vaut « * » : les identifiants ne traverseront pas les " +
      "origines. Nomme l'origine si l'interface est servie depuis un autre domaine.",
    );
  }
  app.use(cors({ origin: config.corsOrigin, credentials: !!origineNommee }));
  app.use(express.json({ limit: "5mb" }));

  // Anti-CSRF par double soumission, sur toute methode qui modifie l'etat ET
  // s'authentifie par cookie. Posee apres l'analyse du corps, avant les routes.
  //
  // Elle ne s'applique pas a un client qui envoie son jeton dans l'en-tete
  // Authorization : un site tiers ne peut pas poser d'en-tete personnalise sans
  // preflight, ce chemin n'est donc pas forgeable. Le controle est la pour le
  // chemin navigateur, ou le cookie part tout seul.
  app.use(csrfProtection);

  const authLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true });

  app.get("/api/health", async (_req, res) => {
    try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ok", time: new Date().toISOString() }); }
    catch { res.status(503).json({ status: "degraded" }); }
  });

  app.use("/api/auth", authLimiter, authRoute);
  app.use("/api/devices", devicesRoute);
  app.use("/api/vlans", vlansRoute);
  app.use("/api/ssh", sshRoute);
  app.use("/api/topology", topologyRoute);
  app.use("/api/host", hostRoute);
  app.use("/api/commands", commandsRoute);
  app.use("/api/bot-commands", botCommandsRoute);
  app.use("/api/router", routerRoute);
  app.use("/api/net", netRoute);
  app.use("/api/traffic", trafficRoute);
  app.use("/api/users", usersRoute);
  app.use("/api/integrations", integrationsRoute);
  app.use("/api/logos", logosRoute);
  app.use("/api/mfa", mfaRoute);
  app.use("/api/mail", mailRoute);
  app.use("/api/assistant", assistantRoute);
  app.use("/api", systemRoute);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[error]", err);
    res.status(500).json({ error: err.message || "Internal error" });
  });

  attachSocketIO(httpServer);
  // Un passage de nettoyage au démarrage : une IP, un appareil.
  dedupeDevices().catch(() => {});
  startScheduler();
  startTelegramBot().catch(() => {});
  annoncerPoste();

  // Adresse d'ecoute.
  //
  // -- Correctif de securite, en deux temps ---------------------------------
  // Le backend tourne en network_mode: host -- necessaire pour qu'arp-scan et
  // nmap voient le vrai reseau -- et ecoutait donc sur toutes les interfaces.
  // Tout VLAN capable de router jusqu'a la machine atteignait l'API.
  //
  // Le refermer d'un coup casserait le reverse proxy, qui vit dans un autre
  // espace reseau : la valeur par defaut est donc **celle d'aujourd'hui**, et
  // le resserrement est un geste explicite :
  //
  //     BIND_ADDRESS=<adresse du pont Docker>   dans le .env, puis redemarrage
  //
  // Et **pas** 127.0.0.1 : nginx tourne dans un conteneur et joint l'API par la
  // passerelle du pont (proxy_pass 172.17.0.1:4000), pas par la boucle locale de
  // l'hote. Poser 127.0.0.1 ici couperait l'interface. L'adresse du pont, elle,
  // referme l'API vis-a-vis du LAN tout en la laissant joignable au conteneur :
  //
  //     ip -4 addr show docker0 | awk '/inet /{print $2}' | cut -d/ -f1
  //
  // Verifie que l'interface repond encore avant de le laisser en place. Si elle
  // ne repond plus, retire la ligne : rien d'autre n'a change.
  const adresse = process.env.BIND_ADDRESS || "0.0.0.0";
  if (adresse === "0.0.0.0") {
    console.warn(
      "[reseau] l'API ecoute sur toutes les interfaces. Pose BIND_ADDRESS sur " +
      "l'adresse du pont Docker (pas 127.0.0.1 : le frontend passe par le pont).",
    );
  }
  httpServer.listen(config.port, adresse, () => {
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

import { EventEmitter } from "events";
import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../db";
import { SESSION_COOKIE } from "../middleware/auth";

// Parses the Cookie header of the handshake (the browser sends it on its own
// under same origin — no need to pass the token through JS anymore).
function jetonDepuisHandshake(socket: any): string | null {
  const auth = socket.handshake?.auth?.token;
  if (auth) return String(auth);
  const brut: string = socket.handshake?.headers?.cookie || "";
  for (const part of brut.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

const EVENTS = [
  "devices:updated", "device:updated", "device:deleted",
  "scan:started", "scan:complete", "scan:progress",
  "alert:new", "log:new",
  "topology:updated", "host:metrics",
];

export function attachSocketIO(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
    path: "/ws",
  });

  io.use(async (socket, next) => {
    const token = jetonDepuisHandshake(socket);
    if (!token) return next(new Error("No auth token"));
    try {
      const payload: any = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
      // Same requirement as over HTTP: a revoked token (password changed) must
      // not keep a real-time stream open.
      const user = await prisma.user.findUnique({
        where: { id: payload.id }, select: { tokenVersion: true },
      });
      if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
        return next(new Error("Invalid token"));
      }
      next();
    } catch { next(new Error("Invalid token")); }
  });

  io.on("connection", (socket) => {
    EVENTS.forEach((evt) => {
      const handler = (payload: any) => socket.emit(evt, payload);
      eventBus.on(evt, handler);
      socket.on("disconnect", () => eventBus.off(evt, handler));
    });
  });

  return io;
}

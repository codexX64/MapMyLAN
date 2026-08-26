import { EventEmitter } from "events";
import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../db";
import { lireCookies, SESSION_COOKIE } from "../middleware/auth";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

const EVENTS = [
  "devices:updated", "device:updated", "device:deleted",
  "scan:started", "scan:complete", "scan:progress",
  "alert:new", "log:new",
  "topology:updated", "host:metrics",
];

/**
 * Verifie un jeton de poignee de main. Renvoie `null` si la connexion est
 * admise, sinon la raison du refus.
 *
 * Extraite du middleware pour etre testable : c'est la seule decision de
 * securite de ce fichier, elle ne doit pas dependre d'un serveur qui tourne.
 *
 * Verifier la signature ne suffisait pas. Un jeton revoque — apres un
 * changement de mot de passe, par exemple — ouvrait encore ce flux et
 * continuait de recevoir appareils, alertes, journaux et metriques d'hote
 * jusqu'a son expiration. On applique donc ici exactement les memes regles que
 * `authRequired` : type de jeton, puis version comparee au compte.
 */
export async function verifierPoigneeDeMain(token: unknown): Promise<string | null> {
  if (!token || typeof token !== "string") return "No auth token";

  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return "Invalid token";
  }
  // Liste blanche : tout jeton qui n'est pas un jeton de session est refuse.
  if (payload?.typ && payload.typ !== "session") return "Invalid token";

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, tokenVersion: true },
    });
    if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) return "Session expiree";
  } catch {
    // Base injoignable : on refuse plutot que d'ouvrir sans verification.
    return "Verification impossible";
  }
  return null;
}

export function attachSocketIO(httpServer: HttpServer) {
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
    path: "/ws",
  });

  // Authentification de la poignee de main.
  //
  // Verifier la signature ne suffisait pas : un jeton revoque — apres un
  // changement de mot de passe, par exemple — ouvrait encore ce flux et
  // continuait de recevoir appareils, alertes, journaux et metriques d'hote
  // jusqu'a son expiration. On applique donc ici exactement les memes regles
  // que `authRequired` : type de jeton, puis version comparee au compte.
  //
  // Le jeton est lu du cookie de session en priorite — le navigateur l'envoie
  // tout seul sur la poignee de main — sinon de `auth.token`, pour un client
  // qui n'a pas de cookie.
  io.use(async (socket, next) => {
    const cookies = lireCookies({ headers: socket.handshake.headers } as any);
    const token = cookies[SESSION_COOKIE] || socket.handshake.auth?.token;
    const verdict = await verifierPoigneeDeMain(token);
    if (verdict) return next(new Error(verdict));
    next();
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

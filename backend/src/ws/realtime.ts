import { EventEmitter } from "events";
import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { config } from "../config";

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

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No auth token"));
    try { jwt.verify(token, config.jwtSecret); next(); }
    catch { next(new Error("Invalid token")); }
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

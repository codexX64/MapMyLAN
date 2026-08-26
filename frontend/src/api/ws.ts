import { io, Socket } from "socket.io-client";
import { getToken } from "./client";

let socket: Socket | null = null;

export function connectWS(): Socket {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();
  socket = io(window.location.origin, {
    auth: { token: getToken() },
    path: "/ws",
    transports: ["websocket", "polling"],
    reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket(): Socket | null { return socket; }
export function disconnectWS() { socket?.disconnect(); socket = null; }

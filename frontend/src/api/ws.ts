import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function connectWS(): Socket {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();
  // The HttpOnly session cookie is sent automatically by the browser
  // (same origin, withCredentials): no more token passed through JS.
  socket = io(window.location.origin, {
    withCredentials: true,
    path: "/ws",
    transports: ["websocket", "polling"],
    reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket(): Socket | null { return socket; }
export function disconnectWS() { socket?.disconnect(); socket = null; }

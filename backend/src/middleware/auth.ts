import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../db";

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: string };
}

/**
 * Exige un jeton valide.
 *
 * La signature ne suffit pas : le jeton porte une version, comparée à celle du
 * compte. Un changement de mot de passe incrémente cette version, ce qui
 * invalide immédiatement tous les jetons émis auparavant. Sans cela, un jeton
 * volé resterait utilisable jusqu'à son expiration, quoi qu'on fasse.
 */
export async function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  const token = header.slice(7);

  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }

  // Tout jeton qui n'est pas un jeton de session est refusé ici. La règle est
  // écrite dans ce sens — liste blanche — pour qu'un futur jeton d'usage
  // particulier soit rejeté par défaut plutôt qu'accepté par omission.
  if (payload?.typ && payload.typ !== "session") {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, username: true, role: true, tokenVersion: true },
    });
    // Compte supprimé, ou jeton émis avant une révocation.
    if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: "Session expirée. Reconnectez-vous." });
    }
    req.user = { id: user.id, username: user.username, role: user.role };
  } catch {
    return res.status(503).json({ error: "Vérification impossible." });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

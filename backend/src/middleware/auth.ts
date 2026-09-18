import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../db";
import { logEvent } from "../services/logger";
import {
  estJetonIntegration, porteeRefusee, verifierJeton, noterUsage, debitDepasse,
} from "../services/integrations";

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: string };
}

/** Nom du cookie de session (jeton) et du cookie anti-CSRF. */
export const SESSION_COOKIE = "mapmylan_session";
export const CSRF_COOKIE = "mapmylan_csrf";

/**
 * Analyse l'en-tête Cookie sans dépendance externe.
 *
 * On évite d'ajouter `cookie-parser` : lire quelques cookies ne le justifie pas,
 * et moins de dépendances, c'est moins de surface (OWASP A03).
 */
export function lireCookies(req: Request): Record<string, string> {
  const brut = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!brut) return out;
  for (const part of brut.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Extrait le jeton : cookie de session en priorité, sinon en-tête
 * `Authorization` — pour un client API hors navigateur, et pour ne pas couper
 * un client qui n'a pas encore de cookie.
 *
 * Le cookie est `HttpOnly` : hors de portée de tout script, donc invulnérable
 * au vol par XSS, contrairement à un jeton rangé dans `localStorage`.
 */
export function extraireJeton(req: Request): string | null {
  const cookies = lireCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/** Pose le cookie de session et le cookie anti-CSRF associé. */
export function poserCookiesSession(
  req: Request, res: Response, token: string, csrf: string,
  maxAgeMs = 12 * 60 * 60 * 1000,
): void {
  // `secure` suit la connexion réelle (X-Forwarded-Proto via « trust proxy ») :
  // exigé sous HTTPS, toléré sous HTTP local pour ne pas casser une
  // installation domestique.
  const secure = req.secure;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: maxAgeMs,
  });
  // Lisible par le JS (double soumission) : ce n'est pas un secret de session,
  // juste une preuve que la requête vient bien de notre page.
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: maxAgeMs,
  });
}

/** Efface les cookies de session (déconnexion). */
export function effacerCookiesSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
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
  const token = extraireJeton(req);
  if (!token) return res.status(401).json({ error: "Missing token" });

  // Un jeton d'intégration se reconnaît à son préfixe et ne suit pas du tout le
  // même chemin : il n'est pas signé, il est cherché en base par son empreinte.
  // Le chemin JWT ci-dessous reste exactement ce qu'il était.
  if (estJetonIntegration(token)) return authIntegration(req, res, next, token);

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

/**
 * Chemin d'authentification d'un jeton d'intégration.
 *
 * Trois refus successifs, dans cet ordre : le débit, puis l'existence du
 * jeton, puis la portée. Compter le débit avant de lire la base est
 * volontaire — sans cela, un jeton inconnu ferait travailler la base autant
 * qu'il le voudrait.
 *
 * Le jeton n'est jamais recopié dans le journal, ni en clair ni en empreinte :
 * seul le motif du refus y figure.
 */
async function authIntegration(
  req: AuthedRequest, res: Response, next: NextFunction, token: string,
) {
  const url = req.originalUrl || req.url || "/";
  const chemin = url.split("?")[0];
  const ip = req.ip || "inconnue";

  if (debitDepasse(`ip:${ip}`)) {
    return res.status(429).json({ error: "Trop de requêtes" });
  }

  let verdict;
  try {
    verdict = await verifierJeton(token);
  } catch {
    return res.status(503).json({ error: "Vérification impossible." });
  }

  if (!verdict.ok) {
    await logEvent("warn", "integrations",
      `Jeton d'intégration refusé (${verdict.raison})`, { chemin, methode: req.method });
    return res.status(401).json({ error: "Invalid token" });
  }

  if (debitDepasse(`jeton:${verdict.jeton.id}`)) {
    return res.status(429).json({ error: "Trop de requêtes" });
  }

  const ferme = porteeRefusee(req.method, url);
  if (ferme) {
    await logEvent("warn", "integrations",
      `Jeton « ${verdict.jeton.name} » écarté de ${ferme}`, { chemin, methode: req.method });
    return res.status(403).json({ error: "Forbidden" });
  }

  // L'identité porte le préfixe « integration: » : ce qui la lit ensuite —
  // journal, contrôle de rôle, pistes d'audit — ne peut pas la confondre avec
  // un compte, et aucun identifiant de compte ne peut la contrefaire (les
  // identifiants refusent le deux-points).
  req.user = {
    id: `integration:${verdict.jeton.id}`,
    username: `integration:${verdict.jeton.name}`,
    role: verdict.jeton.role,
  };
  noterUsage(verdict.jeton.id);
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

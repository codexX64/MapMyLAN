import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../db";

export interface AuthedRequest extends Request {
  user?: { id: string; username: string; role: string };
}

/** Name of the session cookie (token) and of the anti-CSRF cookie. */
export const SESSION_COOKIE = "mapmylan_session";
export const CSRF_COOKIE = "mapmylan_csrf";

/**
 * Parses the Cookie header without any external dependency.
 *
 * We avoid adding `cookie-parser`: reading a few cookies does not justify it,
 * and fewer dependencies means less surface (OWASP A03).
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
 * Extracts the token, from the session cookie first, otherwise from the
 * Authorization header (for a non-browser API client).
 *
 * The cookie is `HttpOnly`: out of reach of any script, therefore immune to
 * theft via XSS, unlike a token kept in `localStorage`.
 */
export function extraireJeton(req: Request): string | null {
  const cookies = lireCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/** Sets the session cookie and the associated anti-CSRF cookie. */
export function poserCookiesSession(req: Request, res: Response, token: string, csrf: string, maxAgeMs = 12 * 60 * 60 * 1000): void {
  // `secure` follows the actual connection (X-Forwarded-Proto via "trust
  // proxy"): required under HTTPS, tolerated under local HTTP so as not to
  // break the homelab.
  const secure = req.secure;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: maxAgeMs,
  });
  // Readable by JS (double-submit): this is not a session secret, just proof
  // that the request really comes from our page.
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: maxAgeMs,
  });
}

/** Clears the session cookies (logout). */
export function effacerCookiesSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

/**
 * Requires a valid token.
 *
 * The signature is not enough: the token carries a version, compared against
 * the account's. A password change increments this version, which immediately
 * invalidates every token issued before. Without this, a stolen token would
 * stay usable until it expires, no matter what we do.
 */
export async function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extraireJeton(req);
  if (!token) {
    return res.status(401).json({ error: "Token missing." });
  }

  let payload: any;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Invalid token." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, username: true, role: true, tokenVersion: true },
    });
    // Deleted account, or token issued before a revocation.
    if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    req.user = { id: user.id, username: user.username, role: user.role };
  } catch {
    return res.status(503).json({ error: "Verification failed." });
  }
  next();
}

/** Restricts access to certain roles. */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied." });
    }
    next();
  };
}

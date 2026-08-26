import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { lireCookies, SESSION_COOKIE, CSRF_COOKIE } from "./auth";

// Double-submit CSRF protection.
//
// The session token lives in a cookie that the browser sends on its own: that
// is what exposes it to requests forged from another site. `SameSite=Strict`
// already blocks the cookie from being sent on a cross-site request, but we add
// a second, independent barrier: on any state-modifying method, the server
// requires an `X-CSRF-Token` header equal to the `mapmylan_csrf` cookie. A
// third-party site cannot read this cookie (same-origin policy) and therefore
// cannot fabricate the header.
//
// We require nothing when the request does not authenticate via cookie (`Bearer`
// token API client, which cannot be triggered by CSRF), nor on safe methods.

const METHODES_SURES = new Set(["GET", "HEAD", "OPTIONS"]);

function egal(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (METHODES_SURES.has(req.method)) return next();

  const cookies = lireCookies(req);
  // No session cookie → no browser flow to protect (Bearer or unauthenticated
  // request, which `authRequired` will refuse anyway).
  if (!cookies[SESSION_COOKIE]) return next();

  const attendu = cookies[CSRF_COOKIE];
  const fourni = String(req.headers["x-csrf-token"] || "");
  if (!attendu || !fourni || !egal(attendu, fourni)) {
    return res.status(403).json({ error: "Anti-CSRF token missing or invalid." });
  }
  next();
}

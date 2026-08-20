import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { hacher as hacherMotDePasse, verifier as verifierMotDePasse } from "../services/password";
import { config } from "../config";
import { logEvent } from "../services/logger";
import { authRequired, poserCookiesSession, effacerCookiesSession } from "../middleware/auth";

const router = Router();

/** Signs a session token for an account. */
function signerJeton(user: { id: string; username: string; role: string; tokenVersion?: number | null }): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion || 0 },
    config.jwtSecret,
    { expiresIn: "12h" },
  );
}

// Login.
//
// Three protections stack up. The temporary lockout stops repeated attempts on
// a specific account, where the rate limiter only sees addresses. The check
// takes a comparable amount of time whether the account exists or not,
// otherwise it can be enumerated by stopwatch. And the token carries a version,
// which lets us revoke it without waiting for it to expire.
router.post("/login", async (req, res) => {
  const schema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(4096) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });

  // Locked account: we do not even check the password.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const reste = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    await logEvent("warn", "auth", `Login refused, account locked: ${username}`);
    return res.status(423).json({ error: `Account temporarily locked. Try again in ${reste} s.` });
  }

  const v = await verifierMotDePasse(password, user?.password);

  if (!user || !v.ok) {
    if (user) {
      // The lockout grows with each streak: five failures lock for one minute,
      // ten lock for fifteen. A user who mistypes twice is not bothered; an
      // automated tool is stopped.
      const echecs = (user.failedLogins || 0) + 1;
      const duree = echecs >= 10 ? 15 * 60 : echecs >= 5 ? 60 : 0;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: echecs,
          lockedUntil: duree ? new Date(Date.now() + duree * 1000) : null,
        },
      });
      if (duree) await logEvent("warn", "auth", `Account locked after ${echecs} failures: ${username}`);
    }
    // Identical message in both cases: distinguishing "unknown account" from
    // "wrong password" amounts to confirming that an account exists.
    return res.status(401).json({ error: "Incorrect credentials." });
  }

  // Outdated hash: we rewrite it along the way, without asking anything.
  const maj: any = { lastLogin: new Date(), failedLogins: 0, lockedUntil: null };
  if (v.aMettreAJour && v.nouvelleEmpreinte) maj.password = v.nouvelleEmpreinte;
  await prisma.user.update({ where: { id: user.id }, data: maj });

  const token = signerJeton(user);
  await logEvent("info", "auth", `Login: ${username}`);

  // The token goes out in an HttpOnly cookie, not in the body: it never passes
  // through JavaScript, so no script can steal it. The anti-CSRF cookie goes
  // along with it.
  const csrf = randomBytes(32).toString("hex");
  poserCookiesSession(req, res, token, csrf);

  // Include setup completion status so the frontend knows whether to show the wizard
  const setup = await prisma.setting.findUnique({ where: { key: "setup.complete" } });
  res.json({
    user: { id: user.id, username: user.username, role: user.role },
    setupComplete: setup?.value === true,
    // Convenience: the front end can also read the readable CSRF cookie, but we
    // return it to bootstrap without depending on the order cookies are applied.
    csrfToken: csrf,
  });
});

// Logout: clears the session cookies on the browser side.
router.post("/logout", (req, res) => {
  effacerCookiesSession(res);
  res.json({ ok: true });
});

// Password change.
//
// The endpoint requires a token and operates on the account that carries it.
// Previously, the username was accepted from the request body: without
// authentication, anyone could therefore test username / password pairs, which
// turned it into a guessing oracle.
router.post("/change-password", authRequired, async (req: any, res) => {
  const schema = z.object({ oldPassword: z.string(), newPassword: z.string().min(12) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "The new password must be at least 12 characters." });
  }
  const { oldPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const v = await verifierMotDePasse(oldPassword, user?.password);
  if (!user || !v.ok) {
    await logEvent("warn", "auth", `Change refused: current password incorrect (${req.user.id})`);
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  if (oldPassword === newPassword) {
    return res.status(400).json({ error: "The new password must be different from the old one." });
  }

  const maj = await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await hacherMotDePasse(newPassword),
      // All open sessions become void: a password changed because it is
      // believed compromised must not leave the tokens issued before it alive.
      tokenVersion: { increment: 1 },
    },
  });
  await logEvent("info", "auth", `Password changed: ${user.username}`);

  // The change just invalidated the current cookie (version incremented). We
  // reissue one right away, at the new version, so the user stays logged in on
  // THIS device without having to log back in — the other sessions, meanwhile,
  // do fall.
  const token = signerJeton(maj);
  const csrf = randomBytes(32).toString("hex");
  poserCookiesSession(req, res, token, csrf);
  res.json({ ok: true, csrfToken: csrf });
});

export default router;

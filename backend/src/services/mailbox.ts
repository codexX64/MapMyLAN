// Vérification d'une boîte mail : on ouvre l'IMAP, puis le SMTP, et on ne
// garde rien. Écrit sur les modules `tls` et `net` de Node, sans dépendance —
// `nodemailer` ne sait que parler SMTP et n'aiderait pas pour la réception.
//
// Le point important est le message d'erreur : « erreur de connexion » ne sert
// à rien. On distingue le nom qui ne résout pas, le port fermé, la poignée de
// main TLS qui échoue et les identifiants refusés, parce que ce sont quatre
// corrections différentes.

import net from "net";
import tls from "tls";

const TIMEOUT_MS = 10_000;

export type Security = "ssl" | "starttls" | "none";

export interface SideConfig {
  host: string;
  port: number;
  security: Security;
}

export interface VerifyInput {
  email: string;
  password: string;
  role?: "both" | "send" | "receive";
  imap?: SideConfig;
  smtp?: SideConfig;
}

export interface VerifyResult {
  ok: boolean;
  inbox?: string;
  error?: string;
  details?: string[];
}

// ── Diagnostic ──────────────────────────────────────────────────────────────
function describe(err: any, side: string, host: string, port: number): string {
  const code = err?.code || "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `${side} : le nom « ${host} » ne résout pas (DNS).`;
  }
  if (code === "ECONNREFUSED") {
    return `${side} : le port ${port} est fermé sur ${host}.`;
  }
  if (code === "ETIMEDOUT" || code === "ERR_SOCKET_CONNECTION_TIMEOUT" || err?.timeout) {
    return `${side} : ${host}:${port} ne répond pas (délai dépassé).`;
  }
  if (code.startsWith("ERR_TLS") || code === "EPROTO" || /certificate|self.signed|handshake/i.test(String(err?.message))) {
    return `${side} : la négociation TLS a échoué (${err?.message || code}).`;
  }
  return `${side} : ${err?.message || code || "échec inconnu"}`;
}

// ── Dialogue ligne à ligne ──────────────────────────────────────────────────
// Un petit assistant partagé : on écrit une commande, on attend la réponse qui
// satisfait un prédicat, le tout sous surveillance d'un minuteur.
class Dialogue {
  private buf = "";
  private attente: { test: (s: string) => boolean; res: (s: string) => void; rej: (e: any) => void } | null = null;
  private mort = false;

  constructor(private sock: net.Socket | tls.TLSSocket) {
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      this.buf += d;
      if (!this.attente) return;
      if (this.attente.test(this.buf)) {
        const out = this.buf;
        this.buf = "";
        const a = this.attente;
        this.attente = null;
        a.res(out);
      }
    });
    const casse = (e: any) => {
      this.mort = true;
      if (this.attente) { const a = this.attente; this.attente = null; a.rej(e); }
    };
    sock.on("error", casse);
    sock.on("close", () => casse(new Error("connexion fermée par le serveur")));
  }

  attendre(test: (s: string) => boolean, ms = TIMEOUT_MS): Promise<string> {
    if (this.mort) return Promise.reject(new Error("connexion fermée"));
    // Une réponse déjà complète peut être arrivée avant qu'on la demande.
    if (this.buf && test(this.buf)) {
      const out = this.buf; this.buf = "";
      return Promise.resolve(out);
    }
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.attente = null;
        rej(Object.assign(new Error("délai dépassé"), { timeout: true }));
      }, ms);
      this.attente = {
        test,
        res: (s) => { clearTimeout(t); res(s); },
        rej: (e) => { clearTimeout(t); rej(e); },
      };
    });
  }

  ecrire(ligne: string) { this.sock.write(ligne + "\r\n"); }
  fermer() { try { this.sock.destroy(); } catch { /* déjà fermée */ } }
}

function connecter(cfg: SideConfig): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((res, rej) => {
    const opts: any = { host: cfg.host, port: cfg.port };
    const sock = cfg.security === "ssl"
      ? tls.connect({ ...opts, servername: cfg.host, rejectUnauthorized: false })
      : net.connect(opts);
    const t = setTimeout(() => {
      sock.destroy();
      rej(Object.assign(new Error("délai dépassé"), { timeout: true }));
    }, TIMEOUT_MS);
    sock.once(cfg.security === "ssl" ? "secureConnect" : "connect", () => { clearTimeout(t); res(sock); });
    sock.once("error", (e) => { clearTimeout(t); rej(e); });
  });
}

function passerEnTls(sock: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((res, rej) => {
    const sec = tls.connect({ socket: sock, servername: host, rejectUnauthorized: false }, () => res(sec));
    sec.once("error", rej);
  });
}

// ── IMAP ────────────────────────────────────────────────────────────────────
async function verifierImap(cfg: SideConfig, user: string, pass: string): Promise<string> {
  let sock = await connecter(cfg);
  if (cfg.security === "starttls") {
    const d0 = new Dialogue(sock);
    await d0.attendre((s) => /^\* OK/m.test(s));
    d0.ecrire("a0 STARTTLS");
    await d0.attendre((s) => /^a0 (OK|NO|BAD)/m.test(s));
    sock = await passerEnTls(sock as net.Socket, cfg.host);
  }

  const d = new Dialogue(sock);
  if (cfg.security !== "starttls") {
    await d.attendre((s) => /^\* (OK|PREAUTH|BYE)/m.test(s));
  }

  // Les guillemets protègent les mots de passe contenant des espaces.
  const esc = (v: string) => '"' + v.replace(/([\\"])/g, "\\$1") + '"';
  d.ecrire(`a1 LOGIN ${esc(user)} ${esc(pass)}`);
  const rep = await d.attendre((s) => /^a1 (OK|NO|BAD)/m.test(s));
  if (!/^a1 OK/m.test(rep)) {
    d.fermer();
    const ligne = (rep.match(/^a1 (?:NO|BAD) (.+)$/m) || [])[1] || "identifiants refusés";
    throw Object.assign(new Error(`IMAP : ${ligne.trim()}`), { propre: true });
  }

  d.ecrire("a2 SELECT INBOX");
  const sel = await d.attendre((s) => /^a2 (OK|NO|BAD)/m.test(s));
  d.ecrire("a3 LOGOUT");
  d.fermer();

  const n = (sel.match(/^\* (\d+) EXISTS/m) || [])[1];
  return n ? `INBOX · ${n} message${Number(n) > 1 ? "s" : ""}` : "INBOX";
}

// ── SMTP ────────────────────────────────────────────────────────────────────
async function verifierSmtp(cfg: SideConfig, user: string, pass: string): Promise<void> {
  let sock = await connecter(cfg);
  let d = new Dialogue(sock);
  await d.attendre((s) => /^220[ -]/m.test(s));

  const nom = "mapmylan.local";
  d.ecrire(`EHLO ${nom}`);
  let rep = await d.attendre((s) => /^\d{3} /m.test(s));

  if (cfg.security === "starttls") {
    d.ecrire("STARTTLS");
    await d.attendre((s) => /^220[ -]/m.test(s));
    sock = await passerEnTls(sock as net.Socket, cfg.host);
    d = new Dialogue(sock);
    d.ecrire(`EHLO ${nom}`);
    rep = await d.attendre((s) => /^\d{3} /m.test(s));
  }

  if (!/AUTH/i.test(rep)) {
    // Certains relais n'annoncent pas AUTH : on tente quand même, le serveur
    // tranchera lui-même.
  }

  d.ecrire("AUTH LOGIN");
  const defi = await d.attendre((s) => /^\d{3}[ -]/m.test(s));
  if (!/^334/m.test(defi)) {
    d.fermer();
    throw Object.assign(new Error(`SMTP : authentification refusée (${defi.trim().split("\n")[0]})`), { propre: true });
  }

  d.ecrire(Buffer.from(user, "utf8").toString("base64"));
  await d.attendre((s) => /^\d{3}[ -]/m.test(s));
  d.ecrire(Buffer.from(pass, "utf8").toString("base64"));
  const fin = await d.attendre((s) => /^\d{3}[ -]/m.test(s));

  d.ecrire("QUIT");
  d.fermer();

  if (!/^235/m.test(fin)) {
    const ligne = fin.trim().split("\n")[0];
    throw Object.assign(new Error(`SMTP : identifiants refusés (${ligne})`), { propre: true });
  }
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
export async function verifierBoite(cfg: VerifyInput): Promise<VerifyResult> {
  const role = cfg.role || "both";
  const details: string[] = [];
  let inbox: string | undefined;

  if (role !== "send") {
    if (!cfg.imap) return { ok: false, error: "Réglages IMAP manquants." };
    try {
      inbox = await verifierImap(cfg.imap, cfg.email, cfg.password);
      details.push(`IMAP ${cfg.imap.host}:${cfg.imap.port} — ${inbox}`);
    } catch (e: any) {
      const msg = e?.propre ? e.message : describe(e, "IMAP", cfg.imap.host, cfg.imap.port);
      return { ok: false, error: msg, details };
    }
  }

  if (role !== "receive") {
    if (!cfg.smtp) return { ok: false, error: "Réglages SMTP manquants.", details };
    try {
      await verifierSmtp(cfg.smtp, cfg.email, cfg.password);
      details.push(`SMTP ${cfg.smtp.host}:${cfg.smtp.port} — authentification acceptée`);
    } catch (e: any) {
      const msg = e?.propre ? e.message : describe(e, "SMTP", cfg.smtp.host, cfg.smtp.port);
      return { ok: false, error: msg, details };
    }
  }

  return { ok: true, inbox: inbox || "envoi seul", details };
}

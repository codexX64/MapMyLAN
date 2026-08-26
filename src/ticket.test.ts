import { describe, it, expect } from "vitest";
import { construireTicket, envoyerApi, type Ticket } from "./ticket";

// The ticket subject is built from network-supplied hostnames, and the API URL
// is operator-configured. Both were injection vectors; these lock the fixes.

describe("ticket subject sanitising", () => {
  it("strips CR/LF from a hostname so it cannot inject a mail header", () => {
    const t = construireTicket("hote_inconnu", { hote: "evil\r\nBcc: attacker@x.com", ip: "10.0.0.5" });
    expect(t.titre).not.toMatch(/[\r\n]/);
  });
});

describe("urgency override", () => {
  it("cannot escalate above the matrix result", () => {
    // hote_inconnu maps to a low urgency; an override to p1 must be ignored.
    const t = construireTicket("hote_inconnu", { hote: "h", ip: "10.0.0.5", urgence: "p1" });
    expect(t.urgence).not.toBe("p1");
  });

  it("still allows a downgrade", () => {
    const t = construireTicket("equipement_injoignable", { urgence: "p4" });
    expect(t.urgence).toBe("p4");
  });
});

describe("ticketing API URL guard (SSRF)", () => {
  const t: Ticket = construireTicket("hote_inconnu", { hote: "h", ip: "10.0.0.5" });

  it("blocks the cloud metadata endpoint", async () => {
    const r = await envoyerApi(t, { url: "http://169.254.169.254/latest/meta-data" });
    expect(r.ok).toBe(false);
    expect(r.erreur).toMatch(/HTTPS/);
  });

  it("blocks an external plain-HTTP target", async () => {
    const r = await envoyerApi(t, { url: "http://tickets.example.com/api" });
    expect(r.ok).toBe(false);
    expect(r.erreur).toMatch(/HTTPS/);
  });

  it("refuses credentials embedded in the URL", async () => {
    const r = await envoyerApi(t, { url: "http://user:pass@10.0.0.9/api" });
    expect(r.ok).toBe(false);
    // Le message a été traduit en français ; l'assertion visait encore le mot
    // anglais. On vise ce que la garde refuse, pas la langue dans laquelle
    // elle le dit.
    expect(r.erreur).toMatch(/identifiants dans l'URL/);
  });
});

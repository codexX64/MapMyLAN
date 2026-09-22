// Assistant de première configuration.
//
// C'était la dernière page restée dans l'ancien langage visuel : fond sombre
// en dur, dégradés cyan, polices qui n'existent plus ailleurs. Elle suit
// maintenant le thème de l'application comme le reste — clair ou sombre, sans
// une seule couleur écrite en dur ici.
//
// Le CSS vient de la maquette, presque mot pour mot. Il peut : les variables
// (--surface, --accent, --hair…) sont déjà posées sur <html> par
// `theme-runtime`. Les classes sont préfixées `ob-` pour ne jamais entrer en
// collision avec `maquette.css`, qui définit déjà `.field` et `.note`.
//
// Ce que l'assistant garantit, et qui n'a pas changé : l'équipement réseau est
// obligatoire, et rien n'est enregistré tant que la connexion n'a pas répondu.
// Le reste — messagerie, courrier, SMS — se passe, et se règle plus tard.

import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { useStore } from "../stores/app";
import { useT } from "../lib/i18n";

const ETAPES = ["accueil", "equipement", "verif", "telegram", "courrier", "sms", "topologie", "fin"] as const;
/** Étapes que « Passer cette étape » saute : les trois canaux d'alerte. */
const FACULTATIVES = new Set([3, 4, 5]);

// Les identifiants doivent correspondre exactement à ceux des adaptateurs du
// serveur, sinon la connexion échoue silencieusement. UniFi parle à l'API
// locale en HTTPS ; tous les autres passent en SSH.
const VENDORS = [
  { value: "unifi",       label: "Ubiquiti · UniFi",      note: "API locale HTTPS" },
  { value: "asus-merlin", label: "Asus · Merlin",         note: "SSH" },
  { value: "openwrt",     label: "OpenWrt",               note: "SSH" },
  { value: "routeros",    label: "MikroTik · RouterOS",   note: "SSH" },
  { value: "pfsense",     label: "pfSense / OPNsense",    note: "SSH" },
  { value: "cisco-ios",   label: "Cisco IOS",             note: "SSH" },
  { value: "zyxel",       label: "Zyxel",                 note: "SSH" },
  { value: "edgeos",      label: "Ubiquiti · EdgeOS",     note: "SSH" },
  { value: "generic",     label: "Autre (SSH générique)", note: "SSH" },
];
const estApi = (v: string) => v === "unifi";

const FOURNISSEURS = [
  { value: "gmail",   label: "Gmail",   note: "IMAP et SMTP remplis tout seuls" },
  { value: "icloud",  label: "iCloud",  note: "IMAP et SMTP remplis tout seuls" },
  { value: "outlook", label: "Outlook", note: "IMAP et SMTP remplis tout seuls" },
];

// ───────────────────────────────────────────────────────────────────────────
// Le style de la maquette. Aucune couleur en dur : tout vient des variables
// posées sur <html>, donc la bascule clair/sombre fonctionne sans un seul if.
// ───────────────────────────────────────────────────────────────────────────

const CSS = `
.ob-halos{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.ob-halos i{position:absolute;display:block;border-radius:50%}
.ob-halos i:nth-child(1){top:-22%;left:-12%;width:70%;height:80%;
  background:radial-gradient(circle,color-mix(in srgb,var(--accent) 12%,transparent),transparent 62%);
  filter:blur(46px);animation:ob-d1 28s ease-in-out infinite}
.ob-halos i:nth-child(2){bottom:-28%;right:-14%;width:66%;height:76%;
  background:radial-gradient(circle,color-mix(in srgb,var(--accent) 9%,transparent),transparent 62%);
  filter:blur(52px);animation:ob-d2 34s ease-in-out infinite}
@keyframes ob-d1{0%,100%{transform:translate(-6%,-8%) scale(1)}50%{transform:translate(7%,6%) scale(1.18)}}
@keyframes ob-d2{0%,100%{transform:translate(8%,6%) scale(1.12)}50%{transform:translate(-7%,-6%) scale(1)}}

.ob-overlay{position:fixed;inset:0;z-index:400;display:flex;align-items:center;
  justify-content:center;padding:24px;background:var(--paper);
  font-family:var(--sans);color:var(--ink);font-size:13.5px}
.ob-wiz{position:relative;z-index:1;width:100%;max-width:660px;background:var(--surface);
  border-radius:20px;box-shadow:var(--lift-hi);max-height:calc(100dvh - 48px);
  display:flex;flex-direction:column}
.ob-head{padding:26px 30px 0;flex:none}
.ob-brand{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.ob-brand .g{width:36px;height:36px;border-radius:12px;background:var(--ink);color:var(--paper);
  display:flex;align-items:center;justify-content:center;box-shadow:var(--lift);flex:none}
.ob-brand b{font-size:17px;font-weight:600;letter-spacing:-.03em;display:block}
.ob-brand span{font-family:var(--mono);font-size:11px;color:var(--faint);display:block;margin-top:1px}
.ob-brand .th{margin-left:auto;width:30px;height:30px;border-radius:9px;display:flex;
  align-items:center;justify-content:center;color:var(--muted);background:none;border:none;cursor:pointer}
.ob-brand .th:hover{background:var(--well);color:var(--ink)}
.ob-steps{display:flex;gap:5px;margin-bottom:22px}
.ob-steps i{flex:1;height:3px;border-radius:3px;background:var(--hair);transition:background .35s}
.ob-steps i.done{background:color-mix(in srgb,var(--accent) 45%,transparent)}
.ob-steps i.now{background:var(--accent)}

.ob-body{padding:0 30px 4px;overflow-y:auto;flex:1;
  scrollbar-width:thin;scrollbar-color:var(--hair) transparent}
.ob-body::-webkit-scrollbar{width:9px}
.ob-body::-webkit-scrollbar-thumb{background:var(--hair);border-radius:9px;border:3px solid var(--surface)}
.ob-body::after{content:"";display:block;height:6px}
.ob-step{animation:ob-mont .3s cubic-bezier(.2,.7,.3,1)}
@keyframes ob-mont{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ob-step h1{font-size:26px;line-height:1.12;font-weight:600;letter-spacing:-.03em;margin:0}
.ob-step .sub{color:var(--muted);font-size:13.5px;margin-top:7px;line-height:1.55;max-width:52ch}
.ob-grp{margin-top:22px}
.ob-grp + .ob-grp{margin-top:14px}
.ob-lbl{display:block;color:var(--faint);font-size:10.5px;text-transform:uppercase;
  letter-spacing:.12em;margin-bottom:6px}
.ob-field{width:100%;background:var(--well);border:1px solid var(--hair);color:var(--ink);
  border-radius:9px;padding:10px 13px;font-size:13.5px;outline:none;font-family:var(--mono);
  transition:border-color .15s}
.ob-field:focus{border-color:var(--accent)}
.ob-field.sans{font-family:var(--sans)}
textarea.ob-field{resize:vertical;font-size:11.5px;line-height:1.5}
.ob-hint{color:var(--faint);font-size:11.5px;margin-top:6px;line-height:1.5}
.ob-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ob-row3{display:grid;grid-template-columns:1fr 110px;gap:12px}
.ob-liste{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:11px}
.ob-liste li{display:flex;gap:11px;align-items:flex-start;color:var(--ink-soft);font-size:13.5px;line-height:1.5}
.ob-liste .c{width:18px;height:18px;border-radius:6px;background:var(--wash);color:var(--accent);
  display:flex;align-items:center;justify-content:center;flex:none;margin-top:1px;font-size:11px}

.ob-choix{display:grid;gap:11px;margin-top:20px}
.ob-opt{display:flex;gap:13px;padding:15px 16px;border-radius:12px;background:var(--well);
  border:1.5px solid transparent;text-align:left;transition:.16s;align-items:flex-start;width:100%;
  color:inherit;font:inherit;cursor:pointer}
.ob-opt:hover{background:var(--surface);box-shadow:var(--lift)}
.ob-opt.on{background:var(--surface);border-color:var(--accent);box-shadow:var(--lift)}
.ob-opt.fig{cursor:default}
.ob-opt .ic{width:34px;height:34px;border-radius:11px;background:var(--surface);color:var(--muted);
  display:flex;align-items:center;justify-content:center;flex:none}
.ob-opt.on .ic{background:var(--wash);color:var(--accent)}
.ob-opt.ko{border-color:var(--alarm);background:var(--surface)}
.ob-opt.ko .ic{background:var(--alarm-wash);color:var(--alarm)}
.ob-opt b{display:block;font-size:14px;font-weight:600;letter-spacing:-.01em}
.ob-opt p{color:var(--muted);font-size:12.5px;margin:4px 0 0;line-height:1.5}

.ob-basc{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:11px;
  background:var(--well);margin-top:20px}
.ob-basc .t{flex:1;min-width:0}
.ob-basc b{font-size:13.5px;font-weight:500;display:block}
.ob-basc p{color:var(--muted);font-size:12px;margin:2px 0 0}
.ob-sw{width:38px;height:21px;border-radius:21px;background:var(--hair);position:relative;
  flex:none;transition:background .18s;border:none;padding:0;cursor:pointer}
.ob-sw.on{background:var(--accent)}
.ob-sw s{position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;
  background:#fff;transition:left .18s}
.ob-sw.on s{left:19.5px}

.ob-note{display:flex;gap:10px;align-items:flex-start;margin-top:16px;padding:11px 13px;
  border-radius:10px;background:var(--wash);color:var(--ink-soft);font-size:12.5px;line-height:1.55}
.ob-note.w{background:var(--warn-wash);color:var(--warn)}
.ob-note.a{background:var(--alarm-wash);color:var(--alarm)}
.ob-note.ok{background:var(--wash);color:var(--accent)}
.ob-note .p{flex:none;margin-top:1px}

.ob-foot{padding:16px 30px 20px;display:flex;align-items:center;gap:14px;flex:none;
  border-top:1px solid var(--hair-soft);flex-wrap:wrap}
.ob-back{color:var(--muted);font-size:13px;display:flex;align-items:center;gap:7px;
  background:none;border:none;cursor:pointer;font-family:inherit}
.ob-back:hover{color:var(--ink-soft)}
.ob-back.vide{visibility:hidden}
.ob-passer{color:var(--faint);font-size:12.5px;background:none;border:none;cursor:pointer;font-family:inherit}
.ob-passer:hover{color:var(--muted)}
.ob-next{margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--ink);
  color:var(--paper);border-radius:10px;padding:10px 20px;font-size:13.5px;font-weight:600;
  transition:.16s;white-space:nowrap;flex:none;border:none;cursor:pointer;font-family:inherit}
.ob-next:hover{opacity:.88}
.ob-next:disabled{background:var(--well);color:var(--faint);cursor:not-allowed;opacity:1}

.ob-sel{position:relative}
.ob-pan{position:absolute;top:calc(100% + 5px);left:0;right:0;z-index:410;background:var(--surface);
  border:1px solid var(--hair);border-radius:11px;box-shadow:var(--lift-hi);padding:5px;
  max-height:260px;overflow-y:auto;animation:ob-drop .16s cubic-bezier(.2,.7,.3,1)}
@keyframes ob-drop{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.ob-pan button{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;
  border:none;text-align:left;background:transparent;color:var(--ink-soft);font:inherit;cursor:pointer}
.ob-pan button.vise{background:var(--well)}
.ob-pan button .n{display:block;font-size:11px;color:var(--faint);margin-top:1px}
.ob-spin{width:13px;height:13px;border-radius:50%;border:2px solid color-mix(in srgb,currentColor 25%,transparent);
  border-top-color:currentColor;animation:ob-tourne .7s linear infinite;flex:none}
@keyframes ob-tourne{to{transform:rotate(360deg)}}

@media (max-width:560px){
  .ob-overlay{padding:12px}
  .ob-wiz{max-height:calc(100dvh - 24px);border-radius:16px}
  .ob-head{padding:20px 18px 0}
  .ob-body{padding:0 18px 4px}
  .ob-foot{padding:14px 18px 16px;gap:10px}
  .ob-step h1{font-size:22px}
  .ob-row2,.ob-row3{grid-template-columns:1fr}
  .ob-next{padding:10px 16px;font-size:13px}
  .ob-next svg{display:none}
  .ob-passer{order:3;width:100%;text-align:left}
}
`;

const svg = (d: React.ReactNode, n = 15) => (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const IcoInfo = svg(<><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></>);
const IcoAlerte = svg(<><path d="M12 4 21 19H3z"/><path d="M12 10v4M12 16.5h.01"/></>);
const IcoBouclier = svg(<><path d="M12 3.2 19 6v5.2c0 4.4-2.9 7.5-7 8.9-4.1-1.4-7-4.5-7-8.9V6z"/><path d="M9.6 11.8 11.4 13.6 15 10"/></>);

export function OnboardingPage() {
  const setSetupComplete = useStore((s) => s.setSetupComplete);
  const themeKey = useStore((s) => s.themeKey);
  const setTheme = useStore((s) => s.setTheme);
  const tr = useT();

  const [etape, setEtape] = useState(0);
  const [data, setData] = useState<any>({
    router: { name: "Routeur principal", host: "", port: 443, username: "admin", password: "", privateKey: "", passphrase: "", useKey: false, vendor: "unifi", apiBaseUrl: "", site: "default" },
    telegram: { enabled: false, token: "", chatId: "" },
    email: { enabled: false, provider: "gmail", address: "", password: "" },
    sms: { enabled: false, sid: "", token: "", from: "", to: "" },
    autoTopology: true,
  });
  const [verdict, setVerdict] = useState<{ ok: boolean; banner?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState("");
  const corps = useRef<HTMLDivElement>(null);

  // L'adresse de l'équipement est devinée depuis la plage balayée : dans la
  // très grande majorité des installations, la passerelle est en .1.
  useEffect(() => {
    api.settings().then((s) => {
      const plage = s["scan.subnet"] as string | undefined;
      if (!plage) return;
      const guess = plage.split("/")[0].split(".").slice(0, 3).join(".") + ".1";
      setData((d: any) => (d.router.host ? d : { ...d, router: { ...d.router, host: guess } }));
    }).catch(() => {});
  }, []);

  useEffect(() => { if (corps.current) corps.current.scrollTop = 0; }, [etape]);

  const maj = (cle: string, v: any) => setData((d: any) => ({ ...d, [cle]: { ...d[cle], ...v } }));
  const r = data.router;
  const parApi = estApi(r.vendor);

  const charge = () => ({
    name: r.name, host: r.host, port: r.port, username: r.username, vendor: r.vendor,
    transport: parApi ? "api" : "ssh",
    apiBaseUrl: parApi ? (r.apiBaseUrl || `https://${r.host}`) : undefined,
    site: parApi ? (r.site || "default") : undefined,
    ...(r.useKey && !parApi
      ? { privateKey: r.privateKey, passphrase: r.passphrase || undefined }
      : { password: r.password }),
  });

  const verifier = async () => {
    setBusy(true); setErreur("");
    try {
      const v = await api.testSsh(charge());
      setVerdict(v);
      // Même en cas d'échec on avance : l'écran suivant est celui qui explique
      // ce qui s'est passé, et il porte le bouton qui réessaie.
      setEtape(2);
    } catch (e: any) { setErreur(e.message); }
    finally { setBusy(false); }
  };

  const enregistrer = async () => {
    setBusy(true); setErreur("");
    try {
      await api.addSsh({ ...charge(), isMainRouter: true });
      setEtape(3);
    } catch (e: any) { setErreur(e.message); }
    finally { setBusy(false); }
  };

  const terminer = async () => {
    setBusy(true); setErreur("");
    try {
      if (data.telegram.enabled) await api.setNotification("telegram", true, data.telegram);
      if (data.email.enabled) await api.setNotification("email", true, data.email);
      if (data.sms.enabled) await api.setNotification("sms", true, data.sms);
      await api.setSetting("topology.autoBuild", data.autoTopology);
      await api.completeSetup();
      setSetupComplete(true);
      api.scan().catch(() => {});
      setTimeout(() => api.autoBuildTopology().catch(() => {}), 5000);
    } catch (e: any) { setErreur(e.message); setBusy(false); }
  };

  // Ce qui manque pour que la vérification ait une chance d'aboutir.
  const incomplet = !r.host || !r.username || (r.useKey && !parApi ? !r.privateKey : !r.password);

  const suivant = () => {
    if (etape === 1) return verifier();
    if (etape === 2) return verdict?.ok ? enregistrer() : setEtape(1);
    if (etape === ETAPES.length - 1) return terminer();
    setEtape((n) => Math.min(ETAPES.length - 1, n + 1));
  };

  const libelle = () => {
    if (etape === 0) return tr("ob.btn.start");
    if (etape === 1) return tr("ob.btn.verify");
    if (etape === 2) return verdict?.ok ? tr("ob.btn.save") : tr("ob.btn.retry");
    if (etape === ETAPES.length - 1) return tr("ob.btn.open");
    return tr("ob.btn.next");
  };

  const bloque = busy || (etape === 1 && incomplet);

  // Passer une étape de canal d'alerte le désactive : sauter n'est pas
  // « garder ce qui est saisi », c'est renoncer pour l'instant.
  const passer = () => {
    const cle = etape === 3 ? "telegram" : etape === 4 ? "email" : "sms";
    maj(cle, { enabled: false });
    setEtape((n) => n + 1);
  };

  return (
    <div className="ob-overlay">
      <style>{CSS}</style>
      <div className="ob-halos" aria-hidden><i/><i/></div>

      <div className="ob-wiz">
        <div className="ob-head">
          <div className="ob-brand">
            <span className="g">{svg(<><circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M10.2 7.4 7 15.7M13.8 7.4 17 15.7M8 18h8"/></>, 19)}</span>
            <div><b>MapMyLAN</b><span>{tr("ob.brand.sub")}</span></div>
            <button className="th" title={tr("ob.theme")} aria-label={tr("ob.theme")}
              onClick={() => setTheme(themeKey === "dark" ? "light" : "dark")}>
              {svg(<><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/></>, 17)}
            </button>
          </div>
          <div className="ob-steps">
            {ETAPES.map((_, i) => (
              <i key={i} className={i < etape ? "done" : i === etape ? "now" : ""}/>
            ))}
          </div>
        </div>

        <div className="ob-body" ref={corps}>
          <section className="ob-step" key={etape}>

            {etape === 0 && (<>
              <h1>{tr("ob.welcome.title")}</h1>
              <p className="sub">{tr("ob.welcome.sub")}</p>
              <ul className="ob-liste">
                {["router", "check", "alerts", "topo"].map((k, i) => (
                  <li key={k}>
                    <span className="c">{i + 1}</span>
                    <span><b style={{ fontWeight: 500 }}>{tr(`ob.welcome.${k}.t`)}</b> {tr(`ob.welcome.${k}.d`)}</span>
                  </li>
                ))}
              </ul>
            </>)}

            {etape === 1 && (<>
              <h1>{tr("ob.router.title")}</h1>
              <p className="sub">{tr("ob.router.sub")}</p>

              <div className="ob-grp">
                <label className="ob-lbl">{tr("ob.router.vendor")}</label>
                <Choix value={r.vendor} options={VENDORS} onChange={(v) => {
                  // Le port suit le transport, tant que l'utilisateur n'a pas
                  // saisi une valeur à lui : 443 pour l'API UniFi, 22 en SSH.
                  const parDefaut = r.port === 22 || r.port === 443;
                  maj("router", { vendor: v, ...(parDefaut ? { port: estApi(v) ? 443 : 22 } : {}) });
                }}/>
              </div>

              <div className="ob-grp">
                <label className="ob-lbl">{tr("ob.router.name")}</label>
                <input className="ob-field sans" value={r.name} onChange={(e) => maj("router", { name: e.target.value })}/>
              </div>

              <div className="ob-grp ob-row3">
                <div>
                  <label className="ob-lbl">{tr("ob.router.host")}</label>
                  <input className="ob-field" value={r.host} placeholder="192.0.2.1"
                    onChange={(e) => maj("router", { host: e.target.value })}/>
                  <div className="ob-hint">{tr("ob.router.hostHint")}</div>
                </div>
                <div>
                  <label className="ob-lbl">{parApi ? tr("ob.router.portApi") : tr("ob.router.portSsh")}</label>
                  <input className="ob-field" inputMode="numeric" value={r.port}
                    onChange={(e) => maj("router", { port: parseInt(e.target.value) || 0 })}/>
                </div>
              </div>

              <div className="ob-grp">
                <label className="ob-lbl">{tr("ob.router.user")}</label>
                <input className="ob-field" value={r.username} onChange={(e) => maj("router", { username: e.target.value })}/>
              </div>

              {parApi && (<>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.router.ctrl")}</label>
                  <input className="ob-field" value={r.apiBaseUrl} placeholder={`https://${r.host || "192.0.2.1"}`}
                    onChange={(e) => maj("router", { apiBaseUrl: e.target.value })}/>
                  <div className="ob-hint">{tr("ob.router.ctrlHint")}</div>
                </div>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.router.site")}</label>
                  <input className="ob-field" value={r.site} placeholder="default"
                    onChange={(e) => maj("router", { site: e.target.value })}/>
                </div>
              </>)}

              {!parApi && (
                <div className="ob-basc">
                  <div className="t"><b>{tr("ob.router.useKey")}</b><p>{tr("ob.router.useKeyHint")}</p></div>
                  <button className={`ob-sw${r.useKey ? " on" : ""}`} aria-pressed={r.useKey}
                    aria-label={tr("ob.router.useKey")}
                    onClick={() => maj("router", { useKey: !r.useKey })}><s/></button>
                </div>
              )}

              {r.useKey && !parApi ? (<>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.router.key")}</label>
                  <textarea className="ob-field" rows={5} value={r.privateKey}
                    placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…"}
                    onChange={(e) => maj("router", { privateKey: e.target.value })}/>
                </div>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.router.passphrase")}</label>
                  <input className="ob-field" type="password" value={r.passphrase}
                    onChange={(e) => maj("router", { passphrase: e.target.value })}/>
                </div>
              </>) : (
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.router.password")}</label>
                  <input className="ob-field" type="password" value={r.password}
                    onChange={(e) => maj("router", { password: e.target.value })}/>
                </div>
              )}

              {parApi && (
                <div className="ob-note">
                  <span className="p">{IcoInfo}</span>
                  <span>{tr("ob.router.unifi")}</span>
                </div>
              )}
            </>)}

            {etape === 2 && (<>
              <h1>{verdict?.ok ? tr("ob.verify.titleOk") : tr("ob.verify.titleKo")}</h1>
              <p className="sub">{tr("ob.verify.sub")}</p>

              <div className="ob-choix">
                <div className={`ob-opt fig ${verdict?.ok ? "on" : "ko"}`}>
                  <span className="ic">{verdict?.ok
                    ? svg(<path d="M5 12.5 10 17.5 19 7"/>, 17)
                    : svg(<><circle cx="12" cy="12" r="8.5"/><path d="M15 9l-6 6M9 9l6 6"/></>, 17)}</span>
                  <div>
                    <b>{verdict?.ok ? tr("ob.verify.ok") : tr("ob.verify.ko")}</b>
                    <p>{verdict?.ok
                      ? (verdict.banner || tr("ob.verify.okNoBanner"))
                      : (verdict?.error || tr("ob.verify.koNoReason"))}</p>
                  </div>
                </div>
              </div>

              {verdict?.ok
                ? <div className="ob-note ok"><span className="p">{IcoBouclier}</span><span>{tr("ob.verify.crypto")}</span></div>
                : <div className="ob-note w"><span className="p">{IcoAlerte}</span><span>{tr("ob.verify.advice")}</span></div>}
            </>)}

            {etape === 3 && (<>
              <h1>{tr("ob.tg.title")}</h1>
              <p className="sub">{tr("ob.tg.sub")}</p>
              <Bascule on={data.telegram.enabled} titre={tr("ob.enable")} note={tr("ob.later")}
                onClick={() => maj("telegram", { enabled: !data.telegram.enabled })}/>
              {data.telegram.enabled && (<>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.tg.token")}</label>
                  <input className="ob-field" type="password" value={data.telegram.token}
                    onChange={(e) => maj("telegram", { token: e.target.value })}/>
                  <div className="ob-hint">{tr("ob.tg.tokenHint")}</div>
                </div>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.tg.chat")}</label>
                  <input className="ob-field" placeholder="-100…" value={data.telegram.chatId}
                    onChange={(e) => maj("telegram", { chatId: e.target.value })}/>
                  <div className="ob-hint">{tr("ob.tg.chatHint")}</div>
                </div>
              </>)}
            </>)}

            {etape === 4 && (<>
              <h1>{tr("ob.mail.title")}</h1>
              <p className="sub">{tr("ob.mail.sub")}</p>
              <Bascule on={data.email.enabled} titre={tr("ob.enable")} note={tr("ob.later")}
                onClick={() => maj("email", { enabled: !data.email.enabled })}/>
              {data.email.enabled && (<>
                <div className="ob-grp">
                  <label className="ob-lbl">{tr("ob.mail.provider")}</label>
                  <Choix value={data.email.provider} options={FOURNISSEURS}
                    onChange={(v) => maj("email", { provider: v })}/>
                </div>
                <div className="ob-grp ob-row2">
                  <div>
                    <label className="ob-lbl">{tr("ob.mail.address")}</label>
                    <input className="ob-field" type="email" placeholder="alertes@exemple.local"
                      value={data.email.address} onChange={(e) => maj("email", { address: e.target.value })}/>
                  </div>
                  <div>
                    <label className="ob-lbl">{tr("ob.mail.password")}</label>
                    <input className="ob-field" type="password" value={data.email.password}
                      onChange={(e) => maj("email", { password: e.target.value })}/>
                  </div>
                </div>
              </>)}
              {/* Deux adresses, deux rôles, et il ne faut pas les confondre :
                  celle-ci ENVOIE, celle de chaque compte REÇOIT. Sans celle-ci,
                  aucun lien ne peut partir et plus personne ne peut
                  réinitialiser son mot de passe. */}
              <div className={`ob-note${data.email.enabled ? "" : " w"}`}>
                <span className="p">{data.email.enabled ? IcoInfo : IcoAlerte}</span>
                <span>{data.email.enabled ? tr("ob.mail.noteOn") : tr("ob.mail.noteOff")}</span>
              </div>
            </>)}

            {etape === 5 && (<>
              <h1>{tr("ob.sms.title")}</h1>
              <p className="sub">{tr("ob.sms.sub")}</p>
              <Bascule on={data.sms.enabled} titre={tr("ob.enable")} note={tr("ob.sms.off")}
                onClick={() => maj("sms", { enabled: !data.sms.enabled })}/>
              {data.sms.enabled ? (<>
                <div className="ob-grp ob-row2">
                  <div>
                    <label className="ob-lbl">{tr("ob.sms.sid")}</label>
                    <input className="ob-field" value={data.sms.sid} onChange={(e) => maj("sms", { sid: e.target.value })}/>
                  </div>
                  <div>
                    <label className="ob-lbl">{tr("ob.sms.token")}</label>
                    <input className="ob-field" type="password" value={data.sms.token}
                      onChange={(e) => maj("sms", { token: e.target.value })}/>
                  </div>
                </div>
                <div className="ob-grp ob-row2">
                  <div>
                    <label className="ob-lbl">{tr("ob.sms.from")}</label>
                    <input className="ob-field" value={data.sms.from} onChange={(e) => maj("sms", { from: e.target.value })}/>
                  </div>
                  <div>
                    <label className="ob-lbl">{tr("ob.sms.to")}</label>
                    <input className="ob-field" value={data.sms.to} onChange={(e) => maj("sms", { to: e.target.value })}/>
                  </div>
                </div>
              </>) : (
                <div className="ob-note"><span className="p">{IcoInfo}</span><span>{tr("ob.sms.note")}</span></div>
              )}
            </>)}

            {etape === 6 && (<>
              <h1>{tr("ob.topo.title")}</h1>
              <p className="sub">{tr("ob.topo.sub")}</p>
              <div className="ob-choix">
                <button className={`ob-opt${data.autoTopology ? " on" : ""}`}
                  onClick={() => setData((d: any) => ({ ...d, autoTopology: true }))}>
                  <span className="ic">{svg(<path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12z"/>, 17)}</span>
                  <div><b>{tr("ob.topo.auto")}</b><p>{tr("ob.topo.autoD")}</p></div>
                </button>
                <button className={`ob-opt${data.autoTopology ? "" : " on"}`}
                  onClick={() => setData((d: any) => ({ ...d, autoTopology: false }))}>
                  <span className="ic">{svg(<><circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M10.2 7.4 7 15.7M13.8 7.4 17 15.7"/></>, 17)}</span>
                  <div><b>{tr("ob.topo.manual")}</b><p>{tr("ob.topo.manualD")}</p></div>
                </button>
              </div>
            </>)}

            {etape === 7 && (<>
              <h1>{tr("ob.done.title")}</h1>
              <p className="sub">{tr("ob.done.sub")}</p>
              <ul className="ob-liste">
                <li><span className="c">✓</span><span>{tr("ob.done.router")}</span></li>
                <li><span className="c">{canaux(data) ? "✓" : "—"}</span><span>{canaux(data) ? tr("ob.done.alerts", { liste: canaux(data) }) : tr("ob.done.noAlerts")}</span></li>
                <li><span className="c">✓</span><span>{data.autoTopology ? tr("ob.done.topoAuto") : tr("ob.done.topoManual")}</span></li>
              </ul>
              <div className="ob-note w">
                <span className="p">{IcoAlerte}</span>
                <span>{tr("ob.done.warn")}</span>
              </div>
            </>)}

            {erreur && (
              <div className="ob-note a"><span className="p">{IcoAlerte}</span><span>{erreur}</span></div>
            )}
          </section>
        </div>

        <div className="ob-foot">
          <button className={`ob-back${etape === 0 || busy ? " vide" : ""}`}
            onClick={() => setEtape((n) => Math.max(0, n - 1))}>
            {svg(<path d="M15 5l-7 7 7 7"/>)}{tr("ob.back")}
          </button>
          {FACULTATIVES.has(etape) && (
            <button className="ob-passer" onClick={passer}>{tr("ob.skip")}</button>
          )}
          <button className="ob-next" onClick={suivant} disabled={bloque}>
            {busy && <span className="ob-spin"/>}
            <span>{libelle()}</span>
            {!busy && svg(<path d="M9 5l7 7-7 7"/>)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Les canaux réellement activés, pour le récapitulatif. */
function canaux(d: any): string {
  const l = [
    d.telegram.enabled && "Telegram",
    d.email.enabled && "courrier",
    d.sms.enabled && "SMS",
  ].filter(Boolean) as string[];
  return l.join(", ");
}

function Bascule({ on, titre, note, onClick }: { on: boolean; titre: string; note?: string; onClick: () => void }) {
  return (
    <div className="ob-basc">
      <div className="t"><b>{titre}</b>{note && <p>{note}</p>}</div>
      <button className={`ob-sw${on ? " on" : ""}`} aria-pressed={on} aria-label={titre} onClick={onClick}><s/></button>
    </div>
  );
}

// Le <select> natif impose le rendu du système : flèche dessinée par l'OS,
// panneau qui ignore le thème. Celui-ci s'ouvre en panneau, montre une ligne
// secondaire par option, et se pilote au clavier.
function Choix({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string; note?: string }[];
  onChange: (v: string) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [vise, setVise] = useState(0);
  const boite = useRef<HTMLDivElement>(null);
  const choisi = options.find((o) => o.value === value);

  useEffect(() => {
    if (!ouvert) return;
    setVise(Math.max(0, options.findIndex((o) => o.value === value)));
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, [ouvert]);

  const clavier = (e: React.KeyboardEvent) => {
    if (!ouvert) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOuvert(true); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOuvert(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setVise((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setVise((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[vise];
      if (o) { onChange(o.value); setOuvert(false); }
    }
  };

  return (
    <div className="ob-sel" ref={boite}>
      <button type="button" className="ob-field sans" onClick={() => setOuvert((v) => !v)} onKeyDown={clavier}
        style={{ display: "flex", alignItems: "center", gap: 9, textAlign: "left", cursor: "pointer",
          borderColor: ouvert ? "var(--accent)" : undefined }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {choisi?.label || value}
        </span>
        <span style={{ color: "var(--muted)", display: "flex", transition: "transform .18s",
          transform: ouvert ? "rotate(180deg)" : "none" }}>
          {svg(<path d="M6 9.5 12 15.5 18 9.5"/>, 14)}
        </span>
      </button>
      {ouvert && (
        <div className="ob-pan" role="listbox">
          {options.map((o, i) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              className={i === vise ? "vise" : ""}
              onMouseEnter={() => setVise(i)}
              onClick={() => { onChange(o.value); setOuvert(false); }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: o.value === value ? 600 : 400,
                  color: o.value === value ? "var(--ink)" : undefined }}>{o.label}</span>
                {o.note && <span className="n">{o.note}</span>}
              </span>
              {o.value === value && <span style={{ color: "var(--accent)" }}>{svg(<path d="M5 12.5 10 17.5 19 7"/>, 13)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

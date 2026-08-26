// Système — réglages et utilisateurs.

import { useEffect, useState } from "react";
import { useStore } from "../stores/app";
import { api } from "../api/client";
import { useT } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { ScanRangesPanel } from "../components/scan/ScanRangesPanel";
import { TotpPanel } from "../components/security/TotpPanel";
import { MailboxPanel } from "../components/mail/MailboxPanel";
import {
  Page, Card, Pad, Btn, Chip, Toggle, WhoCell, Empty, Note, Field, Lbl,
} from "../components/ui/Primitives";
import { fmtDate, depuis } from "./communs";
import { trousseauDisponible, inscrireCle } from "../lib/trousseau";

/** Bloc de réglage : pastille, titre, explication, contenu. */
function Bloc({ icon, titre, texte, extra, children }: {
  icon: string; titre: string; texte?: string; extra?: any; children?: any;
}) {
  return (
    <div className="set">
      <header>
        <span className="tile"><Icon name={icon} size={17}/></span>
        <div><h2>{titre}</h2>{texte && <p>{texte}</p>}</div>
        {extra}
      </header>
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RÉGLAGES
// ════════════════════════════════════════════════════════════════════════════

export function SettingsPage({ t }: { t?: any }) {
  const s = useT();
  const [reglages, setReglages] = useState<Record<string, any>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [infoTrafic, setInfoTrafic] = useState<string | null>(null);

  useEffect(() => { api.settings().then(setReglages).catch(() => {}); }, []);

  const poser = async (cle: string, valeur: any) => {
    try { await api.setSetting(cle, valeur); setReglages(r => ({ ...r, [cle]: valeur })); }
    catch (e: any) { setMessage(e.message); }
  };

  return (
    <Page title={s("page.settings.title")} lede={s("page.settings.lede")}>
      {message && <Note tone="warn">{message}</Note>}

      {/* Plages balayées, double authentification et boîtes mail ont chacune
          leur composant : ils portent la logique métier et les appels d'API. */}
      <ScanRangesPanel t={t}/>
      <TotpPanel t={t}/>
      <MailboxPanel t={t}/>

      <Bloc icon="refresh" titre="Cadence du balayage"
        texte="À quel rythme le parc est parcouru, et sur quel sous-réseau par défaut.">
        <Pad style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12 }}>
            <div>
              <Lbl>Sous-réseau par défaut</Lbl>
              <Field value={reglages["scan.subnet"] || ""} placeholder="192.0.2.0/24"
                onChange={(e: any) => setReglages({ ...reglages, "scan.subnet": e.target.value })}
                onBlur={(e: any) => poser("scan.subnet", e.target.value)}/>
            </div>
            <div>
              <Lbl>Intervalle (secondes)</Lbl>
              <Field type="number" value={reglages["scan.interval"] ?? 300}
                onChange={(e: any) => setReglages({ ...reglages, "scan.interval": parseInt(e.target.value) || 0 })}
                onBlur={(e: any) => poser("scan.interval", parseInt(e.target.value) || 300)}/>
            </div>
          </div>
          <div className="aide">
            Les plages déclarées plus haut sont parcourues l'une après l'autre.
            Deux balayages simultanés saturent la carte réseau et faussent les relevés.
          </div>
        </Pad>
      </Bloc>

      <Bloc icon="globe" titre="Historique du trafic mondial"
        texte="Combien de temps, et jusqu'à quelle taille, les flux sortants relevés sont conservés."
        extra={
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>interroger les registres</span>
            <Toggle on={reglages["world.rdap"] !== false}
              onChange={v => poser("world.rdap", v)}/>
          </span>
        }>
        <Pad style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Lbl>Durée de conservation (jours)</Lbl>
              <Field type="number" value={reglages["world.retentionDays"] ?? 30}
                onChange={(e: any) => setReglages({ ...reglages, "world.retentionDays": parseInt(e.target.value) || 0 })}
                onBlur={(e: any) => poser("world.retentionDays", Math.max(0, parseInt(e.target.value) || 0))}/>
            </div>
            <div>
              <Lbl>Taille maximale (Mo)</Lbl>
              <Field type="number" value={reglages["world.retentionMaxMb"] ?? 0}
                onChange={(e: any) => setReglages({ ...reglages, "world.retentionMaxMb": parseInt(e.target.value) || 0 })}
                onBlur={(e: any) => poser("world.retentionMaxMb", Math.max(0, parseInt(e.target.value) || 0))}/>
            </div>
          </div>
          <div className="aide">
            <b style={{ fontWeight: 500 }}>0</b> dans l'un ou l'autre champ signifie « sans limite ».
            L'âge passe d'abord ; si la taille dépasse encore, les flux les plus anciennement
            vus sont retirés jusqu'à repasser dessous. La taille mesurée est celle des données
            conservées, pas celle du fichier sur le disque — Postgres réutilise la place libérée
            au lieu de la rendre.
          </div>
          <div className="aide">
            L'interrogation des registres identifie les destinations qui n'ont pas de nom
            d'hôte. Coupée, elles restent affichées par leur adresse : leurs adresses ne
            sortent alors jamais de ton réseau.
          </div>
          <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
            <Btn icon="refresh" onClick={async () => {
              const r = await api.trafficPurge().catch(() => null);
              if (r) setInfoTrafic(`${r.parAge + r.parTaille} flux retirés · ${r.mo.toFixed(2)} Mo conservés`);
            }}>Purger maintenant</Btn>
            <Btn icon="trash" onClick={async () => {
              if (!confirm("Effacer tout l'historique du trafic ? Les flux relevés disparaissent définitivement ; la collecte reprend au relevé suivant.")) return;
              const r = await api.trafficClear().catch(() => null);
              if (r) setInfoTrafic(`${r.supprimes} flux effacés`);
            }}>Tout effacer</Btn>
            {infoTrafic && (
              <span style={{ alignSelf: "center", fontSize: 11.5, color: "var(--muted)" }}>{infoTrafic}</span>
            )}
          </div>
        </Pad>
      </Bloc>

      <Bloc icon="map" titre="Carte"
        texte="La reconstruction automatique déduit les liaisons à partir des relevés."
        extra={
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <Toggle on={reglages["topology.autoBuild"] !== false}
              onChange={v => poser("topology.autoBuild", v)}/>
          </span>
        }>
        <Pad style={{ paddingTop: 4 }}>
          <div className="aide">
            Désactivée, le bouton « Reconstruire » de la carte ne fait plus rien :
            les liaisons que tu as tracées à la main restent alors intactes.
          </div>
        </Pad>
      </Bloc>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// UTILISATEURS
// ════════════════════════════════════════════════════════════════════════════

const ETIQUETTE_ROLE: Record<string, string> = {
  admin: "Administrateur — tous droits, y compris les comptes",
  operator: "Opérateur — pilote l'équipement et la console",
  viewer: "Lecteur — consultation seule",
};

export function UsersPage(_props: { t?: any }) {
  const s = useT();
  const user = useStore(st => st.user);
  const [ancien, setAncien] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirme, setConfirme] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [a2f, setA2f] = useState<{ totpEnabled: boolean; telegramReady: boolean } | null>(null);

  const [comptes, setComptes] = useState<any[]>([]);
  const [roles, setRoles] = useState<string[]>(["admin", "operator", "viewer"]);
  const [verrou, setVerrou] = useState<{ verrouille: boolean; peutVerrouiller: boolean }>({
    verrouille: false, peutVerrouiller: false,
  });
  const [code, setCode] = useState("");
  const [ouvertCreation, setOuvertCreation] = useState(false);
  const [neuf, setNeuf] = useState({ username: "", password: "", role: "viewer" });
  const [renomme, setRenomme] = useState<{ id: string; valeur: string } | null>(null);
  const [alerte, setAlerte] = useState<{ ok: boolean; texte: string } | null>(null);
  // Fiche du compte ouvert : c'est là que se règle son second facteur.
  const [fiche, setFiche] = useState<any>(null);

  const charger = async () => {
    try {
      const r = await api.users();
      setComptes(r.comptes); setRoles(r.roles);
      setVerrou(await api.usersLockState());
    } catch (e: any) { setAlerte({ ok: false, texte: e.message }); }
  };
  useEffect(() => { api.totpStatus().then(setA2f).catch(() => {}); charger(); }, []);

  const dire = (ok: boolean, texte: string) => setAlerte({ ok, texte });

  const creer = async () => {
    try {
      await api.userCreate(neuf);
      setNeuf({ username: "", password: "", role: "viewer" });
      setOuvertCreation(false);
      dire(true, "Compte créé. Il devra choisir son mot de passe à la première connexion.");
      charger();
    } catch (e: any) { dire(false, e.message); }
  };

  const validerNom = async () => {
    if (!renomme) return;
    try {
      await api.userUpdate(renomme.id, { username: renomme.valeur });
      setRenomme(null);
      dire(true, "Identifiant modifié. Les sessions ouvertes de ce compte sont fermées.");
      charger();
    } catch (e: any) { dire(false, e.message); }
  };

  const changerRole = async (c: any, role: string) => {
    try {
      await api.userUpdate(c.id, { role });
      dire(true, `${c.username} est maintenant ${role}.`);
      charger();
    } catch (e: any) { dire(false, e.message); }
  };

  const reinitialiser = async (c: any) => {
    const mdp = prompt(`Nouveau mot de passe pour ${c.username} — huit caractères au minimum.\nIl devra le changer à sa première connexion.`);
    if (!mdp) return;
    try {
      await api.userPassword(c.id, mdp);
      dire(true, `Mot de passe remis à zéro pour ${c.username}. Ses sessions sont fermées.`);
      charger();
    } catch (e: any) { dire(false, e.message); }
  };

  const supprimer = async (c: any) => {
    if (!confirm(`Supprimer le compte ${c.username} ? Cette action est définitive.`)) return;
    try {
      await api.userDelete(c.id);
      dire(true, `Compte ${c.username} supprimé.`);
      charger();
    } catch (e: any) { dire(false, e.message); }
  };

  const verrouiller = async () => {
    try { await api.usersLock(); dire(true, "Création de comptes verrouillée."); charger(); }
    catch (e: any) { dire(false, e.message); }
  };

  const deverrouiller = async () => {
    try {
      await api.usersUnlock(code.trim());
      setCode(""); dire(true, "Création de comptes déverrouillée.");
      charger();
    } catch (e: any) { dire(false, e.message); }
  };

  const changer = async () => {
    if (nouveau !== confirme) return setMessage({ ok: false, texte: "Les deux saisies diffèrent." });
    if (nouveau.length < 8) return setMessage({ ok: false, texte: "Huit caractères au minimum." });
    try {
      await api.changePassword(ancien, nouveau);
      setMessage({ ok: true, texte: "Mot de passe changé. Les autres sessions sont fermées." });
      setAncien(""); setNouveau(""); setConfirme("");
    } catch (e: any) { setMessage({ ok: false, texte: e.message }); }
  };

  return (
    <Page title={s("page.users.title")} lede={s("page.users.lede")}
      actions={
        <Btn solid icon="plus" disabled={verrou.verrouille}
          onClick={() => setOuvertCreation(o => !o)}>Ajouter un compte</Btn>
      }>

      {alerte && <Note tone={alerte.ok ? "info" : "warn"}>{alerte.texte}</Note>}

      {ouvertCreation && !verrou.verrouille && (
        <Card title="Nouveau compte">
          <Pad style={{ paddingTop: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><Lbl>Identifiant</Lbl>
                <Field value={neuf.username} placeholder="prenom.nom"
                  onChange={(e: any) => setNeuf({ ...neuf, username: e.target.value })}/></div>
              <div><Lbl>Mot de passe provisoire</Lbl>
                <Field type="password" value={neuf.password}
                  onChange={(e: any) => setNeuf({ ...neuf, password: e.target.value })}/></div>
              <div><Lbl>Rôle</Lbl>
                <select className="field" value={neuf.role}
                  onChange={e => setNeuf({ ...neuf, role: e.target.value })}>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </select></div>
            </div>
            <div className="aide">{ETIQUETTE_ROLE[neuf.role]}</div>
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 14 }}>
              <Btn onClick={() => setOuvertCreation(false)}>{s("action.cancel")}</Btn>
              <Btn solid icon="check" onClick={creer}
                disabled={!neuf.username || neuf.password.length < 8}>Créer</Btn>
            </div>
          </Pad>
        </Card>
      )}

      <Card title={s("card.accounts")} note={`${comptes.length}`}>
        <table>
          <thead><tr>
            <th>{s("col.account")}</th><th>{s("col.role")}</th>
            <th>{s("col.auth")}</th><th>{s("col.state")}</th><th/>
          </tr></thead>
          <tbody>
            {comptes.map(c => {
              const moi = c.id === user?.id;
              // Le compte d'installation garde ses droits : le sélecteur est
              // figé et la suppression n'est pas proposée. Le serveur refuse de
              // toute façon, mais proposer un geste qui sera rejeté est une
              // façon de mentir sur ce qui est possible.
              const fondateur = !!c.fondateur;
              return (
                <tr key={c.id}>
                  <td>
                    {renomme && renomme.id === c.id ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Field value={renomme.valeur} autoFocus
                          onChange={(e: any) => setRenomme({ id: c.id, valeur: e.target.value })}
                          onKeyDown={(e: any) => {
                            if (e.key === "Enter") validerNom();
                            if (e.key === "Escape") setRenomme(null);
                          }}/>
                        <Btn icon="check" onClick={validerNom}>Valider</Btn>
                        <button className="lnk" onClick={() => setRenomme(null)}>annuler</button>
                      </div>
                    ) : (
                      <button className="lnk" style={{ padding: 0, textAlign: "left" }}
                        onClick={() => setFiche(fiche?.id === c.id ? null : c)}
                        title="Ouvrir la fiche du compte">
                        <WhoCell icon={String(c.username).slice(0, 2).toUpperCase()}
                          name={c.username}
                          sub={moi ? "session en cours" : (c.lastLogin ? `vu ${depuis(c.lastLogin)}` : "jamais connecté")}/>
                      </button>
                    )}
                  </td>
                  <td>
                    {fondateur ? (
                      <span title="Compte d'installation : son rôle ne change pas.">
                        <Chip tone="a">admin · d'origine</Chip>
                      </span>
                    ) : (
                      <select className="field" style={{ width: 130 }} value={c.role}
                        onChange={e => changerRole(c, e.target.value)}>
                        {roles.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      <Chip>mot de passe</Chip>
                      {c.a2f?.cles > 0 && <Chip tone="a">trousseau ×{c.a2f.cles}</Chip>}
                      {c.a2f?.application && <Chip tone="a">application</Chip>}
                      {c.a2f?.exigee && !c.a2f?.moyens?.length && <Chip tone="w">A2F exigée</Chip>}
                    </span>
                  </td>
                  <td>
                    {c.verrouilleJusqua && new Date(c.verrouilleJusqua) > new Date()
                      ? <Chip tone="w">bloqué</Chip>
                      : c.mustChangePassword
                        ? <Chip tone="w">mot de passe à changer</Chip>
                        : <Chip tone="a">actif</Chip>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="lnk" onClick={() => setRenomme({ id: c.id, valeur: c.username })}>renommer</button>
                    <button className="lnk" onClick={() => reinitialiser(c)}>mot de passe</button>
                    {!moi && !fondateur &&
                      <button className="lnk" onClick={() => supprimer(c)}>supprimer</button>}
                  </td>
                </tr>
              );
            })}
            {comptes.length === 0 && (
              <tr><td colSpan={5}><Empty text="Aucun compte" icon="user"/></td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {fiche && (
        <FicheCompte compte={fiche} moi={fiche.id === user?.id}
          onFerme={() => setFiche(null)}
          onChange={charger}
          dire={dire}/>
      )}

      {/* Le verrou est volontairement asymétrique : le poser ne coûte rien, le
          lever exige un code. C'est ce qui le rend utile — une session
          d'administrateur détournée ne peut pas se fabriquer un second compte
          pour revenir plus tard. */}
      <Card title="Création de comptes"
        note={verrou.verrouille ? "verrouillée" : "ouverte"}>
        <Pad style={{ paddingTop: 4 }}>
          {verrou.verrouille ? (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ width: 180 }}>
                  <Lbl>Code du second facteur</Lbl>
                  <Field value={code} placeholder="123456" inputMode="numeric"
                    onChange={(e: any) => setCode(e.target.value)}
                    onKeyDown={(e: any) => e.key === "Enter" && deverrouiller()}/>
                </div>
                <Btn solid icon="key" onClick={deverrouiller} disabled={code.trim().length < 6}>
                  Déverrouiller
                </Btn>
              </div>
              <div className="aide">
                Aucun compte ne peut être créé tant que ce verrou est posé. Le lever demande
                un code de ton application d'authentification — le mot de passe seul ne suffit pas.
              </div>
            </>
          ) : (
            <>
              <Btn icon="shield" onClick={verrouiller} disabled={!verrou.peutVerrouiller}>
                Verrouiller la création
              </Btn>
              <div className="aide">
                {verrou.peutVerrouiller
                  ? "Une fois posé, le verrou ne se lève qu'avec un code du second facteur."
                  : "Active d'abord la double authentification sur ton compte, dans Réglages. Sans elle, le verrou ne pourrait plus être levé."}
              </div>
            </>
          )}
        </Pad>
      </Card>

      <Card title="Changer de mot de passe">
        <Pad style={{ paddingTop: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, maxWidth: 640 }}>
            <div><Lbl>Mot de passe actuel</Lbl>
              <Field type="password" value={ancien} onChange={(e: any) => setAncien(e.target.value)}/></div>
            <div><Lbl>Nouveau</Lbl>
              <Field type="password" value={nouveau} onChange={(e: any) => setNouveau(e.target.value)}/></div>
            <div><Lbl>Confirmation</Lbl>
              <Field type="password" value={confirme} onChange={(e: any) => setConfirme(e.target.value)}/></div>
          </div>
          {message && <div style={{ marginTop: 14 }}>
            <Note tone={message.ok ? "info" : "warn"}>{message.texte}</Note>
          </div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <Btn solid icon="key" onClick={changer} disabled={!ancien || !nouveau}>{s("action.save")}</Btn>
          </div>
        </Pad>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Note>{s("misc.usersWarn")} Un changement de mot de passe coupe toutes les sessions ouvertes.</Note>
      </div>
    </Page>
  );
}


/**
 * Fiche d'un compte : ce que vaut son second facteur, et ce qu'on peut y faire.
 *
 * La règle centrale tient en une phrase : **on ne s'inscrit pas à la place de
 * quelqu'un.** Le secret d'un second facteur vit sur l'appareil de son porteur.
 * Un administrateur peut donc exiger un facteur, ou révoquer ceux qui existent ;
 * il ne peut pas en poser un. Sur sa propre fiche, en revanche, il inscrit ce
 * qu'il veut — clé d'accès depuis cette page, application depuis les Réglages.
 */
function FicheCompte({ compte, moi, onFerme, onChange, dire }: any) {
  const [etat, setEtat] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  // Inscription Telegram : l'identifiant de discussion, puis le code reçu.
  const [chat, setChat] = useState("");
  const [codeTg, setCodeTg] = useState("");
  const [codeEnvoye, setCodeEnvoye] = useState(false);

  const relire = async () => {
    try { setEtat(await api.userMfa(compte.id)); } catch { /* la liste suffit */ }
  };
  useEffect(() => { relire(); }, [compte.id]);

  const ajouterCle = async () => {
    setBusy(true);
    try {
      const options = await api.mfaPasskeyOptions();
      const reponse = await inscrireCle(options);
      const nom = prompt("Nom de cette clé — pour la reconnaître plus tard.", "Mon appareil");
      await api.mfaPasskeyEnregistrer(reponse, nom || "Clé d'accès");
      dire(true, "Clé d'accès ajoutée. Elle sera demandée à la prochaine connexion.");
      await relire(); onChange();
    } catch (e: any) {
      dire(false, e?.message || "La clé n'a pas été créée.");
    } finally { setBusy(false); }
  };

  const retirerCle = async (id: string) => {
    if (!confirm("Retirer cette clé d'accès ?")) return;
    try { await api.mfaPasskeySupprimer(id); await relire(); onChange(); dire(true, "Clé retirée."); }
    catch (e: any) { dire(false, e.message); }
  };

  const envoyerCode = async () => {
    setBusy(true);
    try {
      await api.mfaTelegramCode(chat.trim());
      setCodeEnvoye(true); setCodeTg("");
      dire(true, "Code envoyé sur Telegram. Il vaut cinq minutes.");
    } catch (e: any) { dire(false, e?.message || "Le code n'est pas parti."); }
    finally { setBusy(false); }
  };

  const lierTelegram = async () => {
    setBusy(true);
    try {
      await api.mfaTelegramLier(codeTg.trim());
      setCodeEnvoye(false); setChat(""); setCodeTg("");
      dire(true, "Telegram lié. Un code y sera demandé à la prochaine connexion.");
      await relire(); onChange();
    } catch (e: any) { dire(false, e?.message || "Code refusé."); }
    finally { setBusy(false); }
  };

  const delierTelegram = async () => {
    if (!confirm("Retirer Telegram comme second facteur ?")) return;
    try {
      await api.mfaTelegramDelier();
      await relire(); onChange(); dire(true, "Telegram retiré.");
    } catch (e: any) { dire(false, e.message); }
  };

  const exiger = async (valeur: boolean) => {
    try {
      await api.userMfaExiger(compte.id, valeur);
      await relire(); onChange();
      dire(true, valeur
        ? "Second facteur exigé. Il sera réclamé à la prochaine connexion de ce compte."
        : "Second facteur rendu facultatif.");
    } catch (e: any) { dire(false, e.message); }
  };

  const revoquer = async () => {
    if (!confirm(`Révoquer tous les seconds facteurs de ${compte.username} ? Ses sessions seront fermées et il devra en réinscrire un.`)) return;
    try {
      await api.userMfaRevoquer(compte.id);
      await relire(); onChange();
      dire(true, "Seconds facteurs révoqués, sessions fermées.");
    } catch (e: any) { dire(false, e.message); }
  };

  return (
    <Card title={`Compte · ${compte.username}`}
      note={moi ? "c'est toi" : compte.fondateur ? "compte d'installation" : compte.role}>
      <Pad style={{ paddingTop: 4 }}>
        <Lbl>Second facteur</Lbl>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 12px" }}>
          {etat?.moyens?.length
            ? etat.moyens.map((m: string) => (
                <Chip key={m} tone="a">
                  {m === "trousseau" ? "clé d'accès" : m === "telegram" ? "Telegram" : "application"}
                </Chip>
              ))
            : <Chip tone={etat?.exigee ? "w" : undefined}>
                {etat?.exigee ? "exigé, pas encore inscrit" : "aucun"}
              </Chip>}
        </div>

        {etat?.listeCles?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {etat.listeCles.map((k: any) => (
              <div key={k.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
                borderTop: "1px solid var(--hair-soft)", fontSize: 12.5,
              }}>
                <Icon name="key" size={14}/>
                <b style={{ fontWeight: 500 }}>{k.label || "Clé d'accès"}</b>
                <span style={{ color: "var(--faint)", fontFamily: "var(--mono)", fontSize: 11 }}>
                  ajoutée {depuis(k.createdAt)}
                  {k.lastUsed ? ` · utilisée ${depuis(k.lastUsed)}` : " · jamais utilisée"}
                </span>
                {moi && (
                  <button className="lnk" style={{ marginLeft: "auto" }}
                    onClick={() => retirerCle(k.id)}>retirer</button>
                )}
              </div>
            ))}
          </div>
        )}

        {moi && etat && (
          <div style={{ borderTop: "1px solid var(--hair-soft)", paddingTop: 12, marginBottom: 14 }}>
            <Lbl>Telegram</Lbl>
            {etat.telegram ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 12.5 }}>
                <Icon name="bot" size={14}/>
                <b style={{ fontWeight: 500 }}>Discussion liée</b>
                <span style={{ color: "var(--faint)", fontFamily: "var(--mono)", fontSize: 11 }}>
                  {etat.chatMasque}
                </span>
                <button className="lnk" style={{ marginLeft: "auto" }}
                  onClick={delierTelegram}>retirer</button>
              </div>
            ) : !etat.botTelegram ? (
              <div className="aide" style={{ marginTop: 6 }}>
                Le bot Telegram n'est pas configuré sur cette instance : sans jeton, aucun
                code ne peut partir. Il se règle dans <b style={{ fontWeight: 500 }}>Réglages
                → Notifications</b>.
              </div>
            ) : !codeEnvoye ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Field value={chat} inputMode="numeric"
                    onChange={(e: any) => setChat(e.target.value)}
                    placeholder="Identifiant de discussion" style={{ flex: "1 1 200px" }}/>
                  <Btn icon="arrow" onClick={envoyerCode} disabled={busy || chat.trim().length < 5}>
                    {busy ? "Envoi…" : "Envoyer un code"}
                  </Btn>
                </div>
                <div className="aide">
                  L'identifiant de ta discussion avec le bot : écris-lui{" "}
                  <b style={{ fontWeight: 500 }}>/start</b>, il te le donne. Rien n'est
                  enregistré tant que le code parti là-bas n'est pas revenu ici — c'est ce
                  qui empêche de désigner la discussion de quelqu'un d'autre.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Field value={codeTg} inputMode="numeric" autoFocus
                    onChange={(e: any) => setCodeTg(e.target.value)}
                    placeholder="123456" style={{ flex: "1 1 140px" }}/>
                  <Btn solid onClick={lierTelegram} disabled={busy || codeTg.trim().length < 6}>
                    {busy ? "Vérification…" : "Confirmer"}
                  </Btn>
                  <Btn onClick={() => { setCodeEnvoye(false); setCodeTg(""); }}>Annuler</Btn>
                </div>
                <div className="aide">Le code vaut cinq minutes, et cinq essais.</div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {moi && (
            <Btn solid icon="key" onClick={ajouterCle} disabled={busy || !trousseauDisponible()}>
              {busy ? "En attente…" : "Ajouter une clé d'accès"}
            </Btn>
          )}
          <Btn icon="shield" onClick={() => exiger(!etat?.exigee)}>
            {etat?.exigee ? "Ne plus exiger" : "Exiger un second facteur"}
          </Btn>
          {(etat?.moyens?.length > 0) && (
            <Btn icon="ban" onClick={revoquer}>Révoquer les facteurs</Btn>
          )}
          <Btn onClick={onFerme}>Fermer</Btn>
        </div>

        <div className="aide">
          {moi
            ? <>La clé d'accès s'ajoute ici : Touch ID, Face ID, trousseau iCloud ou clé USB.
                Telegram aussi, juste au-dessus — plus commode, mais plus faible : le code
                passe par un service tiers. Le code à six chiffres, lui, se règle dans{" "}
                <b style={{ fontWeight: 500 }}>Réglages → Double authentification</b>.</>
            : <>On ne peut pas inscrire un second facteur à la place de quelqu'un : son secret
                vit sur son appareil. Ce qui est possible ici, c'est l'exiger — il sera réclamé
                à sa prochaine connexion — ou révoquer ce qu'il a déjà.</>}
        </div>
        {!moi && !trousseauDisponible() && null}
        {moi && !trousseauDisponible() && (
          <div className="aide">
            Les clés d'accès demandent une origine sûre : ouvre MapMyLAN en HTTPS pour
            pouvoir en ajouter une.
          </div>
        )}
      </Pad>
    </Card>
  );
}

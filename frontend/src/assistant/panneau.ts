// Le panneau de l'assistant — le même que celui du Hub : à droite, par-dessus
// la page ; un onglet ✦ sort du bord droit quand la souris y reste une
// seconde ; le micro passe en mode vocal (VOX), où l'orbe écoute et la
// réponse est dite, avec les seuls widgets dans le fil.
//
// Il se dessine hors de React, comme dans le Hub : le même balisage, la même
// feuille (./assistant.css), les mêmes gestes. React ne fait que le monter.

import "./assistant.css";
import { api } from "../api/client";
import { I } from "./icones";
import { esc, rendu, widgetHtml, brancherBulle } from "./rendu";
import { basculerVoix, monter as monterVoix, tourVocal, rejouer, arreter as arreterVoix, brancher as brancherVoix } from "./voix";

const S: {
  ouvert: boolean; occupe: boolean; demande: string; erreur: string; dernierEnvoi: { texte: string; t: number } | null;
  relances: string[];
} = { ouvert: false, occupe: false, demande: "", erreur: "", dernierEnvoi: null, relances: [] };

const auditeurs = new Set<(ouvert: boolean) => void>();
/** Pour le bouton de la barre du haut : il s'allume quand le panneau est ouvert. */
export function suivre(fn: (ouvert: boolean) => void): () => void { auditeurs.add(fn); fn(S.ouvert); return () => auditeurs.delete(fn); }

export function basculer(): void {
  S.ouvert = !S.ouvert;
  if (!S.ouvert) arreterVoix();
  const p = document.getElementById("aiaPanel");
  if (S.ouvert && !p) {
    const el = document.createElement("aside");
    el.id = "aiaPanel"; el.className = "aia"; el.setAttribute("aria-label", "Assistant");
    document.body.appendChild(el);
    dessiner().then(() => (document.getElementById("aiaIn") as HTMLInputElement | null)?.focus());
  } else if (!S.ouvert) p?.remove();
  document.getElementById("aiaBord")?.classList.remove("vu");
  auditeurs.forEach(f => f(S.ouvert));
}

brancherVoix({
  apresReponse: () => { void dessiner(); },
  signaler: m => { S.erreur = m; void dessiner(); },
});

async function dessiner(): Promise<void> {
  const panel = document.getElementById("aiaPanel");
  if (!panel) return;
  let etat: any = { fil: [], ia: { prete: false, modele: null }, relances: [], encours: false };
  try { etat = await api.assistant(); } catch (e: any) { S.erreur = S.erreur || e?.message || String(e); }
  if (!panel.isConnected) return;
  S.relances = etat.relances || [];
  if (etat.encours && !S.occupe) S.occupe = true;
  const fil: any[] = etat.fil || [];
  const sous = etat.ia?.prete ? `${esc(etat.ia.modele)} · lecture seule` : "sans modèle · réponses directes";

  panel.innerHTML = `
    <header><span class="itile ink">${I("sparkle")}</span><div class="grow"><b>Assistant</b><small>${sous}</small></div>
      <button class="ghost" id="aiaVoixBtn" title="Parler à l’assistant — il répond à voix haute (VOX)" aria-label="Mode vocal">${I("mic", 14)}</button>
      <button class="ghost" id="aiaNew" title="Nouvelle conversation — repart à vide" aria-label="Nouvelle conversation">${I("plus", 14)}</button>
      <button class="ghost" id="aiaClose" aria-label="Fermer">${I("x", 14)}</button></header>
    <div class="msgs" id="aiaMsgs">
      ${fil.length ? fil.map(p => `${p.voix ? "" : `<div class="m u">${esc(p.request)}</div>`}
        <div class="m a${p.widgets?.length || p.voix ? " large" : ""}${p.voix ? " vocal" : ""}">${p.voix
          ? tourVocal(p, (p.widgets || []).map(widgetHtml).join(""))
          : rendu(p.reply) + (p.widgets || []).map(widgetHtml).join("")}
          <div class="pied">${p.voix ? `<button class="lienfin" data-rejouer="${esc(p.id)}" title="Réentendre la réponse">${I("play", 11)} Réécouter</button>` : ""}${p.duree != null ? `<small class="duree" title="Temps de réponse">${p.duree < 1000 ? "< 1 s" : `${Math.round(p.duree / 1000)} s`}${p.modele ? ` · ${esc(p.modele)}` : ""}</small>` : ""}</div>
        </div>`).join("")
        : `<div class="m a aia-accueil"><b>Pose-moi une question sur ton réseau.</b>Les nouveaux appareils, les alertes, ce qui est exposé, ce qui ne répond plus, un appareil par son adresse. Je lis le réseau, je ne change rien.</div>`}
      ${S.demande ? `<div class="m u">${esc(S.demande)}</div>` : ""}
      ${S.erreur ? `<div class="m a"><span class="err">${esc(S.erreur)}</span></div>` : ""}
      ${S.occupe ? `<div class="m a"><span class="typing"><span></span><span></span><span></span></span></div>` : ""}
    </div>
    <div class="sugg">${S.occupe ? "" : S.relances.map((s, i) => `<button type="button" data-sugg="${i}">${I("sparkle", 13)}<span>${esc(s)}</span></button>`).join("")}</div>
    <form id="aiaForm"><input id="aiaIn" placeholder="Demande quelque chose…" autocomplete="off" aria-label="Question" ${S.occupe ? "disabled" : ""}>${S.occupe
      ? `<button class="btn sm" type="button" id="aiaStop" aria-label="Arrêter">${I("x", 14)}Arrêter</button>`
      : `<button class="btn solid sm" aria-label="Envoyer">${I("arrow", 14)}</button>`}</form>`;

  const ms = panel.querySelector("#aiaMsgs") as HTMLElement; ms.scrollTop = ms.scrollHeight;
  (panel.querySelector("#aiaClose") as HTMLElement).onclick = basculer;
  (panel.querySelector("#aiaNew") as HTMLElement).onclick = async () => {
    try { await api.assistantOublier(); S.erreur = ""; S.demande = ""; } catch (e: any) { S.erreur = e?.message; }
    void dessiner();
  };
  (panel.querySelector("#aiaForm") as HTMLFormElement).onsubmit = e => { e.preventDefault(); void demander((panel.querySelector("#aiaIn") as HTMLInputElement).value); };
  const stop = panel.querySelector("#aiaStop") as HTMLElement | null;
  if (stop) stop.onclick = () => { api.assistantArreter().catch(() => {}); };
  panel.querySelectorAll<HTMLElement>("[data-sugg]").forEach(b => { b.onclick = () => void demander(S.relances[Number(b.dataset.sugg)]); });
  panel.querySelectorAll<HTMLElement>("[data-rejouer]").forEach(b => { b.onclick = () => { const p = fil.find(x => x.id === b.dataset.rejouer); rejouer(p?.parole || p?.reply); }; });
  (panel.querySelector("#aiaVoixBtn") as HTMLElement).onclick = () => { basculerVoix().catch((e: any) => { S.erreur = e?.message; void dessiner(); }); };
  monterVoix();
}

async function demander(texte: string): Promise<void> {
  const t = texte.trim();
  if (!t || S.occupe) return;
  // Le même texte deux fois en trois secondes : un double envoi, pas une deuxième question.
  if (S.dernierEnvoi?.texte === t && Date.now() - S.dernierEnvoi.t < 3000) return;
  S.dernierEnvoi = { texte: t, t: Date.now() };
  Object.assign(S, { occupe: true, demande: t, erreur: "" });
  await dessiner();
  try { await api.assistantDemander(t); S.demande = ""; }
  catch (e: any) { S.erreur = e?.message || String(e); }   // la question reste affichée au-dessus
  S.occupe = false;
  await dessiner();
  (document.getElementById("aiaIn") as HTMLInputElement | null)?.focus();
}

/* Bord droit : la souris collée au bord une seconde fait sortir un petit
   onglet ✦ à sa hauteur ; un clic ouvre l'assistant. Il rentre dès qu'on
   s'éloigne. Rien sur un écran tactile, ni quand l'assistant est ouvert. */
let bordBranche = false;
export function brancherBord(): () => void {
  brancherBulle();
  if (bordBranche) return () => {};
  bordBranche = true;
  let minuteur: ReturnType<typeof setTimeout> | null = null, rentre: ReturnType<typeof setTimeout> | undefined, derniere = { x: 0, y: 0 };
  const largeur = () => Math.min(innerWidth, document.documentElement.clientWidth || innerWidth);
  const auBord = (x: number) => largeur() - x <= 8;
  const masquer = () => document.getElementById("aiaBord")?.classList.remove("vu");
  const onglet = () => {
    let b = document.getElementById("aiaBord");
    if (b) return b;
    b = document.createElement("button");
    b.id = "aiaBord"; b.className = "aibord"; b.title = "Assistant"; b.setAttribute("aria-label", "Ouvrir l’assistant");
    b.innerHTML = I("sparkle", 18);
    b.onclick = () => { masquer(); if (!S.ouvert) basculer(); };
    b.onmouseenter = () => clearTimeout(rentre);
    b.onmouseleave = () => { clearTimeout(rentre); rentre = setTimeout(masquer, 700); };
    document.body.appendChild(b);
    return b;
  };
  const montrer = () => {
    if (S.ouvert || !document.querySelector(".app") || !auBord(derniere.x)) return;
    const b = onglet();
    b.style.top = `${Math.max(70, Math.min(innerHeight - 70, derniere.y)) - 22}px`;
    b.classList.add("vu");
  };
  const bouge = (e: MouseEvent) => {
    derniere = { x: e.clientX, y: e.clientY };
    if (auBord(e.clientX)) {
      if (!minuteur && !S.ouvert) minuteur = setTimeout(() => { minuteur = null; montrer(); }, 1000);
    } else {
      if (minuteur) clearTimeout(minuteur);
      minuteur = null;
      if (document.getElementById("aiaBord")?.classList.contains("vu") && largeur() - e.clientX > 90) { clearTimeout(rentre); rentre = setTimeout(masquer, 700); }
    }
  };
  document.addEventListener("mousemove", bouge, { passive: true });
  return () => {
    document.removeEventListener("mousemove", bouge);
    document.getElementById("aiaBord")?.remove();
    document.getElementById("aiaPanel")?.remove();
    arreterVoix();
    S.ouvert = false;
    bordBranche = false;
  };
}

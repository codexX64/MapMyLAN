// Mise en page des réponses et dessin des widgets — la même que dans le Hub.
//
// Tout est échappé d'abord : aucune balise écrite par le modèle ne passe,
// seules celles posées ici. Les chiffres des widgets viennent du serveur
// (photo prise au moment de la réponse) ; on ne fait que dessiner, et une
// couleur ne dit jamais seule l'état : le mot ou le nombre est à côté.

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Puces, listes numérotées, petits titres, gras — comme les réponses du Hub. */
export function rendu(texte: string): string {
  let t = String(texte || "").replace(/\r/g, "").trim();
  // Les puces qu'un petit modèle écrit à la suite (« … : - a - b ») sont remises une par ligne.
  if ((t.match(/(^|\s)[-•]\s+(?=[A-ZÀ-Ý*«"0-9])/g) || []).length >= 2) t = t.replace(/\s+[-•]\s+(?=[A-ZÀ-Ý*«"0-9])/g, "\n- ");
  const enLigne = (x: string) => esc(x).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  let html = "", liste: "ul" | "ol" | null = null;
  const ferme = () => { if (liste) { html += `</${liste}>`; liste = null; } };
  // Un tableau (« | a | b | ») : la première ligne est l'en-tête, la ligne de tirets est sautée.
  let tableau: string[][] = [];
  const cellules = (l: string) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
  const videTableau = () => {
    if (!tableau.length) return;
    const [tete, ...corps] = tableau;
    html += `<div class="md-tab"><table><thead><tr>${tete.map(c => `<th>${enLigne(c)}</th>`).join("")}</tr></thead><tbody>${corps.map(r => `<tr>${tete.map((_, i) => `<td>${enLigne(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    tableau = [];
  };
  for (const brut of t.split("\n")) {
    const l = brut.trim();
    if (/^\|.*\|$/.test(l)) { ferme(); if (!/^\|[\s:|-]+\|$/.test(l)) tableau.push(cellules(l)); continue; }
    videTableau();
    if (!l) { ferme(); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^[-•*]\s+(.*)$/.exec(l))) { if (liste !== "ul") { ferme(); html += '<ul class="md">'; liste = "ul"; } html += `<li>${enLigne(m[1])}</li>`; continue; }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) { if (liste !== "ol") { ferme(); html += '<ol class="md">'; liste = "ol"; } html += `<li>${enLigne(m[1])}</li>`; continue; }
    ferme();
    if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { html += `<div class="md-t">${enLigne(m[1])}</div>`; continue; }
    if ((m = /^\*\*([^*]{2,50}?)\s*:?\s*\*\*\s*:?$/.exec(l))) { html += `<div class="md-t">${esc(m[1])}</div>`; continue; }
    html += `<p class="md-p">${enLigne(l)}</p>`;
  }
  ferme();
  videTableau();
  return html;
}

const n = (v: unknown) => Number(v || 0).toLocaleString("fr-FR");

export function widgetHtml(w: any): string {
  const tete = `<div class="wg-t">${esc(w.titre || "")}</div>`;
  if (w.type === "stats") {
    return `<div class="wg">${tete}<div class="wg-tuiles">${w.tuiles.map((t: any) =>
      `<div class="wg-tuile ${t.etat ? "e-" + t.etat : ""}"><small>${esc(t.label)}</small><b>${n(t.valeur)}</b>${t.sous ? `<span>${esc(t.sous)}</span>` : ""}</div>`).join("")}</div></div>`;
  }
  if (w.type === "activite") {
    const W = 300, H = 110, pad = 18, bas = H - pad;
    const max = Math.max(1, ...w.barres.map((b: any) => b.ok + b.err));
    const pas = W / w.barres.length, larg = Math.max(3, Math.min(22, pas - 2));
    const y = (v: number) => (v / max) * (bas - 6);
    const barres = w.barres.map((b: any, i: number) => {
      const x = i * pas + (pas - larg) / 2, okH = y(b.ok), hErr = y(b.err);
      const errH = hErr > 0 && okH > 0 ? Math.max(1, hErr - 2) : hErr;
      const tip = `${b.jour} · ${b.ok} ${w.legende.ok.toLowerCase()} · ${b.err} ${w.legende.err.toLowerCase()}`;
      const seg = (h: number, y0: number, cls: string, haut: boolean) => h > 0
        ? `<rect class="${cls}" x="${x.toFixed(1)}" y="${(y0 - h).toFixed(1)}" width="${larg.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="${haut ? 3 : 0}"/>` : "";
      return `<g data-tip="${esc(tip)}"><rect class="hit" x="${(i * pas).toFixed(1)}" y="0" width="${pas.toFixed(1)}" height="${H}"/>${seg(okH, bas, "ok", !errH)}${seg(errH, bas - okH - (okH > 0 && errH > 0 ? 2 : 0), "err", true)}</g>`;
    }).join("");
    const lab = w.barres.map((b: any, i: number) => (i === 0 || i === w.barres.length - 1 || i === Math.floor(w.barres.length / 2))
      ? `<text x="${(i * pas + pas / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${esc(b.jour)}</text>` : "").join("");
    return `<div class="wg">${tete}<div class="wg-leg"><span><i class="ok"></i>${esc(w.legende.ok)} <b>${n(w.ok)}</b></span><span><i class="err"></i>${esc(w.legende.err)} <b>${n(w.err)}</b></span></div>
      <svg class="wg-barres" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(w.titre)} : ${w.ok} ${esc(w.legende.ok)}, ${w.err} ${esc(w.legende.err)}"><line class="base" x1="0" x2="${W}" y1="${bas}" y2="${bas}"/>${barres}${lab}</svg>
      ${w.ok + w.err ? "" : '<p class="wg-vide">Rien sur la période.</p>'}</div>`;
  }
  if (w.type === "rang") {
    return `<div class="wg">${tete}${w.lignes.length ? w.lignes.map((l: any) =>
      `<div class="wg-rang" data-tip="${esc(l.detail)}"><span class="nom">${esc(l.nom)}</span><span class="val">${n(l.valeur)}</span><span class="piste"><i class="${esc(l.niveau)}" style="width:${Math.max(2, Math.min(100, l.valeur)).toFixed(1)}%"></i></span></div>`).join("")
      : '<p class="wg-vide">Aucun appareil exposé.</p>'}</div>`;
  }
  if (w.type === "liste") {
    return `<div class="wg">${tete}${w.lignes.length ? w.lignes.map((l: any) =>
      `<div class="wg-svc"><i class="pt ${esc(l.etat)}"></i><span class="nom"><b>${esc(l.nom)}</b><span class="detail">${esc(l.detail)}</span></span></div>`).join("")
      : `<p class="wg-vide">${esc(w.vide)}</p>`}${w.reste ? `<p class="liste-reste">et ${n(w.reste)} autre${w.reste > 1 ? "s" : ""}</p>` : ""}</div>`;
  }
  return "";
}

/* Une seule bulle d'info pour tous les widgets : elle suit la souris. */
let bulleBranchee = false;
export function brancherBulle(): void {
  if (bulleBranchee) return;
  bulleBranchee = true;
  document.addEventListener("mouseover", e => {
    const cible = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
    let bulle = document.getElementById("aiaTip");
    if (!cible || !cible.closest(".aia")) { bulle?.classList.remove("vu"); return; }
    if (!bulle) {
      bulle = document.createElement("div");
      bulle.id = "aiaTip"; bulle.className = "wg-tip"; bulle.setAttribute("role", "tooltip");
      document.body.appendChild(bulle);
    }
    bulle.textContent = cible.dataset.tip || "";
    const r = cible.getBoundingClientRect();
    bulle.classList.add("vu");
    const bw = bulle.offsetWidth;
    bulle.style.left = `${Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2))}px`;
    bulle.style.top = `${Math.max(8, r.top - bulle.offsetHeight - 8)}px`;
  });
}

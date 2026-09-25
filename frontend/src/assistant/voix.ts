// Le mode vocal de l'assistant — le même que celui du Hub.
//
// Un clic sur le micro du panneau : l'orbe prend la place de la conversation
// et écoute. Tu parles ; au premier silence, la question part (Whisper, via
// VOX), l'assistant de MapMyLAN y répond, puis l'orbe s'efface et la réponse
// est DITE — dans le fil ne restent que les widgets. Quand elle a fini de
// parler, l'orbe revient et réécoute. « Stop », ou le bouton, arrête.
// Réduite, l'orbe devient une barre au-dessus du champ : le fil reste lisible.
//
// Le micro n'existe que dans un contexte sûr (HTTPS, ou http://127.0.0.1) :
// ailleurs le navigateur refuse, et on le dit plutôt que d'échouer en silence.
import { I } from "./icones";
import { esc } from "./rendu";
import { api, entetesApi } from "../api/client";

const SILENCE_MS = 1000, ATTENTE_MS = 12000, PLAFOND_MS = 20000, CALIB_MS = 400;
const SEUIL_MIN = 0.004, SEUIL_MAX = 0.05, FACTEUR = 3.2;

const V: any = {
  on: false, etat: 'repos', reduit: false, message: '',
  ctx: null, flux: null, src: null, noeud: null, analyse: null,
  pcm: [], parole: false, tDebut: 0, tSilence: 0, fond: null, fondN: 0, seuil: 0.01,
  amp: 0.1, lecture: null, jeton: 0,
  el: null, cv: null, pts: [], t: 0, anim: 0,
  quand: { apres: null, signaler: null },
};

/* ───────────── état public ───────────── */
export const voixActive = () => V.on;
export function brancher({ apresReponse, signaler }: { apresReponse: (p: any) => void; signaler: (m: string) => void }) { Object.assign(V.quand, { apres: apresReponse, signaler }); }

/* ───────────── démarrage / arrêt ───────────── */
export async function basculerVoix() { return V.on ? arreter() : demarrer(); }

async function demarrer() {
  let etat: { disponible: boolean; raison: string | null } = { disponible: false, raison: 'VOX injoignable.' };
  try { etat = await api.assistantVoix(); } catch { /* raison par défaut */ }
  V.on = true; V.reduit = false; V.message = '';
  monter();
  if (!etat.disponible) return erreur(etat.raison || 'Mode vocal indisponible.');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return erreur(`Le navigateur n'ouvre le micro que sur une page sûre : HTTPS, ou http://127.0.0.1. Ici (${location.origin}), il refuse. `
      + `Ouvre MapMyLAN par un tunnel SSH (ssh -L ${location.port || '80'}:127.0.0.1:${location.port || '80'} … puis http://127.0.0.1:${location.port || '80'}), ou derrière ton reverse-proxy en HTTPS.`);
  }
  try {
    V.ctx = V.ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (V.ctx.state === 'suspended') await V.ctx.resume();
    if (!V.module) { await V.ctx.audioWorklet.addModule('/voix-capture.js'); V.module = true; }
    V.flux = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e: any) {
    return erreur(e?.name === 'NotAllowedError' ? 'Micro refusé par le navigateur : autorise-le pour cette page.' : `Micro indisponible : ${e?.message || e}`);
  }
  ecouter();
}

export function arreter() {
  V.jeton++;
  couperMicro();
  couperLecture();
  V.flux?.getTracks().forEach(t => t.stop()); V.flux = null;
  V.on = false; V.etat = 'repos';
  cancelAnimationFrame(V.anim); V.anim = 0;
  V.el?.remove(); V.el = null; V.cv = null;
  document.querySelector('#aiaVoixBtn')?.classList.remove('on');
}

/* L'erreur dit quoi faire : installer VOX depuis le Hub, ouvrir par un tunnel… */
function erreur(msg: string) { V.etat = 'erreur'; V.message = msg; maj(); }

/* ───────────── écoute ───────────── */
function ecouter() {
  if (!V.on) return;
  couperLecture();
  V.etat = 'ecoute'; V.message = ''; V.pcm = []; V.parole = false;
  V.fond = null; V.fondN = 0; V.tDebut = performance.now(); V.tSilence = 0;
  maj();
  const jeton = ++V.jeton;
  V.src = V.ctx.createMediaStreamSource(V.flux);
  V.noeud = new AudioWorkletNode(V.ctx, 'capture-voix', { numberOfInputs: 1, numberOfOutputs: 0 });
  V.noeud.port.onmessage = (ev: MessageEvent) => {
    if (jeton !== V.jeton) return;
    const m = ev.data;
    if (m.t === 'pcm') { V.pcm.push(new Int16Array(m.b)); if (m.fin) envoyer(jeton); return; }
    if (m.t !== 'lvl') return;
    const now = performance.now();
    V.amp = Math.max(0.1, Math.min(1, m.rms * 7));
    // Le seuil s'adapte au micro : on mesure le bruit de fond au début.
    if (now - V.tDebut < CALIB_MS) {
      V.fond = V.fond == null ? m.rms : (V.fond * V.fondN + m.rms) / (V.fondN + 1); V.fondN++;
      V.seuil = Math.min(SEUIL_MAX, Math.max(SEUIL_MIN, V.fond * FACTEUR));
      return;
    }
    if (m.rms >= V.seuil) { V.parole = true; V.tSilence = now; }
    const fini = V.parole && now - V.tSilence > SILENCE_MS;
    const trop = now - V.tDebut > PLAFOND_MS;
    if (fini || (trop && V.parole)) return finEcoute();
    // Rien entendu : on se met en pause plutôt que d'écouter la pièce indéfiniment.
    if (!V.parole && now - V.tDebut > ATTENTE_MS) { couperMicro(); V.etat = 'pause'; V.message = ''; maj(); }
  };
  V.src.connect(V.noeud);
}

function finEcoute() {
  if (V.etat !== 'ecoute') return;
  V.etat = 'reflexion'; maj();
  V.noeud?.port.postMessage('vider');       // la réponse « pcm fin » déclenche l'envoi
}

function couperMicro() {
  try { V.src?.disconnect(); } catch { /* déjà coupé */ }
  try { V.noeud?.port.close(); } catch { /* idem */ }
  V.src = null; V.noeud = null;
}

async function envoyer(jeton: number) {
  couperMicro();
  const n = V.pcm.reduce((s: number, b: Int16Array) => s + b.length, 0);
  if (n < 16000 * 0.35) return ecouter();          // un souffle, pas une phrase
  const wav = enWav(V.pcm, n); V.pcm = [];
  try {
    const r = await fetch('/api/assistant/voix/transcrire', { method: 'POST', credentials: 'same-origin', headers: entetesApi('POST', { 'Content-Type': 'audio/wav' }), body: wav });
    const j = await r.json();
    if (jeton !== V.jeton || !V.on) return;
    if (!r.ok) return erreur(j.error || `Écoute impossible (HTTP ${r.status})`);
    if (j.arret) return arreter();
    if (!j.texte) return ecouter();
    V.message = j.texte; maj();
    const p = await api.assistantDemander(j.texte, true);
    if (jeton !== V.jeton || !V.on) return;
    V.quand.apres?.(p);
    await parler(p.parole || p.reply || '', jeton);
    if (jeton === V.jeton && V.on) ecouter();
  } catch (e: any) {
    if (jeton === V.jeton && V.on) erreur(e?.message || String(e));
  }
}

/* PCM 16 bits mono 16 kHz → WAV. */
function enWav(blocs: Int16Array[], n: number) {
  const buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
  const s = (o: number, t: string) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  s(36, 'data'); d.setUint32(40, n * 2, true);
  let o = 44;
  for (const b of blocs) for (let i = 0; i < b.length; i++, o += 2) d.setInt16(o, b[i], true);
  return new Blob([buf], { type: 'audio/wav' });
}

/* ───────────── parole ─────────────
   Phrase par phrase : la suivante se prépare pendant que la première se dit. */
async function parler(texte: string, jeton: number) {
  const phrases = String(texte).match(/[^.!?…]+[.!?…]*/g)?.map(x => x.trim()).filter(Boolean) || [];
  if (!phrases.length) return;
  // On regroupe les phrases très courtes : moins d'allers-retours, voix plus fluide.
  const blocs: string[] = [];
  for (const p of phrases) { if (blocs.length && (blocs.at(-1) + ' ' + p).length < 160) blocs[blocs.length - 1] += ' ' + p; else blocs.push(p); }
  V.etat = 'parle'; maj();
  const charge = (t: string) => fetch('/api/assistant/voix/dire', { method: 'POST', credentials: 'same-origin', headers: entetesApi('POST', { 'Content-Type': 'application/json' }), body: JSON.stringify({ text: t }) })
    .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Voix indisponible (HTTP ${r.status})`); return r.arrayBuffer(); })
    .then(b => V.ctx.decodeAudioData(b) as Promise<AudioBuffer>);
  let suivant = charge(blocs[0]);
  for (let i = 0; i < blocs.length; i++) {
    const son = await suivant;
    if (jeton !== V.jeton || !V.on) return;
    if (i + 1 < blocs.length) suivant = charge(blocs[i + 1]);
    await jouer(son);
    if (jeton !== V.jeton || !V.on) return;
  }
}

function jouer(son: AudioBuffer) {
  return new Promise<void>(ok => {
    const s = V.ctx.createBufferSource(); s.buffer = son;
    V.analyse = V.analyse || Object.assign(V.ctx.createAnalyser(), { fftSize: 512 });
    s.connect(V.analyse); V.analyse.connect(V.ctx.destination);
    s.onended = () => { V.lecture = null; ok(); };
    V.lecture = s; s.start();
  });
}
function couperLecture() { try { V.lecture?.stop(); } catch { /* fini */ } V.lecture = null; }

/* Toucher l'orbe : parler tout de suite (coupe la voix si elle parle). */
function toucher() {
  if (!V.on) return;
  if (V.etat === 'erreur') return;
  if (V.etat === 'reflexion') return;
  V.jeton++; couperLecture(); couperMicro();
  ecouter();
}

/* ───────────── interface ───────────── */
const TEXTES: Record<string, [string, string]> = {
  ecoute: ['Je t’écoute…', 'Parle, j’enchaîne au premier silence.'],
  reflexion: ['Je réfléchis…', ''],
  parle: ['Je réponds', 'Touche l’orbe pour me couper.'],
  // (la barre est étroite : des sous-titres courts)
  pause: ['En pause', 'Touche l’orbe pour parler.'],
  erreur: ['Mode vocal indisponible', ''],
  repos: ['', ''],
};

/* Monte (ou remonte, après un rendu du panneau) l'orbe dans le panneau. */
export function monter() {
  const panel = document.querySelector('#aiaPanel');
  if (!panel || !V.on) return;
  if (!V.el) {
    V.el = document.createElement('div');
    V.el.className = 'voix';
    V.el.innerHTML = `<div class="voix-scene"><canvas></canvas><div class="voix-txt"><b></b><small></small><p class="voix-dit"></p></div></div>
      <div class="voix-barre"><canvas class="mini"></canvas><div class="grow"><b></b><small></small></div>
        <button class="ghost" data-v="agrandir" title="Agrandir l’orbe" aria-label="Agrandir">${I('fit', 14)}</button>
        <button class="btn sm" data-v="stop">${I('x', 13)}Terminer</button></div>
      <div class="voix-actions"><button class="ghost" data-v="reduire" title="Réduire : revoir le fil et les widgets" aria-label="Réduire">${I('minus', 15)}</button>
        <button class="btn sm" data-v="stop">${I('x', 13)}Terminer</button></div>`;
    V.el.querySelector('.voix-scene canvas').onclick = toucher;
    V.el.querySelector('.voix-barre canvas').onclick = toucher;
    V.el.querySelectorAll('[data-v="stop"]').forEach((b: HTMLElement) => { b.onclick = arreter; });
    V.el.querySelector('[data-v="reduire"]').onclick = () => { V.reduit = true; maj(); };
    V.el.querySelector('[data-v="agrandir"]').onclick = () => { V.reduit = false; maj(); };
    V.pts = [];
  }
  if (V.el.parentNode !== panel) panel.appendChild(V.el);
  document.querySelector('#aiaVoixBtn')?.classList.add('on');
  maj();
  if (!V.anim) V.anim = requestAnimationFrame(dessiner);
}

function maj() {
  if (!V.el) return;
  // Pendant qu'il parle, l'orbe s'efface : le fil ne montre que les widgets.
  const plein = !V.reduit && V.etat !== 'parle';
  V.el.classList.toggle('plein', plein);
  V.el.classList.toggle('barre', !plein);
  V.el.dataset.etat = V.etat;
  // L'orbe couvre le fil sous l'en-tête ; réduite, elle se range au-dessus du champ.
  const panel = V.el.parentNode;
  const tete = panel?.querySelector('header'), champ = panel?.querySelector('#aiaForm');
  V.el.style.top = plein ? `${tete?.offsetHeight || 70}px` : '';
  V.el.style.bottom = plein ? '0' : `${(champ?.offsetHeight || 60) + 14}px`;
  const [titre, sous] = TEXTES[V.etat] || TEXTES.repos;
  V.el.querySelectorAll('.voix-txt b, .voix-barre b').forEach((b: HTMLElement) => { b.textContent = titre; });
  V.el.querySelectorAll('.voix-txt small, .voix-barre small').forEach((s: HTMLElement) => { s.textContent = V.etat === 'erreur' ? '' : sous; });
  const dit = V.el.querySelector('.voix-dit');
  dit.textContent = V.etat === 'erreur' ? V.message : V.etat === 'reflexion' && V.message ? `« ${V.message} »` : '';
  dit.classList.toggle('err', V.etat === 'erreur');
}

/* L'orbe : quelques centaines de points sur une sphère, un tore quand il
   réfléchit, une sphère qui respire au son quand il écoute ou parle. */
function dessiner() {
  V.anim = V.on ? requestAnimationFrame(dessiner) : 0;
  if (!V.el || !V.el.isConnected) return;
  const cv = V.el.classList.contains('plein') ? V.el.querySelector('.voix-scene canvas') : V.el.querySelector('.voix-barre canvas');
  const r0 = cv.getBoundingClientRect();
  if (!r0.width) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(r0.width * dpr) || cv.height !== Math.round(r0.height * dpr)) { cv.width = Math.round(r0.width * dpr); cv.height = Math.round(r0.height * dpr); V.pts = []; }
  const c = cv.getContext('2d')!, W = cv.width, H = cv.height;
  const N = cv.classList.contains('mini') ? 220 : 900;
  if (V.pts.length !== N) {
    V.pts = Array.from({ length: N }, (_: unknown, i: number) => { const k = i + 0.5, phi = Math.acos(1 - 2 * k / N), th = Math.PI * (1 + Math.sqrt(5)) * k;
      return { sx: Math.cos(th) * Math.sin(phi), sy: Math.sin(th) * Math.sin(phi), sz: Math.cos(phi), phi, th, o: 0.35 + Math.random() * 0.65, x: W / 2, y: H / 2 }; });
  }
  V.t += 0.016;
  if (V.etat === 'parle' && V.analyse) {
    const d = new Uint8Array(V.analyse.fftSize); V.analyse.getByteTimeDomainData(d);
    let a = 0; for (const v of d) a += ((v - 128) / 128) ** 2;
    V.amp = V.amp * 0.6 + Math.min(1, Math.sqrt(a / d.length) * 5) * 0.4;
  } else if (V.etat !== 'ecoute') V.amp = V.amp * 0.92 + 0.1 * 0.08;
  const R = Math.min(W, H) * 0.34, cx0 = W / 2, cy0 = H / 2;
  const rotY = V.t * 0.25, rotX = Math.sin(V.t * 0.15) * 0.3, cy = Math.cos(rotY), sy = Math.sin(rotY), cxr = Math.cos(rotX), sxr = Math.sin(rotX);
  const couleur = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1B2AFF';
  c.clearRect(0, 0, W, H); c.fillStyle = couleur;
  for (const p of V.pts) {
    let tx: number, ty: number, tz: number;
    if (V.etat === 'reflexion') {
      const u = p.th * 1.6 + V.t * 1.1, v = p.phi * 3 + V.t * 2.2, rr = R * 0.72 + R * 0.28 * Math.cos(v);
      tx = Math.cos(u) * rr; ty = Math.sin(u) * rr * 0.62 + Math.sin(v) * R * 0.2; tz = Math.sin(u) * 0.7;
    } else {
      let rad = R * (1 + V.amp * 0.18);
      if (V.etat === 'parle' || V.etat === 'ecoute') rad *= 1 + 0.2 * V.amp * Math.sin(p.phi * 7 + V.t * 5.5) + 0.08 * Math.sin(p.th * 2.4 - V.t * 3.4);
      else rad *= 1 + 0.04 * Math.sin(p.phi * 4 + V.t * 2);
      const x2 = p.sx * cy - p.sz * sy, z2 = p.sx * sy + p.sz * cy, y2 = p.sy * cxr - z2 * sxr, z3 = p.sy * sxr + z2 * cxr;
      tx = x2 * rad; ty = y2 * rad; tz = z3;
    }
    const persp = 1 / (1 + tz * 0.3);
    p.x += (cx0 + tx * persp - p.x) * 0.09; p.y += (cy0 + ty * persp - p.y) * 0.09;
    const prof = (tz + 1) / 2;
    c.globalAlpha = p.o * (0.18 + prof * 0.72) * (V.etat === 'pause' || V.etat === 'erreur' ? 0.45 : 1);
    const t = (prof > 0.62 ? 1.7 : 1.1) * dpr;
    c.fillRect(p.x, p.y, t, t);
  }
  c.globalAlpha = 1;
}

/* Le rendu d'un tour vocal dans le fil : pas de texte, les widgets seulement
   (et le plan s'il y a quelque chose à valider). La transcription et la
   réponse restent accessibles, repliées. */
export function tourVocal(p: any, widgetsHtml: string) {
  return `<details class="voix-tour"><summary>${I('mic', 12)}<span>Question et réponse à voix haute</span></summary>
    <p><b>Toi :</b> ${esc(p.request)}</p><p><b>Réponse :</b> ${esc(p.parole || p.reply || '')}</p></details>${widgetsHtml}`;
}

export function rejouer(texte: string) {
  if (!texte) return;
  const ctx = V.ctx || (V.ctx = new (window.AudioContext || (window as any).webkitAudioContext)());
  fetch('/api/assistant/voix/dire', { method: 'POST', credentials: 'same-origin', headers: entetesApi('POST', { 'Content-Type': 'application/json' }), body: JSON.stringify({ text: texte }) })
    .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Voix indisponible'); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b)).then((son: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = son; s.connect(ctx.destination); s.start(); })
    .catch((e: any) => V.quand.signaler?.(e.message));
}

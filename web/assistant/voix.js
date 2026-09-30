// Le mode vocal de l'assistant, le même que celui du Hub.
//
// Un clic sur le micro du panneau : l'orbe prend la place de la conversation
// et écoute. Au premier silence, la question part (transcription par VOX),
// l'assistant y répond, puis l'orbe s'efface et la réponse est dite ; dans le
// fil ne restent que les widgets. Quand la voix se tait, l'orbe revient et
// réécoute. « Stop », ou le bouton, arrête. Réduite, l'orbe devient une barre
// au-dessus du champ : le fil reste lisible.
//
// Le micro n'existe que dans un contexte sûr (HTTPS, ou http://127.0.0.1) :
// ailleurs le navigateur refuse, et on le dit plutôt que d'échouer en silence.
import { h, ic } from '../dom.js';
import { api } from '../etat.js';

const SILENCE_MS = 1000, ATTENTE_MS = 12000, PLAFOND_MS = 20000, CALIB_MS = 400;
const SEUIL_MIN = 0.004, SEUIL_MAX = 0.05, FACTEUR = 3.2;

const V = {
  on: false, etat: 'repos', reduit: false, message: '', module: false,
  ctx: null, flux: null, src: null, noeud: null, analyse: null,
  pcm: [], parole: false, tDebut: 0, tSilence: 0, fond: null, fondN: 0, seuil: 0.01,
  amp: 0.1, lecture: null, jeton: 0,
  el: null, pts: [], t: 0, anim: 0,
  quand: { apres: null, signaler: null },
};

export function brancher({ apresReponse, signaler }) { Object.assign(V.quand, { apres: apresReponse, signaler }); }

export const basculerVoix = () => (V.on ? Promise.resolve(arreter()) : demarrer());

// Les écritures vers l'assistant vocal ne sont pas du JSON : on passe par
// fetch, avec le jeton anti-falsification de la session.
const entetes = type => ({ 'Content-Type': type, ...(api.csrf ? { 'X-CSRF': api.csrf } : {}) });
const contexteAudio = () => V.ctx || (V.ctx = new (window.AudioContext || window.webkitAudioContext)());

async function demarrer() {
  let etat = { disponible: false, raison: 'VOX injoignable.' };
  try { etat = await api.get('/api/assistant/voix'); } catch { /* la raison par défaut suffit */ }
  V.on = true; V.reduit = false; V.message = '';
  monter();
  if (!etat.disponible) return erreur(etat.raison || 'Mode vocal indisponible.');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const port = location.port || '80';
    return erreur(`Le navigateur n'ouvre le micro que sur une page sûre : HTTPS, ou http://127.0.0.1. Ici (${location.origin}), il refuse. `
      + `Ouvre MapMyLAN par un tunnel SSH (ssh -L ${port}:127.0.0.1:${port} … puis http://127.0.0.1:${port}), ou derrière ton reverse-proxy en HTTPS.`);
  }
  try {
    const ctx = contexteAudio();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!V.module) { await ctx.audioWorklet.addModule('/voix-capture.js'); V.module = true; }
    V.flux = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    return erreur(e?.name === 'NotAllowedError' ? 'Micro refusé par le navigateur : autorise-le pour cette page.' : `Micro indisponible : ${e?.message || e}`);
  }
  ecouter();
}

export function arreter() {
  V.jeton++;
  couperMicro();
  couperLecture();
  V.flux?.getTracks().forEach(piste => piste.stop()); V.flux = null;
  V.on = false; V.etat = 'repos';
  cancelAnimationFrame(V.anim); V.anim = 0;
  V.el?.remove(); V.el = null;
  document.getElementById('aiaVoixBtn')?.classList.remove('on');
}

// L'erreur dit quoi faire : installer VOX depuis le Hub, ouvrir par un tunnel…
function erreur(msg) { V.etat = 'erreur'; V.message = msg; maj(); }

function ecouter() {
  if (!V.on) return;
  couperLecture();
  V.etat = 'ecoute'; V.message = ''; V.pcm = []; V.parole = false;
  V.fond = null; V.fondN = 0; V.tDebut = performance.now(); V.tSilence = 0;
  maj();
  const jeton = ++V.jeton;
  V.src = V.ctx.createMediaStreamSource(V.flux);
  V.noeud = new AudioWorkletNode(V.ctx, 'capture-voix', { numberOfInputs: 1, numberOfOutputs: 0 });
  V.noeud.port.onmessage = ev => {
    if (jeton !== V.jeton) return;
    const m = ev.data;
    if (m.t === 'pcm') { V.pcm.push(new Int16Array(m.b)); if (m.fin) envoyer(jeton); return; }
    if (m.t !== 'lvl') return;
    const maintenant = performance.now();
    V.amp = Math.max(0.1, Math.min(1, m.rms * 7));
    // Le seuil s'adapte au micro : on mesure le bruit de fond au début.
    if (maintenant - V.tDebut < CALIB_MS) {
      V.fond = V.fond == null ? m.rms : (V.fond * V.fondN + m.rms) / (V.fondN + 1); V.fondN++;
      V.seuil = Math.min(SEUIL_MAX, Math.max(SEUIL_MIN, V.fond * FACTEUR));
      return;
    }
    if (m.rms >= V.seuil) { V.parole = true; V.tSilence = maintenant; }
    const fini = V.parole && maintenant - V.tSilence > SILENCE_MS;
    const trop = maintenant - V.tDebut > PLAFOND_MS;
    if (fini || (trop && V.parole)) return finEcoute();
    // Rien entendu : on se met en pause plutôt que d'écouter la pièce indéfiniment.
    if (!V.parole && maintenant - V.tDebut > ATTENTE_MS) { couperMicro(); V.etat = 'pause'; V.message = ''; maj(); }
  };
  V.src.connect(V.noeud);
}

function finEcoute() {
  if (V.etat !== 'ecoute') return;
  V.etat = 'reflexion'; maj();
  V.noeud?.port.postMessage('vider');       // la réponse « pcm fin » déclenche l'envoi
}

function couperMicro() {
  try { V.src?.disconnect(); } catch { /* source déjà débranchée */ }
  try { V.noeud?.port.close(); } catch { /* port déjà fermé */ }
  V.src = null; V.noeud = null;
}

async function envoyer(jeton) {
  couperMicro();
  const total = V.pcm.reduce((somme, b) => somme + b.length, 0);
  if (total < 16000 * 0.35) return ecouter();          // un souffle, pas une phrase
  const wav = enWav(V.pcm, total); V.pcm = [];
  try {
    const r = await fetch('/api/assistant/voix/transcrire', { method: 'POST', credentials: 'same-origin', headers: entetes('audio/wav'), body: wav });
    const j = await r.json().catch(() => ({}));
    if (jeton !== V.jeton || !V.on) return;
    if (!r.ok) return erreur(j.error || `Écoute impossible (HTTP ${r.status})`);
    if (j.arret) return arreter();
    if (!j.texte) return ecouter();
    V.message = j.texte; maj();
    const tour = await api.post('/api/assistant/ask', { text: j.texte, voix: true });
    if (jeton !== V.jeton || !V.on) return;
    V.quand.apres?.(tour);
    await parler(tour.parole || tour.reply || '', jeton);
    if (jeton === V.jeton && V.on) ecouter();
  } catch (e) {
    if (jeton === V.jeton && V.on) erreur(e?.message || String(e));
  }
}

// PCM 16 bits mono 16 kHz → WAV.
function enWav(blocs, total) {
  const buf = new ArrayBuffer(44 + total * 2), d = new DataView(buf);
  const ecrire = (o, texte) => [...texte].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  ecrire(0, 'RIFF'); d.setUint32(4, 36 + total * 2, true); ecrire(8, 'WAVE'); ecrire(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  ecrire(36, 'data'); d.setUint32(40, total * 2, true);
  let o = 44;
  for (const b of blocs) for (let i = 0; i < b.length; i++, o += 2) d.setInt16(o, b[i], true);
  return new Blob([buf], { type: 'audio/wav' });
}

function chargerSon(texte) {
  return fetch('/api/assistant/voix/dire', { method: 'POST', credentials: 'same-origin', headers: entetes('application/json'), body: JSON.stringify({ text: texte }) })
    .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Voix indisponible (HTTP ${r.status})`); return r.arrayBuffer(); })
    .then(b => contexteAudio().decodeAudioData(b));
}

// Phrase par phrase : la suivante se prépare pendant que la première se dit.
async function parler(texte, jeton) {
  const phrases = String(texte).match(/[^.!?…]+[.!?…]*/g)?.map(x => x.trim()).filter(Boolean) || [];
  if (!phrases.length) return;
  // On regroupe les phrases très courtes : moins d'allers-retours, voix plus fluide.
  const blocs = [];
  for (const p of phrases) { if (blocs.length && `${blocs.at(-1)} ${p}`.length < 160) blocs[blocs.length - 1] += ` ${p}`; else blocs.push(p); }
  V.etat = 'parle'; maj();
  let suivant = chargerSon(blocs[0]);
  for (let i = 0; i < blocs.length; i++) {
    const son = await suivant;
    if (jeton !== V.jeton || !V.on) return;
    if (i + 1 < blocs.length) suivant = chargerSon(blocs[i + 1]);
    await jouer(son);
    if (jeton !== V.jeton || !V.on) return;
  }
}

function jouer(son) {
  return new Promise(fin => {
    const source = V.ctx.createBufferSource(); source.buffer = son;
    V.analyse = V.analyse || Object.assign(V.ctx.createAnalyser(), { fftSize: 512 });
    source.connect(V.analyse); V.analyse.connect(V.ctx.destination);
    source.onended = () => { V.lecture = null; fin(); };
    V.lecture = source; source.start();
  });
}
function couperLecture() { try { V.lecture?.stop(); } catch { /* lecture déjà finie */ } V.lecture = null; }

// Toucher l'orbe : parler tout de suite (coupe la voix si elle parle).
function toucher() {
  if (!V.on || V.etat === 'erreur' || V.etat === 'reflexion') return;
  V.jeton++; couperLecture(); couperMicro();
  ecouter();
}

const TEXTES = {
  ecoute: ['Je t’écoute…', 'Parle, j’enchaîne au premier silence.'],
  reflexion: ['Je réfléchis…', ''],
  parle: ['Je réponds', 'Touche l’orbe pour me couper.'],
  // La barre est étroite : des sous-titres courts.
  pause: ['En pause', 'Touche l’orbe pour parler.'],
  erreur: ['Mode vocal indisponible', ''],
  repos: ['', ''],
};

function construire() {
  const toile = h('canvas', { onclick: toucher });
  const mini = h('canvas', { class: 'mini', onclick: toucher });
  const terminer = () => h('button', { class: 'btn sm', type: 'button', onclick: arreter }, ic('x', 13), 'Terminer');
  return h('div', { class: 'voix' },
    h('div', { class: 'voix-scene' }, toile, h('div', { class: 'voix-txt' }, h('b'), h('small'), h('p', { class: 'voix-dit' }))),
    h('div', { class: 'voix-barre' }, mini, h('div', { class: 'grow' }, h('b'), h('small')),
      h('button', { class: 'ghost', type: 'button', title: 'Agrandir l’orbe', 'aria-label': 'Agrandir', onclick: () => { V.reduit = false; maj(); } }, ic('fit', 14)),
      terminer()),
    h('div', { class: 'voix-actions' },
      h('button', { class: 'ghost', type: 'button', title: 'Réduire : revoir le fil et les widgets', 'aria-label': 'Réduire', onclick: () => { V.reduit = true; maj(); } }, ic('minus', 15)),
      terminer()));
}

/** Monte (ou remonte, après un rendu du panneau) l'orbe dans le panneau. */
export function monter() {
  const panneau = document.getElementById('aiaPanel');
  if (!panneau || !V.on) return;
  if (!V.el) { V.el = construire(); V.pts = []; }
  if (V.el.parentNode !== panneau) panneau.append(V.el);
  document.getElementById('aiaVoixBtn')?.classList.add('on');
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
  const panneau = V.el.parentNode;
  const tete = panneau?.querySelector('header'), formulaire = panneau?.querySelector('#aiaForm');
  V.el.style.top = plein ? `${tete?.offsetHeight || 70}px` : '';
  V.el.style.bottom = plein ? '0' : `${(formulaire?.offsetHeight || 60) + 14}px`;
  const [titre, sous] = TEXTES[V.etat] || TEXTES.repos;
  V.el.querySelectorAll('.voix-txt b, .voix-barre b').forEach(b => { b.textContent = titre; });
  V.el.querySelectorAll('.voix-txt small, .voix-barre small').forEach(el => { el.textContent = V.etat === 'erreur' ? '' : sous; });
  const dit = V.el.querySelector('.voix-dit');
  dit.textContent = V.etat === 'erreur' ? V.message : V.etat === 'reflexion' && V.message ? `« ${V.message} »` : '';
  dit.classList.toggle('err', V.etat === 'erreur');
}

// L'orbe : quelques centaines de points sur une sphère, un tore quand il
// réfléchit, une sphère qui respire au son quand il écoute ou parle.
function dessiner() {
  V.anim = V.on ? requestAnimationFrame(dessiner) : 0;
  if (!V.el || !V.el.isConnected) return;
  const cv = V.el.classList.contains('plein') ? V.el.querySelector('.voix-scene canvas') : V.el.querySelector('.voix-barre canvas');
  const r0 = cv.getBoundingClientRect();
  if (!r0.width) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(r0.width * dpr) || cv.height !== Math.round(r0.height * dpr)) { cv.width = Math.round(r0.width * dpr); cv.height = Math.round(r0.height * dpr); V.pts = []; }
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const N = cv.classList.contains('mini') ? 220 : 900;
  if (V.pts.length !== N) {
    V.pts = Array.from({ length: N }, (_, i) => {
      const k = i + 0.5, phi = Math.acos(1 - 2 * k / N), th = Math.PI * (1 + Math.sqrt(5)) * k;
      return { sx: Math.cos(th) * Math.sin(phi), sy: Math.sin(th) * Math.sin(phi), sz: Math.cos(phi), phi, th, o: 0.35 + Math.random() * 0.65, x: W / 2, y: H / 2 };
    });
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
    let tx, ty, tz;
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
    const cote = (prof > 0.62 ? 1.7 : 1.1) * dpr;
    c.fillRect(p.x, p.y, cote, cote);
  }
  c.globalAlpha = 1;
}

/**
 * Un tour vocal dans le fil : pas de texte, les widgets seulement. La
 * transcription et la réponse restent accessibles, repliées.
 */
export function tourVocal(tour, widgets) {
  return [
    h('details', { class: 'voix-tour' }, h('summary', {}, ic('mic', 12), h('span', { text: 'Question et réponse à voix haute' })),
      h('p', {}, h('b', { text: 'Toi :' }), ` ${tour.request}`), h('p', {}, h('b', { text: 'Réponse :' }), ` ${tour.parole || tour.reply || ''}`)),
    widgets,
  ];
}

export function rejouer(texte) {
  if (!texte) return;
  chargerSon(texte)
    .then(son => { const ctx = contexteAudio(), source = ctx.createBufferSource(); source.buffer = son; source.connect(ctx.destination); source.start(); })
    .catch(e => V.quand.signaler?.(e.message));
}

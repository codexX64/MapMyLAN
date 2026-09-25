// La voix de l'assistant : VOX entend (Whisper) et parle (la voix choisie
// dans VOX, ElevenLabs compris quand le Hub lui a transmis la clé).
//
// Le cerveau reste celui de MapMyLAN : la question transcrite passe par le
// même assistant que celle tapée au clavier.

import { config } from "../../config";

const MOTS_ARRET = /^\s*(stop|arr[êe]te(-toi)?|c'?est bon|c'?est tout|merci c'?est tout|laisse tomber|au revoir|bye|termin[ée])\s*[.!]*\s*$/i;

export class ErreurVoix extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const entetes = (): Record<string, string> => (config.assistant.voxJeton ? { Authorization: `Bearer ${config.assistant.voxJeton}` } : {});

let cache: { t: number; etat: { disponible: boolean; raison: string | null } } | null = null;

export async function etatVoix(): Promise<{ disponible: boolean; raison: string | null }> {
  if (!config.assistant.voxUrl) {
    return { disponible: false, raison: "VOX n'est pas relié à MapMyLAN. Installe VOX depuis le Hub : MapMyLAN est redéployé tout seul pour le trouver." };
  }
  if (!config.assistant.voxJeton) return { disponible: false, raison: "VOX est relié sans son jeton : redéploie MapMyLAN depuis le Hub." };
  if (cache && Date.now() - cache.t < 10_000) return cache.etat;
  let etat: { disponible: boolean; raison: string | null };
  try {
    const r = await fetch(`${config.assistant.voxUrl}/health`, { signal: AbortSignal.timeout(3000) });
    etat = r.ok ? { disponible: true, raison: null } : { disponible: false, raison: `VOX répond HTTP ${r.status}.` };
  } catch (e: any) {
    etat = { disponible: false, raison: `VOX injoignable (${config.assistant.voxUrl}) : ${e?.message || e}` };
  }
  cache = { t: Date.now(), etat };
  return etat;
}

export async function transcrire(audio: Buffer): Promise<{ texte: string; arret: boolean; ms: number | null }> {
  if (!audio?.length) throw new ErreurVoix("Audio vide", 400);
  if (!config.assistant.voxUrl) throw new ErreurVoix("VOX n'est pas relié à MapMyLAN.", 409);
  const r = await fetch(`${config.assistant.voxUrl}/v1/transcrire`, {
    method: "POST", headers: { ...entetes(), "Content-Type": "audio/wav" }, body: audio, signal: AbortSignal.timeout(45_000),
  }).catch((e: any) => { throw new ErreurVoix(`VOX injoignable : ${e?.message || e}`); });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErreurVoix(`VOX : ${j.error || `HTTP ${r.status}`}`);
  const texte = String(j.text || "").trim();
  return { texte, arret: MOTS_ARRET.test(texte), ms: j.ms ?? null };
}

export async function dire(texte: string): Promise<{ son: Buffer; type: string }> {
  const t = String(texte || "").trim();
  if (!t) throw new ErreurVoix("Rien à dire", 400);
  if (!config.assistant.voxUrl) throw new ErreurVoix("VOX n'est pas relié à MapMyLAN.", 409);
  const r = await fetch(`${config.assistant.voxUrl}/v1/dire`, {
    method: "POST", headers: { ...entetes(), "Content-Type": "application/json" },
    body: JSON.stringify({ text: t.slice(0, 1500) }), signal: AbortSignal.timeout(30_000),
  }).catch((e: any) => { throw new ErreurVoix(`VOX injoignable : ${e?.message || e}`); });
  if (!r.ok) {
    const j: any = await r.json().catch(() => ({}));
    throw new ErreurVoix(`VOX : ${j.error || `HTTP ${r.status}`}`);
  }
  return { son: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "audio/wav" };
}

/** Ce qui se dit d'une réponse écrite : sans markdown, sans puces, sans emojis, en phrases. */
export function aDire(texte: string, max = 600): string {
  let t = String(texte || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#+\s*/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "")
    .replace(/^\s*[-•*]\s+(.*)$/gm, (_m, x: string) => (/[.!?:]$/.test(x.trim()) ? x.trim() : x.trim() + "."))
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (t.length > max) {
    const coupe = t.slice(0, max);
    const fin = Math.max(coupe.lastIndexOf(". "), coupe.lastIndexOf("! "), coupe.lastIndexOf("? "));
    t = fin > max * 0.4 ? coupe.slice(0, fin + 1) : coupe.replace(/\s+\S*$/, "") + "…";
  }
  return t;
}

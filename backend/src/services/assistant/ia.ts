// Le modèle de langage de l'assistant : Ollama, celui que le Hub a relié.
//
// Même fenêtre de contexte que l'assistant du Hub, SYNAPSE et VOX (16 k) :
// Ollama recharge un modèle dès qu'on lui demande une autre taille, et deux
// services qui alternent 8 k et 16 k font attendre chaque réponse une minute.

import { config } from "../../config";

export const CTX = 16384;

export interface Message { role: "system" | "user" | "assistant"; content: string }

export const iaPrete = () => !!(config.assistant.iaUrl && config.assistant.iaModele);

export async function discuter(messages: Message[], signal?: AbortSignal): Promise<{ texte: string; modele: string }> {
  if (!iaPrete()) throw new Error("Aucun modèle de langage relié à MapMyLAN.");
  const delai = AbortSignal.timeout(120_000);
  const res = await fetch(`${config.assistant.iaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: signal ? AbortSignal.any([signal, delai]) : delai,
    body: JSON.stringify({
      model: config.assistant.iaModele,
      messages,
      stream: false,
      think: false,
      keep_alive: "30m",
      options: { num_ctx: CTX, temperature: 0.3, repeat_penalty: 1.1, num_predict: 700 },
    }),
  }).catch((e: any) => {
    if (signal?.aborted) throw new Error("Réponse interrompue.");
    throw new Error(e?.name === "TimeoutError" ? "Le modèle n'a pas répondu en deux minutes." : `Ollama injoignable (${config.assistant.iaUrl}) : ${e?.message || e}`);
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ollama : ${j.error || `HTTP ${res.status}`}`);
  return { texte: dedoublonne(String(j.message?.content || "").trim()), modele: config.assistant.iaModele };
}

/**
 * Un petit modèle qui boucle répète la même ligne jusqu'à la limite de
 * jetons. On garde la première occurrence de chaque ligne ou phrase, et on
 * coupe dès qu'une même phrase revient une troisième fois.
 */
export function dedoublonne(texte: string): string {
  const vues = new Map<string, number>();
  const out: string[] = [];
  for (const ligne of texte.split("\n")) {
    const cle = ligne.trim().toLowerCase().replace(/[\s*_`-]+/g, " ").trim();
    if (!cle) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
    const n = (vues.get(cle) || 0) + 1;
    vues.set(cle, n);
    if (n >= 3) break;
    if (n === 1) out.push(ligne);
  }
  return out.join("\n").trim();
}

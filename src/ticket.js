// Alertes au format ticket structuré (« ticket/v1 ») pour une billetterie.
//
// Une phrase lisible oblige le destinataire à l'interpréter ; le ticket livre
// les éléments séparés (hôte, gravité, clé de regroupement) et la billetterie
// n'a plus qu'à les ranger. Seul le titre est requis, le reste a un défaut.
import crypto from 'node:crypto';

// L'urgence est une conséquence de l'impact et de la portée, pas un jugement :
// un émetteur automatique ne se déclare pas lui-même prioritaire.
const MATRICE = {
  bloquant: { site: 'p1', service: 'p1', groupe: 'p2', utilisateur: 'p3' },
  degrade: { site: 'p2', service: 'p2', groupe: 'p3', utilisateur: 'p3' },
  mineur: { site: 'p3', service: 'p3', groupe: 'p4', utilisateur: 'p4' },
};
const RANG = { p1: 1, p2: 2, p3: 3, p4: 4 };
export const urgenceDe = (impact, portee) => MATRICE[impact][portee];

const PROFILS = {
  hote_inconnu: { type: 'incident', impact: 'mineur', portee: 'utilisateur', titre: c => `Appareil inconnu sur le réseau — ${c.hote || c.ip}` },
  port_ouvert: { type: 'incident', impact: 'mineur', portee: 'utilisateur', titre: c => `Nouveau port ouvert sur ${c.hote || c.ip}` },
  risque_eleve: { type: 'incident', impact: 'degrade', portee: 'groupe', titre: c => `Risque élevé — ${c.hote || c.ip}` },
  isolement: { type: 'incident', impact: 'degrade', portee: 'utilisateur', titre: c => `Appareil isolé — ${c.hote || c.ip}` },
  vulnerabilite: { type: 'incident', impact: 'degrade', portee: 'service', titre: c => `Vulnérabilité exposée sur ${c.hote || c.ip}` },
  equipement_injoignable: { type: 'incident', impact: 'bloquant', portee: 'site', titre: () => 'Équipement réseau injoignable' },
  balayage_echec: { type: 'incident', impact: 'degrade', portee: 'service', titre: () => 'Le balayage réseau a échoué' },
  resume: { type: 'info', impact: 'mineur', portee: 'site', titre: c => `Récapitulatif — ${c.hotes ?? 0} hôtes, ${c.alertes ?? 0} alertes` },
};
export const EVENEMENTS = Object.keys(PROFILS);

// Les titres se construisent avec des noms annoncés sur le réseau et finissent
// dans l'objet d'un courriel : un « \r\n » glissé dans un nom injecterait un
// en-tête. Caractères de contrôle et marques invisibles retirés.
const S = (v, max = 512) => (typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, max)
  : '');

// Un même incident qui se répète ne fait pas cent tickets : la clé combine la
// nature et le sujet, jamais l'horodatage.
export function cleRegroupement(ev, c) {
  const sujet = c.mac || c.ip || c.hote || 'global';
  const detail = ev === 'port_ouvert' ? [...(c.ports || [])].sort((a, b) => a - b).join('-') : ev === 'vulnerabilite' ? (c.cve || '') : '';
  const brut = [ev, sujet, detail].filter(Boolean).join(':');
  return brut.length <= 128 ? brut : `${ev}:${crypto.createHash('sha256').update(brut).digest('hex').slice(0, 24)}`;
}

export function construireTicket(ev, c, r = {}) {
  const p = PROFILS[ev] || PROFILS.risque_eleve;
  // Le contexte ne peut que baisser l'urgence : un contexte influencé par des
  // données du réseau ne doit pas pouvoir se déclarer P1.
  const calcul = urgenceDe(p.impact, p.portee);
  const urgence = c.urgence && RANG[c.urgence] >= RANG[calcul] ? c.urgence : calcul;
  const metriques = [];
  if (typeof c.risque === 'number') metriques.push({ label: 'Risque', valeur: String(c.risque), seuil: '70', etat: c.risque >= 70 ? 'ko' : c.risque >= 40 ? 'warn' : 'ok' });
  if (c.ports?.length) metriques.push({ label: 'Ports ouverts', valeur: String(c.ports.length), etat: 'warn' });
  const liens = r.baseUrl && c.ip ? [{ label: 'Fiche de l’appareil', url: `${r.baseUrl.replace(/\/+$/, '')}/#appareils?ip=${encodeURIComponent(c.ip)}` }] : [];
  return {
    ticket: 1, type: p.type, titre: S(p.titre(c), 200) || 'Alerte réseau', urgence, impact: p.impact, portee: p.portee,
    service: S(c.service || 'reseau', 64), composant: S(c.fabricant, 64),
    zone: { site: S(r.site, 64), vlan: Number.isInteger(c.vlan) ? c.vlan : null, host: S(c.hote, 64), ip: S(c.ip, 45), url: '' },
    description: S(c.description, 20000), symptomes: (c.symptomes || []).map(x => S(x)).filter(Boolean).slice(0, 20),
    attendu: S(c.attendu, 1000), constate: S(c.constate, 1000), actions_faites: (c.actionsFaites || []).map(x => S(x)).filter(Boolean).slice(0, 20),
    logs: S(c.logs, 8000), detecte_le: new Date().toISOString(), projet: S(r.projet, 64), labels: ['reseau', ev.replace(/_/g, '-')],
    metriques, liens, dedup_key: cleRegroupement(ev, c), source: { systeme: S(r.systeme || 'mapmylan', 48), ref: '' },
  };
}

// Le champ marqueur en tête du document : son nom varie d'une billetterie à l'autre.
export function marquer(t, nom) {
  const cle = String(nom || 'ticket').replace(/[^a-z0-9_]/gi, '').slice(0, 32) || 'ticket';
  const { ticket, ...reste } = t;
  return { [cle]: 1, ...reste };
}

// Envoie le ticket à l'API de billetterie, par la garde de sortie. Les
// erreurs restent distinguées : une clé refusée, un quota et une panne
// appellent trois réactions différentes.
export async function envoyerApi(sortie, t, { url, cle, entete = 'X-Ticket-Key' }) {
  if (!url) return { ok: false, erreur: 'Aucune adresse d’API configurée.' };
  const nomEntete = /^[A-Za-z0-9-]{1,40}$/.test(entete) ? entete : 'X-Ticket-Key';
  let rep;
  try {
    rep = await sortie.sortir(url, {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', [nomEntete]: cle || '', 'idempotency-key': crypto.createHash('sha256').update(`${t.dedup_key}|${t.detecte_le.slice(0, 16)}`).digest('hex').slice(0, 32) },
      body: JSON.stringify(t),
    }, { confiance: 'liste', taille: 64 * 1024, delai: 10_000 });
  } catch (e) {
    return { ok: false, erreur: e.name === 'DestinationRefusee' ? e.message : `Contact impossible : ${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}.` };
  }
  const corps = await rep.json().catch(() => ({}));
  if (rep.status === 401) return { ok: false, erreur: 'Clé refusée par la billetterie.' };
  if (rep.status === 429) return { ok: false, erreur: `Quota dépassé${rep.headers.get('retry-after') ? `, réessayer dans ${String(rep.headers.get('retry-after')).slice(0, 8)} s` : ''}.` };
  if (rep.status === 400) return { ok: false, erreur: `Ticket refusé : ${String(corps?.detail || corps?.erreur || 'format invalide').slice(0, 200)}.` };
  if (!rep.ok) return { ok: false, erreur: `La billetterie a répondu ${rep.status}.` };
  return { ok: true, id: corps?.id, ref: typeof corps?.ref === 'string' ? corps.ref.slice(0, 64) : undefined, regroupe: rep.status === 200 || corps?.dedup === true };
}

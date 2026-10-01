// Construction automatique de la carte.
//
// Ordre de confiance, du plus sûr au moins sûr :
//   1. la chaîne montante déclarée par le constructeur ;
//   2. le port de commutation et la borne relevés par appareil ;
//   3. le média mesuré — filaire ou sans fil — qui interdit à lui seul les
//      rattachements impossibles ;
//   4. à défaut, un rattachement au réseau filaire, compté comme présumé.
// Les liens tracés à la main ne sont jamais touchés.
import { nouvelId, transaction } from './db.js';
import { lireJson } from './formes.js';

export function construireTopologie(s, { force = false } = {}) {
  const { db, evts } = s;
  // Le réglage ne conditionne que les déclenchements automatiques ; un clic
  // sur « Reconstruire » passe toujours.
  if (!force && s.reglages.lire('topology.autoBuild') !== true) return { created: 0, deleted: 0 };
  const tous = db.prepare("SELECT * FROM appareils WHERE status != 'offline'").all();
  const vue = d => lireJson(d.metadata, {}) || {};
  const octets = ip => String(ip || '').split('.').map(Number);

  let supprimes = 0, crees = 0;
  transaction(db, () => {
    supprimes = db.prepare('DELETE FROM liens WHERE manual = 0').run().changes;
    if (!tous.length) return;
    const principal = s.equipements.principal();
    const passerelle = (principal && tous.find(d => d.ip === principal.host)) || tous.find(d => vue(d).infra && vue(d).infraKind === 'router')
      || tous.find(d => d.isMainRouter) || tous.find(d => d.type === 'router' || d.type === 'firewall') || tous[0];
    const parMac = new Map(tous.filter(d => d.mac).map(d => [String(d.mac).toUpperCase(), d]));
    const deMac = m => (m ? parMac.get(String(m).toUpperCase()) : undefined);
    const infra = tous.filter(d => ['router', 'switch', 'ap', 'firewall'].includes(d.type) && d.id !== passerelle.id && !vue(d).operateur && !vue(d).passerelleDe);
    const commutateurs = infra.filter(d => d.type === 'switch'), bornes = infra.filter(d => d.type === 'ap');
    // Faute de borne déclarée, un routeur secondaire fait office de point d'accès.
    const pivotSansFil = bornes[0] || infra.find(d => d.type === 'router') || passerelle;
    const pivotFilaire = commutateurs[0] || passerelle;
    const liens = [];
    const rattaches = new Set();

    // Une passerelle de VLAN n'est pas une machine : la même boîte, vue par une autre adresse.
    for (const d of tous.filter(x => vue(x).passerelleDe && x.id !== passerelle.id)) {
      const hote = deMac(vue(d).passerelleDe) || passerelle;
      if (hote.id !== d.id) { liens.push({ fromId: hote.id, toId: d.id, type: 'sibling' }); rattaches.add(d.id); }
    }
    const box = tous.find(d => vue(d).operateur);
    if (box && box.id !== passerelle.id) { liens.push({ fromId: box.id, toId: passerelle.id, type: 'wan' }); rattaches.add(passerelle.id); rattaches.add(box.id); }
    for (const h of infra) {
      const v = vue(h);
      const amont = deMac(v.uplinkMac) || deMac(v.swMac);
      liens.push({ fromId: (amont && amont.id !== h.id ? amont : passerelle).id, toId: h.id, type: v.uplinkMedium === 'wireless' || (!v.uplinkMac && v.medium === 'wireless') ? 'wifi' : 'ethernet' });
      rattaches.add(h.id);
    }

    // Trois MAC ou plus derrière un seul port : un commutateur non géré entre
    // les deux. On insère un nœud plutôt que de tout pendre au commutateur.
    const parPort = new Map();
    for (const d of tous) {
      const v = vue(d);
      if (v.swPort === undefined || v.swPort === null || v.infra) continue;
      const cle = `${v.swMac || 'gw'}:${v.swPort}`;
      parPort.set(cle, [...(parPort.get(cle) || []), d]);
    }
    const deduits = new Map();
    for (const [cle, membres] of parPort) {
      if (membres.length < 3) continue;
      const [swMac, port] = cle.split(':');
      const nom = `Commutateur déduit · port ${port}`;
      let noeud = tous.find(d => d.hostname === nom);
      if (!noeud) {
        // Adresse repère interne, non routable : le nœud n'est pas une machine joignable.
        noeud = s.appareils.creer({ ip: `0.0.0.${100 + deduits.size}`, hostname: nom, type: 'switch', vendor: 'déduit', metadata: JSON.stringify({ deduit: true, swMac, swPort: Number(port), membres: membres.length }) });
      }
      deduits.set(cle, noeud);
    }
    const idsDeduits = new Set([...deduits.values()].map(n => n.id));

    for (const d of tous) {
      if (d.id === passerelle.id || rattaches.has(d.id) || infra.some(h => h.id === d.id) || idsDeduits.has(d.id)) continue;
      const v = vue(d);
      // Sans fil seulement quand c'est mesuré : certains micrologiciels
      // renseignent la MAC de borne sur des clients filaires.
      if (v.medium === 'wireless') {
        const borne = deMac(v.apMac);
        liens.push({ fromId: (borne || pivotSansFil).id, toId: d.id, type: 'wifi' });
        continue;
      }
      if (v.swPort !== undefined && v.swPort !== null) {
        const cible = deduits.get(`${v.swMac || 'gw'}:${v.swPort}`) || deMac(v.swMac) || pivotFilaire;
        liens.push({ fromId: cible.id, toId: d.id, type: 'ethernet' });
        continue;
      }
      // Filaire ou inconnu : l'amont désigné par le contrôleur s'il y en a un
      // (jamais une borne pour un appareil filaire), sinon le commutateur du parc.
      const parBorne = deMac(v.apMac);
      const amont = deMac(v.swMac) || (parBorne && parBorne.type !== 'ap' ? parBorne : undefined);
      liens.push({ fromId: (amont || pivotFilaire).id, toId: d.id, type: 'ethernet' });
    }
    for (const [cle, n] of deduits) {
      const swMac = cle.split(':')[0];
      liens.push({ fromId: ((swMac !== 'gw' && deMac(swMac)) || passerelle).id, toId: n.id, type: 'ethernet' });
    }
    // Les deux faces d'une même machine, seulement si les deux médias sont mesurés et diffèrent.
    for (const a of tous) for (const b of tous) {
      if (a.id >= b.id) continue;
      const va = vue(a), vb = vue(b);
      if (!va.medium || !vb.medium || va.medium === vb.medium) continue;
      if (octets(a.ip)[2] === octets(b.ip)[2] || octets(a.ip)[3] !== octets(b.ip)[3]) continue;
      liens.push({ fromId: a.id, toId: b.id, type: 'sibling' });
    }
    // Jamais deux fois la même liaison entre deux appareils, dans un sens ou l'autre.
    const deja = new Set(db.prepare('SELECT fromId, toId FROM liens').all().map(l => [l.fromId, l.toId].sort().join('|')));
    const inserer = db.prepare('INSERT OR IGNORE INTO liens(id, fromId, toId, type, manual, createdAt) VALUES(?,?,?,?,0,?)');
    for (const l of liens) {
      const cle = [l.fromId, l.toId].sort().join('|');
      if (deja.has(cle) || l.fromId === l.toId) continue;
      deja.add(cle);
      crees += inserer.run(nouvelId(), l.fromId, l.toId, l.type, Date.now()).changes;
    }
    evts.journaliser('info', 'topology', `Topologie : ${crees} lien(s) · racine ${passerelle.hostname || passerelle.ip} · ${commutateurs.length} commutateur(s), ${bornes.length} borne(s)`);
  });
  evts.emettre('topology:updated');
  return { created: crees, deleted: supprimes };
}

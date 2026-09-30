// Supervision — vue d'ensemble, carte, trafic mondial, appareils, VLAN.
//
// Toutes ces pages lisent l'état partagé, qui lit l'API. Aucune ne fabrique de
// donnée : là où le serveur ne mesure rien, la page le dit plutôt que de
// dessiner une courbe décorative.
import { confirmer } from '/socle/compte.js';
import {
  h, ic, entete, page, figs, fig, courbe, carte, split, btn, chip, risque, whoCell, notice, vide, note,
  vues, champ, lbl, interrupteur, actionsPage, telecharger, remplir,
} from '../dom.js';
import { E, api, choisirPage, choisirAppareil, lancerBalayage, rafraichirAppareils, rafraichirTopologie, rafraichirVlans, ecrireLocal } from '../etat.js';
import { t } from '../i18n.js';
import { depuis, nomAppareil, glyphe, ETATS, tonEtat, liaison, triParRisque } from '../communs.js';
import { carteTopologie } from '../composants/topologie.js';
import { traficMondial } from '../composants/monde.js';

const boutonBalayage = () => btn({ solid: true, icone: 'refresh', disabled: E.scanRunning, onclick: () => lancerBalayage() },
  E.scanRunning ? t('act.scanning') : t('act.scan'));

export function tableauDeBord(p) {
  const sec = h('section', { class: 'page on' });
  let charge = [];
  // Seule série réellement conservée par le serveur : celle de la machine
  // hôte. Elle sert de fond à la tuile « santé ».
  api.get('/api/host/history?minutes=60')
    .then(hist => { charge = (hist || []).map(x => Number(x.cpuPct) || 0); peindre(); })
    .catch(() => { /* tuile sans courbe de fond */ });

  // Export : ce que l'interface a sous la main, tel quel, en JSON. Pas de
  // route serveur à inventer, et le fichier reste lisible.
  const exporter = () => {
    const contenu = JSON.stringify({
      exporteLe: new Date().toISOString(),
      hotes: E.devices.map(d => ({
        nom: nomAppareil(d), ip: d.ip, mac: d.mac, fabricant: d.vendor,
        type: d.customType || d.type, etat: d.status, risque: d.dangerScore,
        ports: d.ports || [], vu: d.lastSeen,
      })),
      vlans: E.vlans, santé: E.healthScore,
    }, null, 2);
    telecharger(`mapmylan-parc-${new Date().toISOString().slice(0, 10)}.json`, contenu, 'application/json');
  };

  function peindre() {
    const devices = E.devices;
    const enLigne = devices.filter(d => d.status === 'online').length;
    const parRisque = triParRisque(devices);
    const pire = parRisque[0];
    const ports = devices.reduce((n, d) => n + (d.ports?.length || 0), 0);
    const exp = btn({ icone: 'export', onclick: exporter }, t('action.export'));
    remplir(sec,
      entete({
        titre: t('page.dashboard.title'),
        lede: t('page.dashboard.lede', { total: devices.length, online: enLigne }),
        actions: actionsPage([boutonBalayage()], [{ texte: t('action.export'), agir: exporter, bouton: exp }]),
      }),
      figs(
        fig({ icone: 'devices', libelle: t('fig.online'), valeur: enLigne, unite: t('fig.outOf', { n: devices.length }),
          delta: `${devices.filter(d => d.status === 'offline').length} hors ligne` }),
        fig({ icone: 'alert', ton: pire && pire.dangerScore >= 70 ? 'warn' : undefined, libelle: t('fig.maxRisk'),
          valeur: pire ? Math.round(pire.dangerScore || 0) : 0, delta: pire ? nomAppareil(pire) : '—' }),
        fig({ icone: 'port', ton: 'plain', libelle: t('fig.openPorts'), valeur: ports, delta: `sur ${devices.length} hôtes` }),
        fig({ icone: 'shield', libelle: t('fig.health'), valeur: E.healthScore, unite: '/100',
          delta: `${E.vlans.length} segments déclarés`, courbe: charge.length > 1 ? courbe(charge, 'accent') : undefined })),
      split('',
        carte({ titre: t('card.watch'), note: t('card.watch.note') },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: t('col.host') }), h('th', { class: 'cache-m', text: t('col.link') }),
              h('th', { class: 'cache-s', text: t('col.risk') }), h('th', { text: t('col.state') }))),
            h('tbody', {}, parRisque.slice(0, 6).map(d => {
              const l = liaison(d);
              return h('tr', { class: 'cliquable', onclick: () => choisirAppareil(d.id) },
                h('td', { class: 'principal' }, whoCell({ icone: glyphe(d), ton: d.dangerScore >= 70 ? 'hot' : undefined, nom: nomAppareil(d), sous: d.ip })),
                h('td', { class: 'cache-m' }, h('span', { class: 'tag' }, ic(l.icon, 13), l.label)),
                h('td', { class: 'cache-s' }, risque(d.dangerScore)),
                h('td', {}, chip(tonEtat(d.status), ETATS[d.status] || d.status)));
            }))),
          devices.length === 0 ? vide(t('misc.noDevices'), 'devices') : null),
        carte({ titre: t('card.recent'), note: t('card.recent.note') },
          E.alerts.slice(0, 6).map(a => notice({
            icone: a.severity === 'critical' || a.severity === 'high' ? 'alert' : 'bell',
            ton: a.severity === 'critical' || a.severity === 'high' ? 'hot' : undefined,
            quand: `${a.source || 'système'} · ${depuis(a.createdAt)}`,
          }, a.message)),
          E.alerts.length === 0 ? vide(t('misc.calm'), 'check') : null)));
  }
  p.suivre(['devices', 'alerts', 'healthScore', 'scanRunning', 'vlans'], peindre);
  peindre();
  return sec;
}

export function pageCarte(p) {
  // L'agencement vit ici plutôt que dans la carte elle-même : c'est un choix
  // de VUE, au même titre que carte / tableau / trafic, et il se prend donc au
  // même endroit. Le choix reste dans ce navigateur.
  let agencement = 'libre';
  try { agencement = localStorage.getItem('mapmylan_agencement') === 'arbre' ? 'arbre' : 'libre'; } catch { /* libre par défaut */ }
  const message = h('div');
  const carteTopo = carteTopologie(p, { agencement, surAgencement: m => choisir(m) });
  const vuesAgencement = h('span', { class: 'contenu' });
  const peindreVues = () => remplir(vuesAgencement, vues([
    { libelle: t('agencement.free'), icone: 'libre', on: agencement === 'libre', onclick: () => choisir('libre') },
    { libelle: t('agencement.tree'), icone: 'arbre', on: agencement === 'arbre', onclick: () => choisir('arbre') },
  ]));
  function choisir(m) {
    agencement = m;
    ecrireLocal('mapmylan_agencement', m);
    peindreVues();
    carteTopo.agencement(m);
  }
  peindreVues();
  const reconstruire = btn({ icone: 'refresh', onclick: async () => {
    reconstruire.disabled = true; remplir(message);
    try { await api.post('/api/topology/auto-build'); await rafraichirTopologie(); }
    catch (e) { remplir(message, note('warn', e.message)); }
    finally { reconstruire.disabled = false; }
  } }, t('act.rebuild'));
  return page({
    titre: t('page.map.title'), lede: t('page.map.lede'), id: 'carte',
    actions: [
      vuesAgencement,
      h('span', { class: 'contenu cache-s' }, vues([
        { libelle: t('view.map'), icone: 'map', on: true },
        { libelle: t('view.table'), icone: 'devices', onclick: () => choisirPage('devices') },
        { libelle: t('page.world.title'), icone: 'globe', onclick: () => choisirPage('world') },
      ])),
      reconstruire,
    ],
  },
  message,
  h('div', { class: 'plan' },
    h('div', { class: 'planwrap' }, carteTopo.noeud),
    h('div', { class: 'planbar' },
      h('div', {}, h('span', { class: 'ln' }), t('link.wired')),
      h('div', {}, h('span', { class: 'ln air' }), t('link.wireless')),
      h('div', { class: 'cache-s' }, h('span', { class: 'ln same' }), t('link.same')),
      h('span', { class: 'zoom cache-m', text: 'molette pour zoomer · glisser pour déplacer' }))));
}

export function pageMonde(p) {
  return page({
    titre: t('page.world.title'), id: 'monde',
    lede: "Les connexions sortantes relevées sur la passerelle. Trait plein vers la ville quand le nom d'hôte la donne ; pointillé vers le pays d'enregistrement du préfixe sinon — une déclaration au registre, pas la position du serveur. Sans l'un ni l'autre, la destination est listée sans arc : rien n'est deviné.",
    actions: h('span', { class: 'contenu cache-s' }, vues([
      { libelle: t('view.map'), icone: 'map', onclick: () => choisirPage('map') },
      { libelle: t('view.table'), icone: 'devices', onclick: () => choisirPage('devices') },
      { libelle: t('page.world.title'), icone: 'globe', on: true },
    ])),
  }, traficMondial(p));
}

const LISTE_ETATS = ['all', 'online', 'offline', 'suspect', 'quarantined', 'banned'];

export function pageAppareils(p) {
  let filtre = '', etat = 'all', occupe = false;
  const tete = h('div');
  const message = h('div');
  const filtres = h('div', { class: 'filtres' });
  const corps = h('tbody');
  const pied = h('div');
  const recherche = champ({ sans: true, placeholder: t('misc.search'), 'aria-label': t('misc.search'), oninput: () => { filtre = recherche.value; peindre(); } });

  const dire = texte => remplir(message, texte ? note('info', texte) : '');
  const rattachement = d => {
    const v = E.vlans.find(x => x.id === (d.vlan ?? d.vlanId));
    if (v) return `VLAN ${v.id} · ${v.name}`;
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(d.ip || '');
    return m ? `${m[1]}.0/24` : '—';
  };
  const occuper = async fn => {
    occupe = true; dire(''); peindre();
    try { await fn(); } catch (e) { dire(e.message); }
    finally { occupe = false; peindre(); }
  };

  // Fusion des doublons : deux relevés du même matériel (deux cartes réseau,
  // une adresse qui a changé) n'ont pas à occuper deux lignes.
  const fusionner = () => occuper(async () => {
    const r = await api.post('/api/devices/dedupe');
    dire(`${r.removed} doublon(s) fusionné(s) sur ${r.groups} groupe(s).`);
    await rafraichirAppareils();
  });

  // Un hôte encore en ligne réapparaîtra au balayage suivant : c'est le
  // scanner qui fait foi, pas la base. Supprimer n'a donc de sens que pour ce
  // qui a disparu du réseau — d'où le décompte des hôtes hors ligne, et
  // l'avertissement quand on efface un hôte présent.
  const supprimer = async d => {
    const present = d.status !== 'offline';
    const texte = present
      ? `Supprimer ${nomAppareil(d)} ? Il est encore en ligne : le prochain balayage le recréera.`
      : `Supprimer ${nomAppareil(d)} ?`;
    if (!await confirmer('Supprimer la fiche', texte, { danger: true, oui: t('action.delete') })) return;
    occuper(async () => { await api.del(`/api/devices/${d.id}`); await rafraichirAppareils(); });
  };
  const supprimerHorsLigne = async () => {
    const horsLigne = E.devices.filter(d => d.status === 'offline' && !d.isMainRouter);
    if (!horsLigne.length) return;
    if (!await confirmer(`Supprimer ${horsLigne.length} hôte(s) hors ligne ?`,
      'Ceux qui se reconnecteront réapparaîtront au balayage suivant, avec un historique repris de zéro.', { danger: true, oui: t('action.delete') })) return;
    occuper(async () => {
      const r = await Promise.allSettled(horsLigne.map(d => api.del(`/api/devices/${d.id}`)));
      const faits = r.filter(x => x.status === 'fulfilled').length;
      const rates = r.length - faits;
      await rafraichirAppareils();
      dire(`${faits} fiche(s) supprimée(s)${rates ? `, ${rates} refusée(s) par le serveur` : ''}.`);
    });
  };

  function peindre() {
    const devices = E.devices;
    const q = filtre.toLowerCase();
    const liste = devices.filter(d => {
      if (etat !== 'all' && d.status !== etat) return false;
      if (!q) return true;
      return [d.ip, d.mac, d.hostname, d.customName, d.vendor, d.type, d.os, ...(d.tags || [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
    const horsLigne = devices.filter(d => d.status === 'offline' && !d.isMainRouter);
    const bHors = horsLigne.length ? btn({ icone: 'ban', disabled: occupe, onclick: supprimerHorsLigne, title: 'Efface les fiches des hôtes qui ne répondent plus' },
      `Supprimer les hors ligne (${horsLigne.length})`) : null;
    const bFusion = btn({ icone: 'pair', disabled: occupe, onclick: fusionner }, t('act.dedupe'));
    remplir(tete, entete({
      titre: t('page.devices.title'),
      lede: t('page.devices.lede', { total: devices.length, shown: liste.length }),
      actions: actionsPage([boutonBalayage()], [
        bHors && { texte: `Supprimer les hors ligne (${horsLigne.length})`, agir: supprimerHorsLigne, bouton: bHors, danger: true },
        { texte: t('act.dedupe'), agir: fusionner, bouton: bFusion },
      ]),
    }));
    remplir(filtres, ...LISTE_ETATS.map(e => h('button', {
      class: etat === e ? 'ftr on' : 'ftr', type: 'button', onclick: () => { etat = e; peindre(); },
    }, e === 'all' ? t('misc.all') : ETATS[e] || e)));
    remplir(corps, ...liste.map(d => {
      const l = liaison(d);
      return h('tr', { class: 'cliquable', onclick: () => choisirAppareil(d.id) },
        h('td', { class: 'principal' }, whoCell({ icone: glyphe(d), ton: d.status === 'banned' || d.status === 'quarantined' ? 'hot' : undefined, nom: nomAppareil(d), sous: d.ip })),
        h('td', { class: 'dim cache-l', text: d.vendor || t('misc.unknown') }),
        h('td', { class: 'cache-l' }, h('span', { class: 'tag' }, ic(l.icon, 13), l.label)),
        h('td', { class: 'mono dim cache-m', text: rattachement(d) }),
        h('td', { class: 'mono droite cache-m', text: String(d.ports?.length || 0) }),
        h('td', { class: 'cache-s' }, risque(d.dangerScore)),
        h('td', {}, chip(tonEtat(d.status), ETATS[d.status] || d.status)),
        h('td', { class: 'droite nowrap' }, d.isMainRouter ? null : h('button', {
          class: 'lnk', type: 'button', title: 'Supprimer cette fiche', 'aria-label': `Supprimer ${nomAppareil(d)}`,
          onclick: ev => { ev.stopPropagation(); supprimer(d); },
        }, '✕')));
    }));
    remplir(pied, liste.length === 0 ? vide(devices.length ? t('misc.none') : t('misc.noDevices'), 'devices') : '');
  }
  p.suivre(['devices', 'vlans', 'scanRunning'], peindre);
  peindre();

  return h('section', { class: 'page on' }, tete, message,
    carte({ titre: t('card.inventory'), tete: filtres },
      h('div', { class: 'recherche-carte' }, recherche),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { text: t('col.host') }), h('th', { class: 'cache-l', text: t('col.vendor') }), h('th', { class: 'cache-l', text: t('col.link') }),
          h('th', { class: 'cache-m', text: t('col.attach') }), h('th', { class: 'droite cache-m', text: t('col.ports') }),
          h('th', { class: 'cache-s', text: t('col.risk') }), h('th', { text: t('col.state') }), h('th'))),
        corps),
      pied));
}

export function pageVlans(p) {
  let ouvert = false, edition = null, occupe = false, msg = null;
  let form = { id: 10, name: '', subnet: '', color: '#1B2AFF', isolated: false, pushToRouter: true };
  const sec = h('section', { class: 'page on' });
  const compte = id => E.devices.filter(d => (d.vlan ?? d.vlanId) === id).length;

  const commencer = () => {
    form = { id: (E.vlans.reduce((m, v) => Math.max(m, v.id), 0) || 0) + 10, name: '', subnet: '', color: '#1B2AFF', isolated: false, pushToRouter: true };
    ouvert = true; edition = null; msg = null; peindre();
  };
  const modifier = v => { form = { ...v }; edition = v.id; ouvert = true; msg = null; peindre(); };

  /**
   * Relève les VLAN déclarés sur l'équipement.
   *
   * Sens inverse de « Ajouter » : rien n'est poussé sur la passerelle, on lit
   * sa configuration et on la range. Le nom et le sous-réseau viennent d'elle ;
   * la couleur et l'isolement restent ce que tu en as fait.
   */
  const relever = async () => {
    occupe = true; msg = null; peindre();
    try {
      const r = await api.post('/api/vlans/relever');
      await rafraichirVlans();
      await rafraichirAppareils().catch(() => { /* les VLAN relus suffisent au message ; les appareils suivront par le flux */ });
      if (r?.erreur) msg = { ok: false, texte: r.erreur };
      else {
        const bouts = [
          `${r.ajoutes} relevé(s)`,
          r.misAJour ? `${r.misAJour} mis à jour` : null,
          r.inchanges ? `${r.inchanges} inchangé(s)` : null,
          r.rattaches ? `${r.rattaches} appareil(s) rattaché(s)` : null,
          r.orphelins?.length ? `absent(s) de l'équipement : VLAN ${r.orphelins.join(', ')}` : null,
          ...(r.ignores || []),
        ].filter(Boolean);
        msg = { ok: true, texte: bouts.join(' · ') };
      }
    } catch (e) { msg = { ok: false, texte: e.message }; }
    finally { occupe = false; peindre(); }
  };

  const enregistrer = async () => {
    occupe = true; msg = null; peindre();
    try {
      if (edition != null) {
        // Une description jamais remplie vaut null : on ne la renvoie pas,
        // le serveur n'accepte qu'une chaîne.
        await api.patch(`/api/vlans/${edition}`, {
          name: form.name, subnet: form.subnet, color: form.color, isolated: !!form.isolated,
          ...(typeof form.description === 'string' ? { description: form.description } : {}),
        });
      } else {
        const r = await api.post('/api/vlans', { id: form.id, name: form.name, subnet: form.subnet, color: form.color, isolated: !!form.isolated, pushToRouter: !!form.pushToRouter });
        if (r?.provision?.pushed) msg = { ok: true, texte: `VLAN ${form.id} poussé sur ${r.provision.vendor}.` };
        else if (r?.provision?.output) msg = { ok: false, texte: r.provision.output };
        else msg = { ok: true, texte: `VLAN ${form.id} enregistré (base seule).` };
      }
      ouvert = false; edition = null;
      await rafraichirVlans();
    } catch (e) { msg = { ok: false, texte: e.message }; }
    finally { occupe = false; peindre(); }
  };

  const supprimer = async v => {
    if (!await confirmer(`Supprimer le VLAN ${v.id} ?`, `${v.name} sera aussi retiré de l'équipement.`, { danger: true, oui: t('action.delete') })) return;
    occupe = true; msg = null; peindre();
    try { await api.del(`/api/vlans/${v.id}?removeFromRouter=true`); await rafraichirVlans(); }
    catch (e) { msg = { ok: false, texte: e.message }; }
    finally { occupe = false; peindre(); }
  };

  const formulaire = () => {
    const enreg = btn({ solid: true, icone: 'check', disabled: occupe || !form.name || !form.subnet, onclick: enregistrer }, t('action.save'));
    const maj = () => { enreg.disabled = occupe || !form.name || !form.subnet; };
    const num = champ({ type: 'number', value: form.id, disabled: edition != null, 'aria-label': t('col.segment'), oninput: () => { form.id = parseInt(num.value) || 0; } });
    const nom = champ({ sans: true, value: form.name, placeholder: 'Objets connectés', 'aria-label': t('col.name'), oninput: () => { form.name = nom.value; maj(); } });
    const reseau = champ({ value: form.subnet, placeholder: '198.51.100.0/24', 'aria-label': t('col.subnet'), oninput: () => { form.subnet = reseau.value; maj(); } });
    return carte({ titre: edition != null ? `Modifier le VLAN ${edition}` : 'Nouveau segment' },
      h('div', { class: 'pad' },
        h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '110px 1fr 1fr auto', gap: 12, alignItems: 'end' } },
          h('div', {}, lbl(t('col.segment')), num),
          h('div', {}, lbl(t('col.name')), nom),
          h('div', {}, lbl(t('col.subnet')), reseau),
          enreg),
        h('div', { class: 'ligne-bascules' },
          interrupteur(!!form.isolated, v => { form.isolated = v; }, 'segment isolant (aucune route sortante)'),
          edition == null ? interrupteur(!!form.pushToRouter, v => { form.pushToRouter = v; }, "déclarer sur l'équipement") : null,
          h('button', { class: 'lnk pousse', type: 'button', onclick: () => { ouvert = false; edition = null; peindre(); } }, t('action.cancel')))));
  };

  function peindre() {
    const vlans = E.vlans, devices = E.devices;
    const isoles = vlans.filter(v => v.isolated).length;
    const repartis = devices.filter(d => (d.vlan ?? d.vlanId) != null).length;
    const segmentsUtilises = new Set(devices.map(d => d.vlan ?? d.vlanId).filter(x => x != null)).size;
    const quarantaine = devices.filter(d => d.status === 'quarantined');
    const bRelever = btn({ icone: 'refresh', onclick: relever, disabled: occupe }, occupe ? 'Relevé…' : "Relever depuis l'équipement");
    remplir(sec,
      entete({
        titre: t('page.vlans.title'), lede: t('page.vlans.lede'),
        actions: actionsPage([btn({ solid: true, icone: 'plus', onclick: commencer }, t('act.addVlan'))],
          [{ texte: "Relever depuis l'équipement", agir: relever, bouton: bRelever }]),
      }),
      figs(
        fig({ icone: 'vlan', libelle: t('fig.segments'), valeur: vlans.length, delta: `${isoles} isolant(s)` }),
        fig({ icone: 'devices', ton: 'plain', libelle: t('fig.spread'), valeur: repartis, delta: `sur ${segmentsUtilises} segment(s)` }),
        fig({ icone: 'alert', ton: 'warn', libelle: t('fig.quarantined'), valeur: quarantaine.length, delta: quarantaine.map(nomAppareil)[0] || 'aucun' }),
        fig({ icone: 'globe', libelle: t('fig.isolatedExit'), valeur: isoles, delta: 'sans route sortante' })),
      msg ? note(msg.ok ? 'info' : 'warn', msg.texte) : null,
      ouvert ? formulaire() : null,
      carte({ titre: t('card.segments'), note: t('card.segments.note') },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: t('col.segment') }), h('th', { text: t('col.name') }), h('th', { class: 'cache-m', text: t('col.subnet') }),
            h('th', { class: 'droite cache-s', text: t('col.devices') }), h('th', { class: 'cache-l', text: t('col.exit') }), h('th', { class: 'cache-s', text: t('col.state') }), h('th'))),
          h('tbody', {}, vlans.map(v => h('tr', {},
            h('td', { class: 'mono', text: String(v.id) }),
            h('td', { class: 'principal' }, h('b', { class: 'moyen tronque', text: v.name })),
            h('td', { class: 'mono cache-m', text: v.subnet }),
            h('td', { class: 'mono droite cache-s', text: String(compte(v.id)) }),
            h('td', { class: 'dim cache-l', text: v.isolated ? 'aucune' : 'directe' }),
            h('td', { class: 'cache-s' }, chip(v.isolated ? 'w' : 'a', v.isolated ? 'isolant' : 'actif')),
            h('td', { class: 'droite nowrap' },
              h('button', { class: 'lnk', type: 'button', onclick: () => modifier(v) }, t('action.edit')), ' · ',
              h('button', { class: 'lnk', type: 'button', onclick: () => supprimer(v) }, t('action.delete'))))))),
        vlans.length === 0 ? vide('Aucun segment déclaré', 'vlan') : null));
  }
  p.suivre(['vlans', 'devices'], () => { if (!ouvert) peindre(); });
  peindre();
  return sec;
}


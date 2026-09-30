// Fiche d'appareil.
//
// Panneau glissant depuis la droite : une plaque de tête avec la photo, quatre
// compteurs, puis les sections — profil, photo, identité, adresse, défense,
// interfaces, fusion, ports, failles, historique.
//
// La photo n'a pas de colonne côté serveur : elle vit dans ce navigateur.
import { confirmer, toast } from '/socle/compte.js';
import { h, ic, pictoType, remplir } from '../dom.js';
import { E, api, portee, rafraichirAppareils, choisirAppareil } from '../etat.js';
import { t } from '../i18n.js';
import { ETATS, nomAppareil } from '../communs.js';
import { composer, partieHote, verifier } from '../lib/adresses.js';
import { photoAppareil } from './photo.js';

// Catalogue des types proposés à la main. La valeur est ce qui est enregistré
// dans customType ; c'est elle qui choisit le picto partout ailleurs. La
// liste est exactement celle que le serveur admet (et que son classement
// produit) : un type hors liste serait refusé à l'enregistrement.
const TYPES = [
  ['router', 'Passerelle'], ['switch', 'Commutateur'], ['ap', 'Borne sans fil'],
  ['firewall', 'Pare-feu'], ['server', 'Serveur'], ['nas', 'Stockage'],
  ['hypervisor', 'Hyperviseur'], ['docker', 'Conteneur'], ['pc', 'Ordinateur'],
  ['laptop', 'Portable'], ['phone', 'Téléphone'], ['tablet', 'Tablette'],
  ['printer', 'Imprimante'], ['camera', 'Caméra'], ['tv', 'Téléviseur'],
  ['console', 'Console'], ['iot', 'Objet connecté'], ['pi', 'Nano-ordinateur'],
  ['voip', 'Téléphonie IP'], ['unknown', 'Inconnu'],
];

const FABRICANTS = [
  'Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Google', 'Microsoft', 'Intel',
  'Cisco', 'MikroTik', 'Ubiquiti', 'TP-Link', 'Asus', 'Netgear', 'D-Link',
  'Synology', 'QNAP', 'HP', 'Dell', 'Lenovo', 'Raspberry Pi', 'Espressif',
  'Sonoff', 'Shelly', 'Sonos', 'Philips Hue', 'VMware',
];

const clePhoto = id => `mapmylan_photo_${id}`;
function lirePhoto(id) { try { return localStorage.getItem(clePhoto(id)); } catch { return null; } }
function ecrirePhoto(id, url) {
  try { if (url) localStorage.setItem(clePhoto(id), url); else localStorage.removeItem(clePhoto(id)); }
  catch { /* stockage plein ou refusé : la photo reste à l'écran, sans plus */ }
}

const ligne = (k, v, mono) => h('div', { class: 'fl' }, h('span', { text: k }), h('b', { class: mono ? 'mono fl-mono' : '', text: String(v ?? '') }));

function jauge(libelle, valeur, teinte, fort) {
  const v = Math.max(0, Math.min(100, Math.round(valeur ?? 0)));
  return h('div', { class: fort ? 'fjauge fort' : 'fjauge' },
    h('div', { class: 'fjauge-t' }, h('span', { text: libelle }), h('span', { class: 'mono', style: { color: teinte }, text: `${v}/100` })),
    h('div', { class: 'fjauge-p' }, h('div', { style: { width: `${v}%`, background: teinte } })));
}

function resume(data) {
  if (!data) return '';
  if (data.action) return `${data.action}${data.reason ? ` (${data.reason})` : ''}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.changes) return `champs modifiés : ${Object.keys(data.changes).join(', ')}`;
  if (data.ip) return `${data.ip}${data.vendor ? `, ${data.vendor}` : ''}`;
  return JSON.stringify(data).slice(0, 80);
}

/** Branche la fiche sur l'appareil choisi : elle s'ouvre et se ferme seule. */
export function brancherFiche(p) {
  let ouverte = null;
  const fermer = () => choisirAppareil(null);
  p.suivre('selectedDeviceId', () => {
    ouverte?.fermer();
    ouverte = null;
    if (E.selectedDeviceId) ouverte = fiche(E.selectedDeviceId, fermer);
  });
  p.au(() => ouverte?.fermer());
}

function fiche(id, fermer) {
  const p = portee();
  let appareil = null, histo = [], edition = false, occupe = false, message = '';
  let photo = lirePhoto(id);
  const tete = h('div', { class: 'fhead' });
  const corps = h('div', { class: 'fcorps' }, h('div', { class: 'fchargement', text: t('misc.loading') }));
  const carteFiche = h('div', { class: 'fcarte large', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fiche' }, tete, corps);
  const voile = h('div', { class: 'feuille', onclick: ev => { if (ev.target === voile) fermer(); } }, carteFiche);
  document.body.append(voile);
  p.ecouter(document, 'keydown', ev => { if (ev.key === 'Escape' && !document.querySelector('.voile')) fermer(); });

  const rafraichir = async () => { appareil = await api.get(`/api/devices/${id}`); peindre(); };
  Promise.all([api.get(`/api/devices/${id}`), api.get(`/api/devices/${id}/history`)])
    .then(([d, hh]) => { appareil = d; histo = hh || []; peindre(); })
    .catch(e => { remplir(corps, h('div', { class: 'fchargement', text: e.message })); });

  const agir = async (libelle, fn) => {
    occupe = true; message = ''; peindre();
    try {
      const r = await fn();
      message = `${libelle}${r?.output ? `\n${String(r.output).trim().slice(0, 800)}` : ''}`;
      await rafraichir();
      await rafraichirAppareils();
    } catch (e) { message = `Échec : ${e.message}`; }
    finally { occupe = false; peindre(); }
  };
  const supprimerFiche = async () => {
    const nom = nomAppareil(appareil);
    const texte = appareil.status !== 'offline'
      ? `Il est encore en ligne : le prochain balayage le recréera, sans son historique ni ce que tu as saisi.`
      : 'Son historique et les champs saisis à la main disparaissent avec la fiche.';
    if (!await confirmer(`Supprimer ${nom} ?`, texte, { danger: true, oui: t('action.delete') })) return;
    occupe = true; peindre();
    try { await api.del(`/api/devices/${id}`); await rafraichirAppareils(); fermer(); }
    catch (e) { message = `Échec : ${e.message}`; occupe = false; peindre(); }
  };

  function formulaire() {
    const f = {
      customName: appareil.customName || '', customType: appareil.customType || '', vendor: appareil.vendor || '', model: appareil.model || '',
      vlan: appareil.vlan ?? '', zone: appareil.zone || '', role: appareil.role || '', notes: appareil.notes || '', tags: (appareil.tags || []).join(', '),
    };
    const saisie = (cle, lib, props = {}) => {
      const el = h(props.multiligne ? 'textarea' : 'input', { class: 'field mml', rows: props.multiligne ? 3 : undefined, placeholder: props.placeholder, list: props.list, 'aria-label': lib });
      el.value = f[cle];
      el.addEventListener('input', () => { f[cle] = el.value; });
      return h('div', { class: props.large ? 'plein' : '' }, h('label', { class: 'lbl', text: lib }), el);
    };
    const type = h('select', { class: 'field mml', 'aria-label': 'Type' },
      h('option', { value: '' }, `automatique (${appareil.type})`), TYPES.map(([v, l]) => h('option', { value: v }, l)));
    type.value = f.customType;
    type.addEventListener('change', () => { f.customType = type.value; });
    // Le VLAN se choisit dans les segments relevés : un numéro saisi à la main
    // est un numéro qu'on peut inventer. Celui posé avant le relevé reste
    // dans la liste, marqué comme tel.
    const vlan = h('select', { class: 'field mml', 'aria-label': 'VLAN' },
      h('option', { value: '' }, '— aucun —'),
      E.vlans.map(v => h('option', { value: String(v.id) }, `VLAN ${v.id} · ${v.name}`)),
      f.vlan !== '' && f.vlan != null && !E.vlans.some(v => String(v.id) === String(f.vlan)) ? h('option', { value: String(f.vlan) }, `VLAN ${f.vlan} · hors relevé`) : null);
    vlan.value = String(f.vlan ?? '');
    vlan.addEventListener('change', () => { f.vlan = vlan.value; });
    const enregistrer = async () => {
      const corpsPatch = {
        customName: f.customName, customType: f.customType, vendor: f.vendor, model: f.model, zone: f.zone, role: f.role, notes: f.notes,
        tags: String(f.tags || '').split(',').map(x => x.trim()).filter(Boolean),
        vlan: f.vlan === '' || f.vlan == null ? null : parseInt(String(f.vlan), 10),
      };
      try { await api.patch(`/api/devices/${id}`, corpsPatch); await rafraichir(); edition = false; peindre(); }
      catch (e) { toast(e.message, true); }
    };
    return h('div', { class: 'fedition' },
      saisie('customName', 'Nom donné'),
      h('div', {}, h('label', { class: 'lbl', text: 'Type' }), type),
      h('div', {}, h('label', { class: 'lbl', text: 'Fabricant' }), (() => {
        const el = h('input', { class: 'field mml', list: 'fabricants', 'aria-label': 'Fabricant' });
        el.value = f.vendor;
        el.addEventListener('input', () => { f.vendor = el.value; });
        return el;
      })(), h('datalist', { id: 'fabricants' }, FABRICANTS.map(v => h('option', { value: v })))),
      saisie('model', 'Modèle'),
      h('div', { class: 'min0' }, h('label', { class: 'lbl', text: 'VLAN' }), vlan),
      saisie('zone', 'Zone'),
      saisie('role', 'Rôle'),
      saisie('tags', 'Étiquettes', { placeholder: 'séparées par des virgules' }),
      saisie('notes', 'Notes', { multiligne: true, large: true }),
      h('div', { class: 'plein fedition-boutons' },
        h('button', { class: 'btn', type: 'button', onclick: () => { edition = false; peindre(); } }, t('action.cancel')),
        h('button', { class: 'btn solid', type: 'button', onclick: enregistrer }, t('action.save'))));
  }

  const zonePhoto = h('div');
  let photoMontee = false;
  const zoneAdresse = h('div');
  let adresseMontee = false;

  function peindre() {
    if (!appareil) return;
    const a = appareil;
    const nom = nomAppareil(a);
    const dangereux = a.dangerScore > 70;
    const ports = a.ports || [], failles = a.cves || [];
    remplir(tete,
      h('span', { class: dangereux ? 'ivig gros danger' : 'ivig gros' },
        photo ? h('img', { src: photo, alt: '', class: 'ivig-photo' }) : ic(pictoType(a.customType || a.type), 22)),
      h('div', { class: 'grow' }, h('h2', { text: nom }), h('p', { class: 'mono', text: `${a.ip} · ${a.mac || 'sans MAC'} · ${a.vendor || 'fabricant inconnu'}` })),
      h('span', { class: `chip ${a.status === 'online' ? 'a' : a.status === 'offline' ? '' : 'w'}`, text: ETATS[a.status] || a.status }),
      h('button', { class: 'fx', type: 'button', 'aria-label': t('action.close'), onclick: fermer }, '×'));
    if (!photoMontee) {
      zonePhoto.append(photoAppareil(p, photo, url => { photo = url; ecrirePhoto(id, url); peindre(); }));
      photoMontee = true;
    }
    if (!adresseMontee) { zoneAdresse.append(adresse(a, async () => { await rafraichir(); await rafraichirAppareils(); })); adresseMontee = true; }
    const vlanTxt = (() => {
      if (a.vlan == null) return '—';
      const v = E.vlans.find(x => x.id === a.vlan);
      return v ? `${v.id} · ${v.name}` : String(a.vlan);
    })();
    const titre = (texte, lien) => h('div', { class: 'ftitre marge' }, texte, lien || null);
    remplir(corps,
      h('div', { class: 'fcompte' },
        h('div', {}, h('span', { text: 'Risque' }), h('b', { class: dangereux ? 'alarme' : '', text: String(Math.round(a.dangerScore || 0)) })),
        h('div', {}, h('span', { text: 'Confiance' }), h('b', { text: String(Math.round(a.trustScore || 0)) })),
        h('div', {}, h('span', { text: 'Ports' }), h('b', { text: String(ports.length) })),
        h('div', {}, h('span', { text: 'Failles' }), h('b', { class: failles.length ? 'alarme' : '', text: String(failles.length) }))),
      h('div', { class: 'ftitre', text: 'Profil' }),
      jauge('Confiance', a.trustScore, 'var(--accent)'),
      jauge('Activité', a.activityScore, 'var(--warn)'),
      jauge('Vulnérabilité', a.vulnScore, 'var(--warn)'),
      jauge('Danger', a.dangerScore, dangereux ? 'var(--alarm)' : 'var(--ink-soft)', true),
      a.scoreReasons ? h('details', { class: 'fraisons' }, h('summary', { text: 'Comment cette note est faite' }),
        h('div', {}, ['trust', 'activity', 'vuln'].map(k => {
          const liste = a.scoreReasons[k] || [];
          if (!liste.length) return null;
          return h('div', { class: 'fraison' }, h('div', { class: 'lbl', text: k === 'trust' ? 'confiance' : k === 'activity' ? 'activité' : 'vulnérabilité' }),
            liste.map(r => h('div', { class: 'fl' }, h('span', { text: r.reason }), h('b', { style: { color: r.delta > 0 ? 'var(--warn)' : 'var(--accent)' }, text: `${r.delta > 0 ? '+' : ''}${r.delta}` }))));
        }))) : null,
      h('div', { class: 'fespace' }),
      zonePhoto,
      h('div', { class: 'fphoto-note', text: 'La photo est enregistrée dans ce navigateur, pas sur le serveur.' }),
      titre('Identité', h('button', { class: 'lnk ftitre-lien', type: 'button', onclick: () => { edition = !edition; peindre(); } }, edition ? 'annuler' : 'modifier')),
      !edition ? [
        ligne('Adresse', a.ip, true), ligne('MAC', a.mac || '—', true), ligne('Nom relevé', a.hostname || '—'), ligne('Nom donné', a.customName || '—'),
        ligne('Fabricant', a.vendor || '—'), ligne('Modèle', a.model || '—'), ligne('Système', a.os || '—'), ligne('Type', a.customType || a.type),
        ligne('VLAN', vlanTxt, true), ligne('Zone', a.zone || '—'), ligne('Rôle', a.role || '—'), ligne('Étiquettes', (a.tags || []).join(', ') || '—'),
        ligne('Vu la première fois', new Date(a.firstSeen).toLocaleString(), true), ligne('Vu la dernière fois', new Date(a.lastSeen).toLocaleString(), true),
        a.notes ? h('div', { class: 'fnotes' }, h('div', { class: 'lbl', text: 'Notes' }), h('div', { class: 'fnotes-t', text: a.notes })) : null,
      ] : formulaire(),
      titre('Adresse'), zoneAdresse,
      titre('Défense'),
      a.isMainRouter
        ? h('div', { class: 'note info' }, ic('shield', 15, { style: { marginTop: 1 } }), h('span', { text: "L'équipement principal est protégé : aucune action de défense ne lui est applicable." }))
        : h('div', { class: 'fdefense' },
          h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: () => agir('Appareil isolé.', () => api.post(`/api/devices/${id}/quarantine`, {})) }, ic('alert', 14), 'Isoler'),
          h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: () => agir('Appareil bloqué.', () => api.post(`/api/devices/${id}/ban`, {})) }, ic('ban', 14), 'Bloquer'),
          a.status === 'banned' || a.status === 'quarantined'
            ? h('button', { class: 'btn solid', type: 'button', disabled: occupe, onclick: () => agir('Accès rendu.', () => api.post(`/api/devices/${id}/unban`)) }, ic('check', 14), "Rendre l'accès") : null,
          h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: () => agir('Liste blanche mise à jour.', () => api.patch(`/api/devices/${id}`, { whitelisted: !a.whitelisted })) },
            ic('shield', 14), a.whitelisted ? 'Retirer de la liste blanche' : 'Liste blanche'),
          h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: () => agir('Note recalculée.', () => api.post(`/api/devices/${id}/score`)) }, ic('refresh', 14), 'Recalculer la note'),
          h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: () => agir('Balayage approfondi lancé.', () => api.post(`/api/devices/${id}/deep-scan`)) }, ic('search', 14), 'Balayage approfondi')),
      message ? h('pre', { class: message.startsWith('Échec') ? 'fmessage echec' : 'fmessage', text: message }) : null,
      interfaces(a, rafraichir),
      fusion(a, rafraichir),
      ports.length ? [titre(`Ports ouverts · ${ports.length}`), h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Port' }), h('th', { text: 'Protocole' }), h('th', { text: 'Service' }), h('th', { class: 'cache-s', text: 'Version' }))),
        h('tbody', {}, ports.map(q => h('tr', {},
          h('td', { class: 'mono' }, h('b', { class: 'moyen', text: String(q.port) })),
          h('td', { class: 'dim mono', text: q.protocol || q.proto || 'tcp' }),
          h('td', { text: q.service || '—' }),
          h('td', { class: 'dim cache-s', text: [q.product, q.version].filter(Boolean).join(' ') || '—' })))))] : null,
      failles.length ? [titre(`Failles · ${failles.length}`), failles.map(c => h('div', { class: 'ffaille' },
        h('div', { class: 'ffaille-t' }, h('b', { class: 'mono', text: c.cveId }), h('span', { class: 'chip w pousse', text: `CVSS ${c.cvss}` })),
        h('div', { class: 'ffaille-d', text: c.description || '' }),
        c.service ? h('div', { class: 'mono ffaille-s', text: c.service }) : null))] : null,
      titre('Historique'),
      histo.length === 0 ? h('div', { class: 'fvide', text: "Rien d'enregistré pour l'instant." }) : null,
      histo.map(x => h('div', { class: 'fl' }, h('span', { class: 'mono fl-date', text: new Date(x.createdAt).toLocaleString() }), h('b', { class: 'fl-hist', text: `${x.event} — ${resume(x.data)}` }))),
      a.isMainRouter ? null : [
        h('div', { class: 'ftitre marge-plus', text: 'Supprimer' }),
        h('div', { class: 'explication', text: a.status === 'offline'
          ? 'Cet hôte ne répond plus. Sa fiche peut être effacée : son historique et les champs saisis à la main partent avec elle.'
          : "Cet hôte est encore en ligne. Effacer sa fiche ne l'empêche pas de revenir au prochain balayage — mais l'historique et ce que tu as saisi seront perdus." }),
        h('div', { class: 'fboutons' }, h('button', { class: 'btn alarme', type: 'button', disabled: occupe, onclick: supprimerFiche }, ic('ban', 14), 'Supprimer la fiche')),
      ]);
  }

  return { fermer: () => { p.fermer(); voile.remove(); } };
}

// Interfaces réseau
function interfaces(appareil, surChange) {
  const liste = appareil.interfaces || [];
  // La carte principale n'est pas toujours dans la table : on la reconstitue
  // pour que la fiche montre bien toutes les faces de l'appareil.
  const principale = appareil.mac && !liste.find(i => i.mac === appareil.mac)
    ? { id: '_principale', mac: appareil.mac, ip: appareil.ip, type: 'ethernet', label: 'principale', virtuelle: true } : null;
  const toutes = principale ? [principale, ...liste] : liste;
  const f = { mac: '', ip: '', type: 'ethernet', label: '' };
  const zoneForm = h('div', { class: 'finterface', hidden: true });
  const lien = h('button', { class: 'lnk ftitre-lien', type: 'button', text: 'ajouter' });
  lien.addEventListener('click', () => { zoneForm.hidden = !zoneForm.hidden; lien.textContent = zoneForm.hidden ? 'ajouter' : 'annuler'; });
  const saisie = (cle, lib, placeholder) => {
    const el = h('input', { class: 'field mml', placeholder, 'aria-label': lib });
    el.addEventListener('input', () => { f[cle] = el.value; });
    return h('div', {}, h('label', { class: 'lbl', text: lib }), el);
  };
  const type = h('select', { class: 'field mml', 'aria-label': 'Type' }, [['ethernet', 'filaire'], ['wifi', 'sans fil'], ['virtual', 'virtuelle'], ['other', 'autre']].map(([v, l]) => h('option', { value: v }, l)));
  type.addEventListener('change', () => { f.type = type.value; });
  zoneForm.append(
    h('div', {}, h('label', { class: 'lbl', text: 'Type' }), type),
    saisie('label', 'Nom', 'eth0, wlan0…'), saisie('mac', 'MAC', 'aa:bb:cc:dd:ee:ff'), saisie('ip', 'Adresse', '192.0.2.10'),
    h('div', { class: 'plein droite-flex' }, h('button', { class: 'btn solid', type: 'button', onclick: async () => {
      try {
        await api.post(`/api/devices/${appareil.id}/interfaces`, { ...(f.mac ? { mac: f.mac } : {}), ...(f.ip ? { ip: f.ip } : {}), type: f.type, ...(f.label ? { label: f.label } : {}) });
        await surChange();
      } catch (e) { toast(e.message, true); }
    } }, 'Ajouter')));
  const retirer = async ifaceId => {
    if (!await confirmer('Retirer cette interface ?', '', { danger: true, oui: 'Retirer' })) return;
    try { await api.del(`/api/devices/${appareil.id}/interfaces/${ifaceId}`); await surChange(); } catch (e) { toast(e.message, true); }
  };
  return [
    h('div', { class: 'ftitre marge' }, `Interfaces · ${toutes.length}`, lien),
    toutes.length === 0 ? h('div', { class: 'fvide', text: 'Aucune interface déclarée. En ajouter une permet de suivre un appareil qui a plusieurs faces — filaire et sans fil, par exemple.' }) : null,
    toutes.map(i => h('div', { class: 'zrow nu' },
      h('span', { class: 'ivig' }, ic(i.type === 'wifi' ? 'air' : i.type === 'virtual' ? 'server' : 'wired', 14)),
      h('span', { class: 'zrow-c' }, h('b', { text: i.label || i.type }), h('small', { text: `${i.mac || 'sans MAC'} · ${i.ip || 'sans adresse'}` })),
      i.virtuelle ? h('span', { class: 'chip a', text: 'principale' }) : h('button', { class: 'lnk', type: 'button', onclick: () => retirer(i.id) }, 'retirer'))),
    zoneForm,
  ];
}

// Fusion de deux relevés
function fusion(appareil, surFusion) {
  let filtre = '', occupe = false;
  const zone = h('div', { hidden: true });
  const lien = h('button', { class: 'lnk ftitre-lien', type: 'button', text: 'fusionner…' });
  const liste = h('div', { class: 'ffusion-liste' });
  const peindre = () => {
    const q = filtre.toLowerCase();
    const candidats = E.devices.filter(d => d.id !== appareil.id && !d.isMainRouter && (!q || [d.ip, d.mac, d.hostname, d.customName, d.vendor].filter(Boolean).some(v => String(v).toLowerCase().includes(q))));
    remplir(liste, ...candidats.slice(0, 30).map(d => {
      const lib = d.customName || d.hostname || d.ip;
      const agir = async () => {
        if (occupe) return;
        if (!await confirmer(`Absorber « ${lib} » dans cet appareil ?`, "Sa MAC deviendra une interface d'ici, et l'autre fiche disparaîtra.", { oui: 'Fusionner' })) return;
        occupe = true; peindre();
        try { await api.post(`/api/devices/${appareil.id}/merge`, { sourceId: d.id }); await rafraichirAppareils(); await surFusion(); }
        catch (e) { toast(e.message, true); }
        finally { occupe = false; peindre(); }
      };
      return h('div', { class: occupe ? 'zrow nu cliquable occupe' : 'zrow nu cliquable', role: 'button', tabindex: '0', onclick: agir, onkeydown: ev => { if (ev.key === 'Enter') agir(); } },
        h('span', { class: 'ivig' }, ic(pictoType(d.customType || d.type), 14)),
        h('span', { class: 'zrow-c' }, h('b', { text: lib }), h('small', { text: `${d.ip} · ${d.mac || 'sans MAC'} · ${d.vendor || '?'}` })),
        ic('pair', 15, { style: { color: 'var(--accent)' } }));
    }), candidats.length === 0 ? h('div', { class: 'fvide centre', text: 'Aucun candidat' }) : '');
  };
  const champFiltre = h('input', { class: 'field mml', placeholder: 'filtrer…', 'aria-label': 'Filtrer les candidats' });
  champFiltre.addEventListener('input', () => { filtre = champFiltre.value; peindre(); });
  zone.append(h('div', { class: 'explication bas', text: "Choisis l'autre relevé qui désigne en réalité la même machine — la face sans fil du même portable, par exemple. Sa MAC et son historique viennent ici, et le doublon disparaît." }), champFiltre, liste);
  lien.addEventListener('click', () => { zone.hidden = !zone.hidden; lien.textContent = zone.hidden ? 'fusionner…' : 'annuler'; if (!zone.hidden) peindre(); });
  return [h('div', { class: 'ftitre marge' }, 'Même machine ?', lien), zone];
}

/**
 * Adresse réservée pour cet appareil.
 *
 * Cet écran ne réécrit pas la configuration réseau de la machine — personne ne
 * peut faire ça à distance sans agent. Il demande à la passerelle de toujours
 * servir cette adresse-là à cette carte réseau. Le VLAN se choisit dans une
 * liste, et c'est lui qui décide du début de l'adresse : le masque fige les
 * premiers octets, on les affiche sans les rendre modifiables.
 */
function adresse(appareil, surChange) {
  const racine = h('div', {}, h('div', { class: 'fvide', text: 'Lecture des segments…' }));
  let etat = null, vlan = null, hote = '', occupe = false, message = null;
  api.get(`/api/devices/${appareil.id}/reservation`).then(r => {
    etat = r;
    // On ouvre sur le segment où l'appareil se trouve déjà : c'est le cas de
    // loin le plus fréquent, et ça évite un clic pour ne rien changer.
    const actuel = (r.segments || []).find(sg => sg.plage && appareil.ip && partieHote(appareil.ip, sg.plage.octetsFiges) && sg.plage.prefixe && String(appareil.ip).startsWith(sg.plage.prefixe + '.'));
    const choisi = actuel || (r.segments || []).find(sg => sg.id === r.vlan) || null;
    if (choisi) { vlan = choisi.id; hote = actuel ? partieHote(appareil.ip, choisi.plage.octetsFiges) : ''; }
    peindre();
  }).catch(() => { etat = { segments: [] }; peindre(); });

  const appel = async fn => {
    occupe = true; message = null; peindre();
    try { const r = await fn(); message = { ok: true, texte: r.message || r.sortie }; await surChange(); }
    catch (e) { message = { ok: false, texte: e.message }; }
    finally { occupe = false; peindre(); }
  };

  function peindre() {
    if (!etat) return;
    if (!appareil.mac) {
      remplir(racine, h('div', { class: 'aide sans-marge', text: 'Aucune adresse MAC relevée pour cet appareil. Une réservation se pose sur une carte réseau, pas sur une adresse : sans MAC, il n’y a rien à réserver.' }));
      return;
    }
    const segments = etat.segments || [];
    if (!segments.length) {
      remplir(racine, h('div', { class: 'aide sans-marge' }, 'Aucun segment connu. Relève d’abord les VLAN depuis l’équipement, page', h('b', { class: 'moyen', text: ' VLAN' }), '.'));
      return;
    }
    const segment = segments.find(sg => sg.id === vlan) || null;
    const plage = segment?.plage || null;
    const prefixe = plage?.prefixe || '';
    const ip = composer(prefixe, hote);
    const controle = hote.trim() ? verifier(ip, plage, segment?.passerelle) : { ok: false };
    const choix = h('select', { class: 'field mml', 'aria-label': 'Segment' },
      h('option', { value: '' }, '— choisir —'), segments.map(sg => h('option', { value: String(sg.id) }, `VLAN ${sg.id} · ${sg.nom}`)));
    choix.value = vlan == null ? '' : String(vlan);
    choix.addEventListener('change', () => {
      vlan = choix.value === '' ? null : Number(choix.value); message = null;
      const sg = segments.find(x => x.id === vlan);
      // On garde la fin de l'adresse actuelle si l'appareil est déjà dans ce
      // segment ; sinon le champ part vide, parce qu'on n'a rien à proposer.
      hote = sg?.plage && appareil.ip && String(appareil.ip).startsWith(sg.plage.prefixe + '.') ? partieHote(appareil.ip, sg.plage.octetsFiges) : '';
      peindre();
    });
    const saisie = h('input', { class: 'fadresse-fin', disabled: !segment, placeholder: plage ? partieHote(plage.derniere, plage.octetsFiges) : '', 'aria-label': 'Fin de l’adresse' });
    saisie.value = hote;
    const aideAdresse = h('div', { class: 'fadresse-aide' });
    const poser = h('button', { class: 'btn solid', type: 'button', disabled: occupe || !controle.ok, onclick: () => appel(() => api.post(`/api/devices/${appareil.id}/reservation`, { vlan, ip: composer(prefixe, hote) })) }, occupe ? '…' : 'Réserver cette adresse');
    const bordure = h('div', { class: 'fadresse-champ' }, h('span', { class: 'fadresse-debut', text: prefixe ? prefixe + '.' : '' }), saisie);
    const peindreControle = () => {
      const c = hote.trim() ? verifier(composer(prefixe, hote), plage, segment?.passerelle) : { ok: false };
      bordure.classList.toggle('ko', !!hote.trim() && !c.ok);
      aideAdresse.classList.toggle('ko', !!hote.trim() && !c.ok);
      aideAdresse.textContent = !plage ? '' : hote.trim() && !c.ok ? c.raison
        : `${segment.sousReseau} · de ${plage.premiere} à ${plage.derniere}${segment?.passerelle ? ` · passerelle ${segment.passerelle}` : ''}`;
      poser.disabled = occupe || !c.ok;
    };
    saisie.addEventListener('input', () => { saisie.value = saisie.value.replace(/[^0-9.]/g, ''); hote = saisie.value; message = null; peindreControle(); });
    peindreControle();
    remplir(racine,
      // minmax(0, …) plutôt que 1fr : sans ça une colonne de grille refuse de
      // descendre sous la largeur de son contenu.
      h('div', { class: 'fadresse' },
        h('div', { class: 'min0' }, h('label', { class: 'lbl', text: 'Segment' }), choix),
        h('div', { class: 'min0' }, h('label', { class: 'lbl', text: 'Adresse' }), bordure, plage ? aideAdresse : null)),
      h('div', { class: 'fadresse-boutons' }, poser,
        h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: async () => {
          if (await confirmer('Retirer la réservation ?', "L'appareil repassera en adresse dynamique.", { oui: 'Retirer' })) appel(() => api.post(`/api/devices/${appareil.id}/reservation`, { retirer: true }));
        } }, 'Retirer la réservation'),
        h('button', { class: 'btn', type: 'button', disabled: occupe, onclick: () => appel(() => api.post(`/api/devices/${appareil.id}/relancer-bail`)) }, 'Forcer la reprise de bail')),
      message ? h('div', { class: message.ok ? 'fadresse-msg' : 'fadresse-msg ko', text: message.texte || '' }) : null,
      h('div', { class: 'aide', text: "MapMyLAN ne réécrit pas la configuration de la machine — personne ne peut faire ça à distance. Il demande à la passerelle de toujours servir cette adresse à cette carte réseau : l'appareil la prendra à son prochain bail, ou tout de suite si tu forces la reprise. Et choisir un segment ici ne déplace pas l'appareil de VLAN : ça dit de quel réseau l'adresse relève. Le VLAN d'un appareil se décide par le port ou le SSID, sur l'équipement." }));
  }
  return racine;
}

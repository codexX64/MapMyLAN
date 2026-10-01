// Parcours réel de MapMyLAN dans Chromium, contre le vrai serveur.
//
// Une instance d'essai démarre ici (port libre, base temporaire), avec le
// réseau simulé au seul point où MapMyLAN lance un programme : balayage,
// clés d'hôte et consoles répondent comme un petit parc en adresses de
// documentation. Puis, comme un administrateur : installation par clé
// d'accès virtuelle, mise en route, balayage, chaque page et chaque fenêtre
// aux sept largeurs — aucun chevauchement, aucune erreur de console, aucune
// requête refusée hors des renforts attendus. Les actions sensibles passent
// par le renfort du socle et doivent être rejouées. Un compte en lecture
// seule refait enfin le tour de ce qui lui est ouvert.
//
//   node outils/parcours-navigateur.mjs [dossier des captures] [--gestes]
//
// --gestes : une seule largeur par écran, pour mettre au point un geste vite.
//
// Playwright et Chromium viennent de l'environnement d'essai, hors du dépôt.
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chevauchements, LARGEURS } from '../socle/essai/mise-en-page.mjs';
import { Client } from '../socle/essai/client.js';
import { codeTotp } from '../socle/essai/inscription.js';
import { lancer, serveurLocal, JETON_INSTALLATION, ReseauSimule } from '../test/aides.js';

const parametres = process.argv.slice(2);
const sortie = parametres.find(a => !a.startsWith('--')) || '/tmp/captures-mapmylan/parcours';
const seulementGestes = parametres.includes('--gestes');
fs.mkdirSync(sortie, { recursive: true });
const MOT_DE_PASSE = 'phrase de passe pour mapmylan en local';
const CAPTURES = [360, 768, 1280, 1920];

// Le parc simulé : ce que les outils de découverte rendraient sur un réseau
// de documentation. Les types se déduisent des noms et des ports, comme
// sur un vrai réseau ; aucun nom de fabricant réel.
const PARC = [
  { ip: '192.0.2.1', nom: 'passerelle', fabricant: 'Constructeur A', os: 'Linux 5.15', ports: [[22, 'ssh', 'OpenSSH 9.6'], [53, 'domain', 'dnsmasq 2.90'], [80, 'http'], [443, 'https']] },
  { ip: '192.0.2.2', nom: 'sw-baie', fabricant: 'Constructeur A', ports: [[22, 'ssh'], [80, 'http']] },
  { ip: '192.0.2.3', nom: 'ap-couloir', fabricant: 'Constructeur A', ports: [[22, 'ssh'], [443, 'https']] },
  { ip: '192.0.2.10', nom: 'serveur-a', fabricant: 'Constructeur B', os: 'Linux 6.1', ports: [[22, 'ssh', 'OpenSSH 8.2p1 Debian'], [80, 'http', 'nginx 1.18.0'], [443, 'https', 'nginx 1.18.0'], [5432, 'postgresql']] },
  { ip: '192.0.2.11', nom: 'nas-b', fabricant: 'Constructeur B', ports: [[22, 'ssh'], [139, 'netbios-ssn'], [445, 'microsoft-ds'], [5000, 'http']] },
  { ip: '192.0.2.40', nom: 'camera-7', fabricant: 'Constructeur C', ports: [[23, 'telnet'], [80, 'http'], [554, 'rtsp']] },
  { ip: '192.0.2.41', nom: 'camera-8', fabricant: 'Constructeur C', ports: [[554, 'rtsp']] },
  { ip: '192.0.2.50', nom: 'imprimante-2', fabricant: 'Constructeur D', ports: [[631, 'ipp'], [9100, 'jetdirect']] },
  { ip: '192.0.2.60', nom: 'bureau-3', fabricant: 'Constructeur E', os: 'Windows 11', ports: [[139, 'netbios-ssn'], [445, 'microsoft-ds'], [3389, 'ms-wbt-server']] },
  { ip: '192.0.2.61', nom: 'portable-5', fabricant: 'Constructeur E', ports: [] },
  { ip: '192.0.2.70', nom: 'telephone-4', fabricant: 'Constructeur F', os: 'Android 14', ports: [] },
  { ip: '192.0.2.80', nom: 'tv-1', fabricant: 'Constructeur G', ports: [[8008, 'http']] },
  { ip: '192.0.2.90', nom: 'capteur-9', fabricant: 'Constructeur H', ports: [[1883, 'mqtt']] },
].map((a, i) => ({ ...a, mac: `00:00:5E:00:53:${(i + 1).toString(16).toUpperCase().padStart(2, '0')}` }));

// Ce que la passerelle répond en SSH, au-delà de ce que sait déjà le réseau
// simulé des essais (clé d'hôte vérifiée, mot de passe lu par SSH_ASKPASS).
class ParcSimule extends ReseauSimule {
  constructor() {
    super();
    const arp = ['IP address       HW type     Flags       HW address            Mask     Device',
      ...PARC.slice(1).map(a => `${a.ip}  0x1  0x2  ${a.mac.toLowerCase()}  *  br-lan`)].join('\n');
    const baux = PARC.slice(1).map(a => `1900000000 ${a.mac.toLowerCase()} ${a.ip} ${a.nom} *`).join('\n');
    this.reponses = [[/proc\/net\/arp/, arp + '\n'], [/leases/, baux + '\n'], [/^ip neigh/, arp + '\n']];
    this.sorties = {
      ip: args => (args[0] === '-4' ? '2: eth0    inet 192.0.2.5/24 brd 192.0.2.255 scope global eth0\n' : args[0] === 'route' ? 'default via 192.0.2.1 dev eth0\n' : ''),
      'arp-scan': PARC.map(a => `${a.ip}\t${a.mac}\t${a.fabricant}`).join('\n') + '\n',
      nmap: args => (args.includes('-sn') ? PARC.map(a => `Host: ${a.ip} ()\tStatus: Up`).join('\n') + '\n' : this.detail(args.at(-1))),
      ping: '2 packets transmitted, 2 received\nrtt min/avg/max/mdev = 0.3/0.42/0.5/0.1 ms\n',
      'avahi-browse': '=;eth0;IPv4;imprimante-2;_ipp._tcp;local;imprimante-2.local;192.0.2.50;631;\n',
      nmblookup: [1, '', ''],
      snmpget: [1, '', ''],
    };
  }

  detail(ip) {
    const a = PARC.find(x => x.ip === ip);
    if (!a) return [1, '', 'Failed to resolve'];
    return [0, [`Nmap scan report for ${ip}`, 'Host is up (0.00030s latency).', 'PORT     STATE SERVICE    VERSION',
      ...a.ports.map(([p, service, version]) => `${p}/tcp open  ${service}${version ? ` ${version}` : ''}`),
      `MAC Address: ${a.mac} (${a.fabricant})`, ...(a.os ? [`OS details: ${a.os}`] : [])].join('\n') + '\n', ''];
  }

  ssh(appel, fin) {
    const commande = appel.args.at(-1);
    const connue = this.reponses.find(([re]) => re.test(commande))?.[1];
    return super.ssh(appel, (code, stdout, stderr) => fin(code, code === 0 && connue !== undefined ? connue : stdout, stderr));
  }
}

const reseau = new ParcSimule();
// Le bot démarre dès que la messagerie est enregistrée : il relève un faux
// service local, jamais le vrai.
const telegram = await serveurLocal((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.includes('/getUpdates')) setTimeout(() => res.end('{"ok":true,"result":[]}'), 300);
  else res.end('{"ok":true,"result":{}}');
});
// SOCLE_THEME=console refait tout le parcours dans la gamme Console.
const GAMME = process.env.SOCLE_THEME || 'soma';
const o = await lancer({ SCAN_SUBNET: '192.0.2.0/24', SOCLE_THEME: GAMME }, { executeur: reseau.executeur, telegramBase: telegram.url });
// localhost et non 127.0.0.1 : une clé d'accès se lie à un nom de domaine.
const base = `http://localhost:${o.port}`;

const navigateur = await chromium.launch();
const rapport = [], gestes = [], erreurs = [], refus = [], consoles403 = [];
let renforts403 = 0;

// Une page ouverte sur l'instance : erreurs de console, exceptions et
// réponses refusées sont notées. Un 403 qui demande le renfort est attendu
// (le socle ouvre alors sa fenêtre et rejoue) ; Chromium le signale aussi en
// console, sans le corps : autant de lignes « 403 » que de renforts sont
// écartées à la fin, les autres restent des erreurs.
async function ouvrir(nom, { cookies } = {}) {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 860 } });
  if (cookies) await contexte.addCookies(cookies);
  const page = await contexte.newPage();
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/status of 403/.test(m.text())) consoles403.push(`${nom} : ${m.text()}`);
    else erreurs.push(`${nom} : ${m.text()}`);
  });
  page.on('pageerror', e => erreurs.push(`${nom} : ${String(e)}`));
  page.on('response', async r => {
    if (!r.url().startsWith(base) || r.status() < 400) return;
    const corps = await r.json().catch(() => null);
    if (r.status() === 403 && corps?.details?.renfort) { renforts403 += 1; return; }
    refus.push(`${nom} : ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()} ${corps?.error || ''}`);
  });
  return { contexte, page };
}

// Une valeur que le serveur ne rend pas, ou pas sous la forme attendue, se
// voit à l'écran sous l'une de ces formes.
const textesBruts = () => [...document.body.innerText.matchAll(/\b(undefined|NaN|null|Invalid Date)\b|\[object Object\]/g)]
  .slice(0, 3).map(m => ({ type: 'texte-brut', detail: m[0] }));

async function controle(page, nom, { attendre = 250, largeurs = LARGEURS, captures = CAPTURES } = {}) {
  for (const w of seulementGestes ? [1280] : largeurs) {
    await page.setViewportSize({ width: w, height: w < 500 ? 780 : 900 });
    await page.waitForTimeout(attendre);
    rapport.push({ ecran: nom, largeur: w, defauts: [...await page.evaluate(chevauchements), ...await page.evaluate(textesBruts)] });
    if (captures.includes(w)) await page.screenshot({ path: `${sortie}/${nom}-${w}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(150);
}

async function geste(nom, fn, p = page) {
  try {
    const r = await fn();
    gestes.push(`${r === false ? 'ÉCHEC' : 'ok'} — ${nom}${typeof r === 'string' ? ` : ${r}` : ''}`);
  } catch (e) {
    gestes.push(`ÉCHEC — ${nom} : ${e.message.split('\n')[0]}`);
    // Une capture manquée ne change rien au verdict, déjà noté.
    await p.screenshot({ path: `${sortie}/echec-${gestes.length}.png` }).catch(() => {});
  }
}

// Le renfort vaut cinq minutes : on l'efface pour que la fenêtre du socle
// s'ouvre à coup sûr, puis la clé virtuelle confirme, et la requête refusée
// doit repartir d'elle-même et aboutir.
async function sousRenfort(page, declencher, requete) {
  o.db.prepare('UPDATE socle_sessions SET renfort = 0').run();
  const rejouee = page.waitForResponse(r => requete(r) && r.status() !== 403, { timeout: 15000 });
  // Si la fenêtre n'apparaît pas, c'est cette erreur-là qui compte, pas l'attente abandonnée.
  rejouee.catch(() => {});
  await declencher();
  const fenetre = page.getByRole('dialog', { name: 'Confirme ton identité' });
  await fenetre.waitFor({ timeout: 8000 }).catch(async e => { await page.screenshot({ path: `${sortie}/echec-renfort.png` }); throw e; });
  await fenetre.getByRole('button', { name: 'Utiliser ma clé' }).click();
  const r = await rejouee;
  if (!r.ok()) throw new Error(`${r.request().method()} ${new URL(r.url()).pathname} rejouée : ${r.status()}`);
  return r;
}
const vers = (methode, chemin) => r => r.request().method() === methode && new URL(r.url()).pathname === chemin;
// L'attente et le geste partent ensemble : si le geste échoue, l'attente
// abandonnée ne doit pas faire tomber tout le parcours.
const apres = async (page, requete, faire) => (await Promise.all([page.waitForResponse(requete, { timeout: 15000 }), faire()]))[0];

const aller = async (page, id) => { await page.evaluate(x => { location.hash = x; }, id); await page.waitForTimeout(800); };
const fermerTout = page => page.evaluate(() => {
  for (const el of document.querySelectorAll('.feuille,.gf-voile,.modale-voile,.voile,.pal-voile')) el.remove();
  document.getElementById('aiaClose')?.click();
  document.querySelector('.app')?.classList.remove('menu-ouvert');
});

const { page } = await ouvrir('admin');
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

await page.goto(base);
await page.getByLabel('Jeton d’installation').waitFor();
await controle(page, 'installation');
await page.getByLabel('Jeton d’installation').fill(JETON_INSTALLATION);
await page.getByLabel('Identifiant').fill('veilleur');
await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
await page.getByRole('button', { name: 'Créer le compte' }).click();
await page.getByRole('button', { name: /Créer la clé maintenant/ }).click();
await page.getByText('J’ai rangé ces codes en lieu sûr.').click();
await page.getByRole('button', { name: 'Terminer' }).click();

// Mise en route : l'équipement est obligatoire et n'est enregistré qu'après
// une connexion vérifiée, empreinte montrée.
await page.locator('.ob-wiz').waitFor();
await controle(page, 'mise-en-route-accueil');
await page.getByRole('button', { name: 'Commencer' }).click();
await page.getByRole('button', { name: 'Constructeur' }).click();
await page.getByRole('option', { name: /Autre \(SSH générique\)/ }).click();
await page.getByRole('button', { name: 'Constructeur' }).filter({ hasText: 'Autre (SSH générique)' }).waitFor({ timeout: 3000 });
await page.getByLabel('Adresse', { exact: true }).fill('192.0.2.1');
await page.getByLabel('Identifiant', { exact: true }).fill('exploitant');
await page.getByLabel('Mot de passe', { exact: true }).fill(reseau.motDePasse);
await controle(page, 'mise-en-route-equipement');
await geste('mise en route : connexion vérifiée, empreinte présentée', async () => {
  await page.getByRole('button', { name: 'Vérifier la connexion' }).click();
  await page.locator('.ob-empreinte').waitFor({ timeout: 10000 });
  return (await page.locator('.ob-empreinte').textContent()).match(/SHA256:\S{10}/)?.[0] || false;
});
await controle(page, 'mise-en-route-verification');
await geste('mise en route : équipement enregistré sous renfort, requête rejouée', async () => {
  await sousRenfort(page, () => page.getByRole('button', { name: 'Enregistrer et continuer' }).click(), vers('PUT', '/api/router'));
  await page.locator('[data-etape="telegram"]').waitFor();
  return o.db.prepare('SELECT count(*) AS n FROM equipements').get().n === 1 ? 'un équipement en base' : false;
});
await controle(page, 'mise-en-route-messagerie');
await page.getByRole('button', { name: 'Passer cette étape' }).click();
await page.getByRole('button', { name: 'Passer cette étape' }).click();
await controle(page, 'mise-en-route-carte');
await page.getByRole('button', { name: 'Continuer' }).click();
await controle(page, 'mise-en-route-fin');

await geste('mise en route terminée, premier balayage par le flux', async () => {
  await page.getByRole('button', { name: 'Ouvrir MapMyLAN' }).click();
  await page.locator('.app').waitFor();
  const compter = () => o.db.prepare('SELECT count(*) AS n FROM appareils').get().n;
  for (let i = 0; i < 60 && compter() < PARC.length; i++) await page.waitForTimeout(500);
  await aller(page, 'devices');
  await page.locator('tbody tr', { hasText: 'serveur-a' }).first().waitFor({ timeout: 10000 });
  // La mise en route demande la construction de la carte cinq secondes après
  // le balayage : les captures de la carte l'attendent.
  const liens = () => o.db.prepare('SELECT count(*) AS n FROM liens').get().n;
  for (let i = 0; i < 30 && !liens(); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(500);
  return `${compter()} appareils, liste à jour, ${liens()} liaisons`;
});

// Ce qu'une collecte continue aurait accumulé (tâches de fond coupées dans
// l'instance d'essai) : une heure de mesures de la machine hôte, et des
// connexions sortantes vers des adresses et des noms de documentation.
{
  const t = Date.now();
  const mesure = o.db.prepare('INSERT INTO mesures_hote(id, cpuPct, memPct, memUsedMB, memTotalMB, diskPct, tempC, loadAvg, netRxKBs, netTxKBs, uptimeSec, createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 60; i++) mesure.run(crypto.randomUUID(), 18 + 10 * Math.sin(i / 6) + (i % 7), 38 + 4 * Math.sin(i / 11), 3100 + i * 3, 8000, 57, 47, 0.6, 100 + (i % 9) * 12, 30 + (i % 5) * 6, 864000 + i * 60, t - (60 - i) * 60e3);
  const flux = o.db.prepare(`INSERT INTO flux_trafic(id, srcIp, dstIp, port, proto, firstSeen, lastSeen, bytes, packets, hits, host, domain, operator, logo, country, direction, suspect, raison)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const destinations = [
    ['203.0.113.10', 'cdg-edge-3.exemple.org', 'FR'], ['203.0.113.20', 'fra-cache-1.exemple.org', 'DE'], ['203.0.113.30', 'nrt-a.exemple.org', 'JP'],
    ['203.0.113.40', 'iad-web-2.exemple.org', 'US'], ['203.0.113.50', null, 'NL'], ['203.0.113.60', 'syd-b.exemple.org', 'AU'],
  ];
  destinations.forEach(([dst, hote, pays], i) => {
    for (const [j, src] of ['192.0.2.10', '192.0.2.60', '192.0.2.40'].entries()) {
      const suspect = src === '192.0.2.40' && i === 4;
      flux.run(crypto.randomUUID(), src, dst, [443, 443, 80, 443, 23, 443][i], 'tcp', t - (i + j + 1) * 7 * 60e3, t - (i + j) * 60e3, 40000 * (i + 1) * (j + 1), 60 * (i + 1), 3 + i,
        hote, hote ? 'exemple.org' : null, hote ? null : 'Réseau de documentation', null, pays, 'sortant', suspect ? 1 : 0, suspect ? 'Telnet vers l’extérieur' : null);
    }
  });
}

// Deux actions de défense avant le tour, pour qu'il voie des hôtes retenus
// et des alertes : chacune doit partir en SSH vers la passerelle.
const derniereCommande = () => reseau.appels.filter(a => a.programme === 'ssh').at(-1)?.args.at(-1) || '';
for (const [nom, bouton, chemin, statut] of [['camera-7', 'Isoler', 'quarantine', 'quarantined'], ['capteur-9', 'Bloquer', 'ban', 'banned']]) {
  await geste(`défense : ${nom} — ${bouton.toLowerCase()} par l’équipement`, async () => {
    await fermerTout(page);
    await aller(page, 'devices');
    await page.locator('tbody tr', { hasText: nom }).first().click();
    await page.locator('.feuille').waitFor();
    const r = await apres(page, x => x.request().method() === 'POST' && x.url().endsWith(`/${chemin}`), () => page.locator('.feuille').getByRole('button', { name: bouton, exact: true }).click());
    if (!r.ok()) return false;
    const commande = derniereCommande();
    const etat = o.db.prepare('SELECT status FROM appareils WHERE hostname = ?').get(nom)?.status;
    await page.keyboard.press('Escape');
    if (!/iptables/.test(commande) || etat !== statut) throw new Error(`commande « ${commande.slice(0, 60)} », état ${etat}`);
    return `iptables sur la passerelle, état ${etat}`;
  });
}

const PAGES = ['dashboard', 'map', 'world', 'devices', 'vlans', 'security', 'vulns', 'router', 'botcommands', 'ssh', 'host',
  'inventory', 'notifications', 'logs', 'reports', 'settings', 'users', 'compte'];

// États : ce qu'on ouvre une fois arrivé sur la page.
const cliquerTexte = (p, selecteur, texte) => p.evaluate(([s, t]) => {
  const el = [...document.querySelectorAll(s)].find(e => e.textContent.trim().startsWith(t) && e.getClientRects().length);
  el?.click();
  if (!el) throw new Error(`introuvable : ${s} « ${t} »`);
}, [selecteur, texte]);
const ETATS = [
  ['fiche', 'devices', async p => { await p.locator('tbody tr', { hasText: 'serveur-a' }).first().click(); await p.locator('.feuille').waitFor(); }],
  ['assistant', 'dashboard', async p => { await p.locator('.topright button[data-assistant]').click(); await p.locator('#aiaPanel').waitFor(); }],
  ['routeur-formulaire', 'router', async p => { await cliquerTexte(p, 'button', 'Modifier'); await p.locator('.gf-voile').waitFor(); }],
  ['mail-formulaire', 'settings', async p => { await p.locator('.set header .btn-ajout').first().click(); await p.waitForTimeout(500); }],
  ['zone', 'map', async p => { await cliquerTexte(p, '.planoutils .po', '+ Zone'); await p.locator('.modale-voile').waitFor(); }],
  ['appareil-manuel', 'map', async p => { await cliquerTexte(p, '.planoutils .po', '+ Appareil'); await p.locator('.modale-voile').waitFor(); }],
  ['ssh-formulaire', 'ssh', async p => { await cliquerTexte(p, '.actions button', 'Ajouter un appareil'); await p.waitForTimeout(400); }],
  ['bot-editeur', 'botcommands', async p => { await cliquerTexte(p, '.actions button', 'Nouvelle commande'); await p.waitForTimeout(500); }],
  ['commande-editeur', 'notifications', async p => { await cliquerTexte(p, '.actions button', 'Nouvelle commande'); await p.waitForTimeout(500); }],
  ['graphe-7j', 'dashboard', async p => { await p.locator('.vus .view', { hasText: '7j' }).click(); await p.locator('.vus .vus-b').nth(27).waitFor(); }],
  ['graphe-bulle', 'dashboard', async p => { await p.locator('.vus .vus-b:not(.sans)').last().hover(); await p.locator('.vus-bulle.on').waitFor(); }],
  ['carte-arbre', 'map', async p => { await cliquerTexte(p, '.actions .view', 'Arborescence'); await p.locator('.noeud-arbre').first().waitFor(); }],
  ...(GAMME === 'console' ? [['palette', 'dashboard', async p => { await p.keyboard.press('Control+k'); await p.locator('.pal').waitFor(); await p.keyboard.type('serveur'); await p.waitForTimeout(200); }]] : []),
];

async function tour(p, prefixe, { pages = PAGES, etats = ETATS, largeurs, captures } = {}) {
  for (const id of pages) {
    await fermerTout(p);
    await aller(p, id);
    await controle(p, `${prefixe}${id}`, { largeurs, captures });
  }
  for (const [nom, id, faire] of etats) {
    await fermerTout(p);
    await aller(p, id);
    try { await faire(p); } catch (e) {
      gestes.push(`ÉCHEC — ouvrir ${nom} : ${e.message.split('\n')[0]}`);
      await p.screenshot({ path: `${sortie}/echec-${prefixe}${nom}.png` });
      continue;
    }
    await controle(p, `${prefixe}${nom}`, { largeurs, captures });
  }
  await fermerTout(p);
}

await tour(page, '');

// Disposition atelier : elle ne vaut qu'au-delà de 1100 px ; en deçà, la
// lecture reprend et le contrôle doit rester propre.
await geste('disposition atelier : bascule, aperçu et carte, retour', async () => {
  await aller(page, 'dashboard');
  await page.locator('.swap-haut:visible').click();
  await page.locator('.wtop').waitFor();
  await controle(page, 'atelier');
  await aller(page, 'map');
  await controle(page, 'atelier-carte');
  await page.locator('.swap-haut:visible').click();
  await page.locator('.wtop').waitFor({ state: 'hidden' });
  return 'aller et retour';
});

// Thème sombre : même contrôle aux largeurs extrêmes, captures pour la comparaison.
await page.evaluate(() => { localStorage.setItem('theme', 'dark'); document.documentElement.dataset.theme = 'dark'; });
await tour(page, 'sombre-', { largeurs: [390, 1440], captures: [390, 1440] });
await page.evaluate(() => { localStorage.setItem('theme', 'light'); document.documentElement.dataset.theme = 'light'; });

await geste('fiche : nom donné modifié', async () => {
  await aller(page, 'devices');
  await page.locator('tbody tr', { hasText: 'camera-8' }).first().click();
  await page.getByRole('button', { name: 'modifier' }).click();
  await page.getByLabel('Nom donné').fill('Caméra du couloir');
  const r = await apres(page, x => x.request().method() === 'PATCH' && /\/api\/devices\//.test(x.url()), () => page.locator('.fedition-boutons .btn.solid').click());
  if (!r.ok()) return false;
  await page.locator('.fl b', { hasText: 'Caméra du couloir' }).waitFor();
  await page.keyboard.press('Escape');
  return 'PATCH 200, fiche relue';
});

await geste('console SSH : empreinte présentée, acceptée, enregistrée sous renfort', async () => {
  await fermerTout(page);
  await aller(page, 'ssh');
  await cliquerTexte(page, '.actions button', 'Ajouter un appareil');
  await page.getByLabel('Nom', { exact: true }).fill('serveur-a');
  await page.getByLabel('Hôte').fill('192.0.2.10');
  await page.getByLabel('Compte').fill('exploitant');
  await page.getByLabel('Mot de passe').fill(reseau.motDePasse);
  await page.getByRole('button', { name: 'Tester' }).click();
  await page.locator('.ssh-empreinte .empreinte').waitFor();
  await page.getByRole('button', { name: 'Accepter cette empreinte' }).click();
  await page.waitForTimeout(400);
  await sousRenfort(page, () => page.locator('.boutons-fin .btn.solid').click(), vers('POST', '/api/ssh'));
  await page.locator('.zrow', { hasText: 'serveur-a' }).waitFor();
  return 'ajoutée à la liste';
});

await geste('console SSH : commande exécutée sous renfort', async () => {
  await page.locator('.zrow', { hasText: 'serveur-a' }).first().click();
  await page.getByLabel('Commande').fill('uname -a');
  await sousRenfort(page, () => page.keyboard.press('Enter'), r => r.request().method() === 'POST' && /\/api\/ssh\/[^/]+\/exec$/.test(r.url()));
  await page.locator('.termbody .out', { hasText: 'Linux' }).first().waitFor();
  return 'sortie affichée';
});

await geste('réglages : jeton d’intégration créé sous renfort, montré une fois', async () => {
  await aller(page, 'settings');
  await page.getByPlaceholder('À quoi il sert').fill('Script de sauvegarde');
  await sousRenfort(page, () => page.locator('.jeton-creer').click(), vers('POST', '/api/integrations'));
  await page.locator('.jeton-clair code').waitFor();
  return (await page.locator('.jeton-clair code').textContent()).startsWith('mml_') ? 'clair commençant par mml_' : false;
});

await geste('notifications : messagerie enregistrée sous renfort, secret jamais relu', async () => {
  await aller(page, 'notifications');
  await page.locator('.canal', { hasText: 'telegram' }).click();
  await page.getByLabel('Jeton du bot').fill(`123456789:${'A'.repeat(35)}`);
  await page.getByLabel('Identifiant de discussion').fill('-1001234567890');
  await sousRenfort(page, () => page.locator('.editeur-canal .btn.solid').click(), vers('PUT', '/api/notifications/telegram'));
  await page.waitForTimeout(500);
  await apres(page, vers('GET', '/api/notifications/telegram'), () => page.locator('.canal', { hasText: 'telegram' }).click());
  await page.waitForTimeout(200);
  const jeton = await page.getByLabel('Jeton du bot').inputValue();
  const discussion = await page.getByLabel('Identifiant de discussion').inputValue();
  await page.keyboard.press('Escape');
  if (jeton !== '' || discussion !== '-1001234567890') throw new Error(`relu : jeton « ${jeton.slice(0, 4)}… », discussion « ${discussion} »`);
  return 'identifiant relu, jeton vide';
});

await geste('notifications : commande « quand → alors » créée sous renfort', async () => {
  await fermerTout(page);
  await aller(page, 'notifications');
  await cliquerTexte(page, '.actions button', 'Nouvelle commande');
  const panneau = page.getByRole('dialog', { name: 'Nouvelle commande' });
  await panneau.getByLabel('Nom', { exact: true }).fill('Prévenir sur un nouvel appareil');
  await sousRenfort(page, () => panneau.locator('.fboutons .btn.solid').click(), vers('POST', '/api/commands'));
  const c = o.db.prepare('SELECT trigger, actions FROM commandes').get();
  return c ? `${c.trigger} → ${JSON.parse(c.actions).map(a => a.kind).join(', ')}` : false;
});

await geste('commandes bot : commande créée sous renfort', async () => {
  await fermerTout(page);
  await aller(page, 'botcommands');
  await cliquerTexte(page, '.actions button', 'Nouvelle commande');
  const panneau = page.getByRole('dialog', { name: 'Nouvelle commande' });
  await panneau.getByLabel('Appel').fill('/etat');
  await panneau.getByLabel('Description').fill('État du réseau');
  await sousRenfort(page, () => panneau.locator('.fboutons .btn.solid').click(), vers('POST', '/api/bot-commands'));
  await page.getByText('/etat').first().waitFor();
  return 'listée';
});

await geste('VLAN : segment déclaré', async () => {
  await fermerTout(page);
  await aller(page, 'vlans');
  await page.getByRole('button', { name: 'Déclarer un VLAN' }).first().click();
  await page.getByLabel('Segment', { exact: true }).fill('20');
  await page.getByLabel('Nom', { exact: true }).fill('Objets connectés');
  await page.getByLabel('Sous-réseau', { exact: true }).fill('198.51.100.0/26');
  const r = await apres(page, vers('POST', '/api/vlans'), () => page.getByRole('button', { name: 'Enregistrer' }).click());
  if (!r.ok()) return false;
  await page.locator('td', { hasText: 'Objets connectés' }).first().waitFor();
  return 'listé';
});

await geste('carte : machine virtuelle ajoutée à la main', async () => {
  await fermerTout(page);
  await aller(page, 'map');
  await cliquerTexte(page, '.planoutils .po', '+ Appareil');
  await page.locator('.modale-types .type', { hasText: 'VM' }).click();
  await page.getByLabel('Name', { exact: true }).fill('vm-a');
  await page.getByLabel('IP address').fill('192.0.2.120');
  const r = await apres(page, vers('POST', '/api/devices/manual'), () => page.locator('.modale-ok').click());
  const d = o.db.prepare("SELECT type, customType FROM appareils WHERE customName = 'vm-a'").get();
  return r.ok() && d ? `type ${d.type}` : false;
});

await geste('sécurité : seuil d’une règle modifié sous renfort', async () => {
  await fermerTout(page);
  await aller(page, 'security');
  const champ = page.getByLabel(/^Seuil de Isolement/);
  await champ.fill('70');
  await sousRenfort(page, () => champ.press('Tab'), r => r.request().method() === 'PATCH' && /\/api\/rules\//.test(r.url()));
  const seuil = o.db.prepare("SELECT threshold FROM regles WHERE action = 'quarantine'").get()?.threshold;
  return seuil === 70 ? 'seuil 70 en base' : false;
});

await geste('sécurité : accès rendu à capteur-9', async () => {
  await page.locator('tr', { hasText: 'capteur-9' }).getByRole('button', { name: "rendre l'accès" }).click();
  const r = await apres(page, x => x.request().method() === 'POST' && x.url().endsWith('/unban'), () => page.getByRole('dialog').getByRole('button', { name: "Rendre l'accès" }).click());
  return r.ok() && /iptables -D/.test(derniereCommande()) ? 'règles retirées sur la passerelle' : false;
});

await geste('réglages : plage de balayage ajoutée', async () => {
  await fermerTout(page);
  await aller(page, 'settings');
  await page.getByLabel('Plage', { exact: true }).fill('198.51.100.0/26');
  await page.getByLabel('Nom (optionnel)').fill('Objets');
  const r = await apres(page, vers('PUT', '/api/settings/scan.ranges'), () => page.getByRole('button', { name: 'Ajouter', exact: true }).click());
  return r.ok() ? 'PUT 200' : false;
});

await geste('réglages : destinations de sortie enregistrées sous renfort', async () => {
  await page.getByLabel('sortie.autorisees').fill('billetterie.exemple.org');
  const carte = page.locator('.set', { has: page.getByLabel('sortie.autorisees') });
  await sousRenfort(page, () => carte.getByRole('button', { name: 'Enregistrer' }).click(), vers('PUT', '/api/settings/sortie.autorisees'));
  return 'enregistrées';
});

await geste('réglages : historique du trafic purgé', async () => {
  const r = await apres(page, vers('POST', '/api/traffic/purge'), () => page.getByRole('button', { name: 'Purger maintenant' }).click());
  return r.ok() ? 'POST 200' : false;
});

await geste('réglages : jeton révoqué sous renfort', async () => {
  await page.locator('.jeton-revoquer').first().click();
  await sousRenfort(page, () => page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click(), r => r.request().method() === 'DELETE' && /\/api\/integrations\//.test(r.url()));
  const j = o.db.prepare('SELECT revokedAt FROM jetons_integration').get();
  return j?.revokedAt ? 'révoqué en base' : false;
});

await geste('équipement : test avec les identifiants enregistrés', async () => {
  await fermerTout(page);
  await aller(page, 'router');
  const r = await apres(page, vers('POST', '/api/router/test'), () => page.getByRole('button', { name: 'Tester' }).first().click());
  return r.ok() && (await r.json()).ok ? 'connexion vérifiée' : false;
});

await geste('fiche : balayage approfondi', async () => {
  await aller(page, 'devices');
  await page.locator('tbody tr', { hasText: 'serveur-a' }).first().click();
  const r = await apres(page, x => x.request().method() === 'POST' && x.url().endsWith('/deep-scan'), () => page.locator('.feuille').getByRole('button', { name: 'Balayage approfondi' }).click());
  await page.keyboard.press('Escape');
  return r.ok() ? `${(await r.json()).ports?.length} ports relevés` : false;
});

await geste('appareils : doublons fusionnés', async () => {
  const r = await apres(page, vers('POST', '/api/devices/dedupe'), () => page.getByRole('button', { name: 'Fusionner les doublons' }).first().click());
  return r.ok() ? `${(await r.json()).removed} fusionné(s)` : false;
});

await geste('notifications : alerte marquée comme lue', async () => {
  await aller(page, 'notifications');
  const r = await apres(page, x => x.request().method() === 'POST' && x.url().endsWith('/ack'), () => page.getByRole('button', { name: 'marquer comme lu' }).first().click());
  return r.ok() ? 'POST 200' : false;
});

await geste('carte : zone créée', async () => {
  await fermerTout(page);
  await aller(page, 'map');
  await cliquerTexte(page, '.planoutils .po', '+ Zone');
  const r = await apres(page, vers('POST', '/api/topology/zones'), () => page.locator('.modale-ok').click());
  return r.ok() ? 'POST 200' : false;
});

await geste('carte : plaque déplacée, position gardée', async () => {
  await fermerTout(page);
  await aller(page, 'map');
  // L'arborescence a été ouverte pendant le tour : on revient au libre, le
  // seul agencement où une plaque se déplace.
  await cliquerTexte(page, '.actions .view', 'Libre');
  await page.locator('rect.plate').first().waitFor();
  // Le dernier groupe qui contient le nom est la plaque elle-même, pas un calque.
  const plaque = page.locator('g', { has: page.locator('text.nm', { hasText: 'nas-b' }) }).last().locator('rect.plate');
  const b = await plaque.boundingBox();
  const r = await apres(page, vers('POST', '/api/topology/positions'), async () => {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - 60, b.y + b.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
  });
  const d = o.db.prepare("SELECT posX, posY FROM appareils WHERE hostname = 'nas-b'").get();
  return r.ok() && d?.posX != null ? `posée en ${Math.round(d.posX)}, ${Math.round(d.posY)}` : false;
});

await geste('balayage relancé depuis l’en-tête, terminé par le flux', async () => {
  await aller(page, 'dashboard');
  const r = await apres(page, vers('POST', '/api/devices/scan'), () => page.getByRole('button', { name: 'Lancer un balayage' }).first().click());
  if (!r.ok()) return false;
  await page.getByRole('button', { name: 'Lancer un balayage' }).first().waitFor({ timeout: 20000 }).catch(e => {
    const b = o.db.prepare('SELECT status, hostsFound, startedAt, endedAt, error FROM balayages ORDER BY startedAt').all();
    throw new Error(`${e.message.split('\n')[0]} ; balayages : ${JSON.stringify(b.map(x => [x.status, x.hostsFound, x.endedAt ? x.endedAt - x.startedAt : null, x.error]))}`);
  });
  return 'bouton rendu';
});

await geste('assistant : question posée, réponse affichée', async () => {
  await page.locator('.topright button[data-assistant]').click();
  await page.locator('#aiaIn').fill('Combien d’appareils sont en ligne ?');
  const reponse = await apres(page, vers('POST', '/api/assistant/ask'), () => page.locator('#aiaForm button[type=submit]').click());
  await page.locator('#aiaClose').click();
  return reponse.ok() ? `POST ${reponse.status()}` : false;
});

await geste('langue : anglais puis français', async () => {
  await page.locator('.top .langue').first().click();
  await page.waitForTimeout(400);
  const en = await page.locator('.title').first().textContent();
  await page.locator('.top .langue').first().click();
  await page.waitForTimeout(400);
  const fr = await page.locator('.title').first().textContent();
  return en !== fr ? `${en} / ${fr}` : false;
});

await geste('petit écran : tiroir du rail et feuille d’actions', async () => {
  await page.setViewportSize({ width: 390, height: 780 });
  await aller(page, 'devices');
  await page.locator('.top .menu').click();
  const ouvert = await page.evaluate(() => document.querySelector('.app').classList.contains('menu-ouvert'));
  await page.locator('.voile-rail').click({ position: { x: 350, y: 400 } });
  await page.locator('.actions .seul-s').first().click();
  await page.getByRole('dialog').waitFor();
  rapport.push({ ecran: 'feuille-actions', largeur: 390, defauts: await page.evaluate(chevauchements) });
  await page.screenshot({ path: `${sortie}/feuille-actions-390.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 860 });
  return ouvert ? 'tiroir et feuille' : false;
});

// Un compte en lecture seule, invité par l'administrateur : le lien vient de
// la page Utilisateurs, l'inscription se fait comme la personne la ferait
// (mot de passe, application TOTP, codes de secours), puis sa session passe
// au navigateur.
let lecteur = null;
await geste('utilisateurs : invitation en lecture seule sous renfort', async () => {
  await aller(page, 'users');
  await page.getByRole('button', { name: 'Inviter' }).click();
  const fenetre = page.getByRole('dialog', { name: 'Inviter' });
  await fenetre.getByLabel('Identifiant').fill('lecteur-a');
  await fenetre.locator('select').selectOption('lecture');
  const r = await sousRenfort(page, () => fenetre.getByRole('button', { name: 'Créer le lien' }).click(), vers('POST', '/api/compte/admin/comptes'));
  const jeton = (await r.json()).lien.split('#invitation=')[1];
  await page.keyboard.press('Escape');
  const c = new Client(o.port);
  const etapes = [
    () => c.post('/api/compte/jeton', { usage: 'invitation', jeton, motDePasse: `${MOT_DE_PASSE} lecteur` }),
    async () => { const t = await c.post('/api/compte/totp'); c.secret = t.json?.secret; return t; },
    () => c.post('/api/compte/totp/confirmer', { code: codeTotp(c.secret, Date.now()) }),
    () => c.post('/api/compte/secours'),
  ];
  for (const e of etapes) { const x = await e(); if (x.status !== 200) throw new Error(`inscription : ${x.status} ${JSON.stringify(x.json)}`); }
  lecteur = [...c.cookies].map(([name, value]) => ({ name, value, url: base }));
  return 'compte inscrit';
});

await geste('déconnexion : retour à la porte', async () => {
  await page.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await page.getByLabel('Identifiant').waitFor({ timeout: 8000 });
  return 'porte affichée';
});

if (lecteur) {
  const l = await ouvrir('lecture', { cookies: lecteur });
  await l.page.goto(`${base}/#dashboard`);
  await l.page.locator('.app').waitFor();
  await l.page.waitForTimeout(800);
  await geste('lecture seule : page Utilisateurs absente du menu', async () =>
    (await l.page.locator('.rail .nav', { hasText: 'Utilisateurs' }).count()) === 0 ? 'absente' : false, l.page);
  await geste('lecture seule : réglages des canaux fermés', async () => {
    await aller(l.page, 'notifications');
    return (await l.page.locator('.canal:disabled').count()) === 3 ? 'trois canaux, aucun éditable' : false;
  }, l.page);
  await tour(l.page, 'lecture-', { pages: PAGES.filter(p => p !== 'users'), etats: ETATS.filter(([nom]) => ['fiche', 'assistant'].includes(nom)), largeurs: [390, 1280], captures: [390] });
  await l.contexte.close();
}

erreurs.push(...consoles403.slice(renforts403));
const defauts = rapport.filter(r => r.defauts.length);
fs.writeFileSync(`${sortie}/rapport.json`, JSON.stringify({ rapport, gestes, erreurs, refus }, null, 2));
console.log(gestes.join('\n'));
console.log(`écrans×largeurs contrôlés : ${rapport.length}, avec défauts : ${defauts.length}, erreurs console : ${erreurs.length}, requêtes refusées : ${refus.length}`);
for (const r of defauts) for (const d of r.defauts.slice(0, 5)) console.log(`  ${r.ecran} @${r.largeur} — ${d.type} : ${d.detail}`);
for (const e of erreurs) console.log('  console :', e);
for (const e of refus) console.log('  refus :', e);
await navigateur.close();
await o.arreter();
await telegram.fermer();
const echecs = gestes.filter(g => g.startsWith('ÉCHEC')).length;
process.exit(defauts.length || erreurs.length || refus.length || echecs ? 1 : 0);

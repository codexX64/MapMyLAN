// Relais pour le Hub. L'API de MapMyLAN tourne dans le réseau de la machine
// (le balayage ARP ne traverse pas un pont Docker) et n'écoute que sur
// l'adresse du pont : les conteneurs du Hub ne la joignent pas par un nom.
// Ce relais, lancé depuis la même image sur le réseau du Hub, lui transmet
// chaque requête telle quelle, flux temps réel compris. Il ne décide rien :
// sessions, jetons, droits et quotas restent ceux de l'API.
//
//   RELAIS_CIBLE=http://<adresse du pont>:8090  RELAIS_PORT=8090  node src/relais.js
import http from 'node:http';
import { entetesSecurite, lireConfig, repondreJson } from '../socle/src/index.js';

// En-têtes propres à une connexion : ils ne se transmettent pas (RFC 9110 § 7.6.1).
const SAUT = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);

function entetesTransmis(brut, ajout = {}) {
  const out = {};
  for (const [k, v] of Object.entries(brut)) if (!SAUT.has(k.toLowerCase())) out[k] = v;
  return { ...out, ...ajout };
}

export function creerRelais({ cible, log = console }) {
  const amont = new URL(cible);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  return http.createServer((req, res) => {
    // L'adresse du client, pour que l'API compte ses débits par client et non
    // par relais (l'API doit lister ce relais dans SOCLE_PROXYS).
    const xff = [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
    const sortante = http.request({
      agent, protocol: amont.protocol, hostname: amont.hostname, port: amont.port, method: req.method, path: req.url,
      headers: entetesTransmis(req.headers, { 'x-forwarded-for': xff }),
    }, reponse => {
      res.writeHead(reponse.statusCode, entetesTransmis(reponse.headers));
      reponse.pipe(res);
    });
    sortante.on('error', e => {
      log.warn?.(`[relais] ${e.code || e.message}`);
      if (res.headersSent) return res.destroy();
      // La seule réponse que le relais écrit lui-même : mêmes en-têtes que l'API.
      entetesSecurite(res, { csp: "default-src 'none'; frame-ancestors 'none'" });
      repondreJson(res, 502, { error: 'MapMyLAN injoignable.' });
    });
    // Le client parti, la requête vers l'API n'a plus de raison d'être (un flux SSE fermé).
    res.on('close', () => sortante.destroy());
    req.pipe(sortante);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const cfg = lireConfig({
      cible: { env: 'RELAIS_CIBLE', type: 'url', requis: true },
      port: { env: 'RELAIS_PORT', type: 'entier', min: 1, max: 65535, defaut: 8090 },
    });
    const serveur = creerRelais({ cible: cfg.cible });
    serveur.headersTimeout = 20_000;
    serveur.requestTimeout = 120_000;
    serveur.listen(cfg.port, '0.0.0.0', () => console.log(`Relais MapMyLAN : :${cfg.port} → ${cfg.cible}`));
    for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => serveur.close(() => process.exit(0)));
  } catch (e) { console.error(e.message); process.exit(1); }
}

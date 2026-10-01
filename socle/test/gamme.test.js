// Gammes de SOMA : la valeur de SOCLE_THEME, la page rendue avec sa gamme, et
// une gamme Console qui redéfinit chaque jeton de couleur et de police.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lireConfig } from '../src/config.js';
import { SPEC_SOCLE, GAMMES, servirFichier } from '../src/index.js';

const WEB = path.resolve(import.meta.dirname, '..', 'web');

function rendre(gamme) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'gamme-'));
  fs.writeFileSync(path.join(dossier, 'index.html'), '<html data-gamme="__GAMME__"><script nonce="__NONCE__"></script></html>');
  let corps = '';
  const res = { writeHead() {}, end(b) { corps = String(b ?? ''); } };
  assert.equal(servirFichier({ method: 'GET', headers: {} }, res, dossier, '/index.html', { nonce: 'n0', ...(gamme === undefined ? {} : { gamme }) }), true);
  return corps;
}

test('SOCLE_THEME : soma par défaut, console admise, toute autre valeur arrête le démarrage', () => {
  assert.deepEqual(GAMMES, ['soma', 'console']);
  assert.equal(lireConfig(SPEC_SOCLE, {}).gamme, 'soma');
  assert.equal(lireConfig(SPEC_SOCLE, { SOCLE_THEME: 'console' }).gamme, 'console');
  assert.throws(() => lireConfig(SPEC_SOCLE, { SOCLE_THEME: 'clair' }), /SOCLE_THEME/);
});

test('la page est rendue avec sa gamme ; une gamme inconnue retombe sur SOMA', () => {
  assert.equal(rendre('console'), '<html data-gamme="console"><script nonce="n0"></script></html>');
  assert.match(rendre(undefined), /data-gamme="soma"/);
  assert.match(rendre('"><script>'), /data-gamme="soma"/);
});

test('gamme Console : chaque jeton de SOMA redéfini, polices servies par le socle', () => {
  const css = fs.readFileSync(path.join(WEB, 'soma.css'), 'utf8');
  const bloc = re => (re.exec(css) || [])[1] || '';
  const jetons = b => new Set([...b.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
  const soma = jetons(bloc(/\n:root\{([^}]*)\}/));
  const consoleJ = jetons(bloc(/html:root\[data-gamme="console"\]\{([^}]*)\}/));
  const aRedefinir = [...soma].filter(j => !['rail', 'gouttiere', 'courbe'].includes(j));
  assert.ok(aRedefinir.length > 20);
  assert.deepEqual(aRedefinir.filter(j => !consoleJ.has(j)), [], 'jeton de SOMA laissé à sa valeur claire');
  for (const [, f] of css.matchAll(/url\((polices\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(WEB, f)), f);
  for (const f of ['OFL-geist-sans.txt', 'OFL-geist-mono.txt']) assert.match(fs.readFileSync(path.join(WEB, 'polices', f), 'utf8'), /SIL Open Font License/);
  // Console claire : la bascule clair ou sombre reste offerte, chaque jeton
  // de couleur est redéfini, accent bleu.
  assert.doesNotMatch(css, /\.bascule-theme\{display:none/);
  const clair = jetons(bloc(/html:root\[data-gamme="console"\]\[data-theme="light"\]\{([^}]*)\}/));
  const couleurs = [...consoleJ].filter(j => !['sans', 'mono', 'r-ctl', 'r-carte', 'grain'].includes(j));
  assert.deepEqual(couleurs.filter(j => !clair.has(j)), [], 'jeton de la Console sombre sans valeur claire');
  assert.match(bloc(/html:root\[data-gamme="console"\]\[data-theme="light"\]\{([^}]*)\}/), /--accent:#2563EB/);
  // Les composants de la Console ne portent plus de couleur en dur : les deux
  // variantes passent par les jetons.
  const composants = css.slice(css.indexOf('/* Composants de la gamme Console')).split('\n').filter(l => l.startsWith('html[data-gamme="console"]'));
  assert.deepEqual(composants.filter(l => /#[0-9A-Fa-f]{3,6}\b|rgba\(/.test(l)), []);
});

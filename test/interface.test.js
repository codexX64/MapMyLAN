// Calculs de l'interface qui se vérifient sans navigateur : les créneaux du
// graphe « Appareils vus ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creneaux, plafond } from '../web/lib/creneaux.js';

const H = 3_600_000;
const iso = ms => new Date(ms).toISOString();

test('créneaux : vus par plage puis additionnés, nouveaux à leur première apparition, créneau sans balayage vide', () => {
  const maintenant = Date.UTC(2026, 0, 2, 12);
  const balayages = [
    { subnet: '198.51.100.0/24', hostsFound: 6, startedAt: iso(maintenant - 2.5 * H) },
    { subnet: '198.51.100.0/24', hostsFound: 8, startedAt: iso(maintenant - 2.2 * H) },
    { subnet: '203.0.113.0/24', hostsFound: 3, startedAt: iso(maintenant - 2.1 * H) },
    { subnet: '198.51.100.0/24', hostsFound: 9, startedAt: iso(maintenant - 30 * H) },
  ];
  const appareils = [{ firstSeen: iso(maintenant - 2.4 * H) }, { firstSeen: iso(maintenant - 2.3 * H) }, { firstSeen: iso(maintenant - 50 * H) }];
  const c = creneaux(balayages, appareils, '24h', maintenant);
  assert.equal(c.length, 24);
  const plein = c[21];
  assert.equal(plein.vus, 11, '8 sur la première plage, 3 sur la seconde');
  assert.equal(plein.nouveaux, 2);
  assert.equal(plein.connus, 9);
  assert.equal(c.filter(x => x.vus !== null).length, 1, 'le balayage d’il y a 30 h est hors période');
  assert.equal(c[22].vus, null);
  assert.equal(c[22].connus, 0);
  assert.equal(creneaux([], [], '7d', maintenant).length, 28);
  assert.equal(creneaux([], [], '30d', maintenant).length, 30);
});

test('plafond : rond, divisible en quatre, jamais sous 4', () => {
  assert.equal(plafond(0), 4);
  assert.equal(plafond(4), 4);
  assert.equal(plafond(11), 12);
  assert.equal(plafond(13), 16);
});

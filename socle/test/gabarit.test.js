// Gabarits sûrs : où tombe chaque valeur, et ce qui est refusé. Le rendu dans
// le DOM est vérifié par outils/gabarit-navigateur.mjs, sous la politique de
// contenu du socle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyser, adresseSure } from '../web/gabarit.js';

const contextes = (chaines, ...v) => analyser(chaines).contextes;
const balisage = (chaines, ...v) => analyser(chaines).balisage;

test('une valeur tombe en texte, en attribut ou dans un élément brut', () => {
  assert.deepEqual(contextes`<p>${1}</p>`, ['texte']);
  assert.deepEqual(contextes`<p class="a ${1} b" title='${2}'>x</p>`, ['attribut', 'attribut']);
  assert.deepEqual(contextes`<input value=${1} checked=${2}>`, ['attribut', 'attribut']);
  assert.deepEqual(contextes`<textarea>${1}</textarea><b>${2}</b>`, ['brut', 'texte']);
  assert.deepEqual(contextes`<p data-x="a>b" title=${1}>${2}</p>`, ['attribut', 'texte']);
  assert.deepEqual(contextes`${1}<ul>${2}</ul>`, ['texte', 'texte']);
  assert.deepEqual(contextes`a < b ${1}`, ['texte']);
  assert.deepEqual(contextes`<svg viewBox="0 0 ${1} ${2}"><path d=${3}/></svg>`, ['attribut', 'attribut', 'attribut']);
});

test('les valeurs ne sont jamais dans le balisage : seulement des marques', () => {
  const b = balisage`<p title="${'<x>'}">${'<img src=x onerror=alert(1)>'}</p>`;
  assert.doesNotMatch(b, /img|alert|<x>/);
  assert.match(b, /^<p data-gbt-0="gbt\w+v0v"><!--gbt\w+v1v--><\/p>$/);
  assert.deepEqual(analyser`<p title="${1}">x</p>`.noms, ['title']);
});

test('attributs variables et styles renommés ; valeur entière sans guillemets entourée', () => {
  const { balisage: b, noms } = analyser`<svg viewBox="0 0 ${1} 9" class="s"><path d=${2}/></svg><i style="color:red">x</i>`;
  assert.deepEqual(noms, ['viewBox', 'd', 'style']);
  assert.match(b, /^<svg data-gbt-0="0 0 gbt\w+v0v 9" class="s"><path data-gbt-1="gbt\w+v1v"\/><\/svg><i data-gbt-2="color:red">x<\/i>$/);
});

test('refusé : valeur en position de balise, en commentaire, dans script ou style', () => {
  assert.throws(() => analyser`<input ${'checked'}>`.contextes, /position de balise/);
  assert.throws(() => analyser`<${'div'}>`.contextes, /position de balise|valeur n° 1/);
  assert.throws(() => analyser`<!-- ${1} -->`.contextes, /commentaire/);
  assert.throws(() => analyser`<script>${1}</script>`.contextes, /script/);
  assert.throws(() => analyser`<style>${1}</style>`.contextes, /style/);
});

test('adresses : relatives, http(s), mailto, tel et blob ; data: pour les images seulement', () => {
  for (const ok of ['/api/x', '#a', '?q=1', 'page.html', 'https://exemple.org', 'http://192.0.2.1:8100/', 'mailto:a@b.c', 'tel:+33', 'blob:https://x/1']) assert.ok(adresseSure(ok), ok);
  for (const non of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>', 'vbscript:x', 'file:///etc/passwd']) assert.ok(!adresseSure(non), non);
  assert.ok(adresseSure('data:image/png;base64,AAAA', { image: true }));
  assert.ok(!adresseSure('data:image/png;base64,AAAA'));
  assert.ok(!adresseSure('data:image/svg+xml;base64,AAAA', { image: true }), 'un SVG peut porter du script');
});

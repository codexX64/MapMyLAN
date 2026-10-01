// Le texte que le bot envoie à la messagerie, rendu dans la page.
//
// La messagerie accepte un petit sous-ensemble de balises : gras, italique,
// souligné, barré, code. On le relit ici à la main, balise par balise : chaque
// morceau de texte devient un nœud texte, chaque balise reconnue un élément
// neuf. Rien d'autre ne passe — ni attribut, ni lien, ni balise inconnue, qui
// reste affichée telle quelle.
import { h } from '../dom.js';

const PERMISES = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's', del: 's', code: 'code', pre: 'pre' };
const ENTITES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };

const decoder = texte => String(texte).replace(/&(lt|gt|amp|quot|#39);/g, e => ENTITES[e]);

export function texteTelegram(source) {
  const racine = h('span', { class: 'texte-bot' });
  const pile = [racine];
  for (const morceau of String(source ?? '').split(/(<\/?[a-z]+>|<br\s*\/?>)/i)) {
    if (!morceau) continue;
    const m = /^<(\/?)([a-z]+)\s*\/?>$/i.exec(morceau);
    const nom = m ? m[2].toLowerCase() : null;
    if (nom === 'br') { pile[pile.length - 1].append(h('br')); continue; }
    if (m && PERMISES[nom]) {
      if (!m[1]) {
        const el = h(PERMISES[nom]);
        pile[pile.length - 1].append(el);
        pile.push(el);
      } else if (pile.length > 1 && pile[pile.length - 1].tagName.toLowerCase() === PERMISES[nom]) {
        pile.pop();
      }
      continue;
    }
    pile[pile.length - 1].append(decoder(morceau));
  }
  return racine;
}

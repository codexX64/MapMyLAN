// Géographie du globe.
//
// Deux jeux de données, repris de la maquette et encodés pour tenir dans le
// bundle sans fichier annexe :
//
//   GRILLE  — les terres émergées, une case par degré, comprimées en paires
//             [symbole, longueur]. C'est ce qui dessine les continents en
//             pointillé.
//   TRAITS  — les frontières et les littoraux, issus de Natural Earth,
//             quantifiés au dixième de degré, deux caractères par coordonnée.
//             La maquette embarquait ces données sans jamais les tracer ; ici
//             elles le sont, ce qui donne des côtes nettes plutôt qu'un
//             semis de points.
//
// Les deux alphabets sont strictement alphanumériques : un antislash dans un
// littéral casserait le module entier.

export interface Point3 { x: number; y: number; z: number; lat: number; lon: number }

/** Vecteur unitaire d'une position géographique. */
export function vec(lat: number, lon: number): Point3 {
  const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
  return { x: Math.cos(a) * Math.cos(b), y: Math.sin(a), z: Math.cos(a) * Math.sin(b), lat, lon };
}

const GRILLE_COMP =
  "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";

const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SYM: Record<string, string> = { T: "1", M: "0", S: "|" };

function decomprime(c: string): string {
  let out = "";
  for (let i = 0; i < c.length; i += 2) out += SYM[c[i]].repeat(ALPHA.indexOf(c[i + 1]) + 1);
  return out;
}

let cacheTerre: Point3[] | null = null;

/**
 * Les terres émergées, en semis de points.
 *
 * La version précédente parcourait la grille rangée par rangée et espaçait les
 * colonnes de l'inverse du cosinus de la latitude. L'intention était juste — un
 * degré de longitude se raccourcit vers les pôles — mais le résultat ne l'était
 * pas : le pas, arrondi à l'entier, se répète d'une rangée à l'autre, les
 * points s'alignent, et la calotte nord se couvrait d'arcs concentriques et de
 * rayons. Une toile d'araignée posée sur le globe, là où il fallait lire le
 * Groenland et la Sibérie.
 *
 * On sème donc à densité constante, par spirale d'or : la latitude est tirée
 * du **sinus** réparti uniformément, ce qui donne autant de points par unité de
 * surface au pôle qu'à l'équateur, et la longitude avance de l'angle d'or, qui
 * ne retombe jamais sur lui-même. Chaque point est ensuite déplacé d'un bruit
 * **déterministe** — même semis à chaque chargement, aucun hasard — d'un tiers
 * de l'écart moyen : sans lui, la spirale laisse ses propres stries.
 *
 * La grille reste la source : un point n'est gardé que si la case où il tombe
 * est de la terre. On change la façon d'échantillonner, pas la carte.
 */

/** Points semés sur la sphère entière. 41 253 donnerait un point par degré
 *  carré ; on monte un peu au-dessus pour compenser ceux que le bruit fait
 *  tomber à l'eau. */
const SEMIS = 46000;
const ANGLE_OR = Math.PI * (3 - Math.sqrt(5));

/** Bruit reproductible dans [-0,5 ; 0,5]. Pas de Math.random : le globe doit
 *  être le même à chaque ouverture. */
function bruit(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

export function terre(): Point3[] {
  if (cacheTerre) return cacheTerre;

  const lignes = decomprime(GRILLE_COMP).split("|");
  const estTerre = (lat: number, lon: number): boolean => {
    // La grille commence à 84° nord et descend d'un degré par rangée.
    const li = Math.round(84 - lat);
    const ligne = lignes[li];
    if (!ligne) return false;
    const ci = ((Math.round(lon + 180) % 360) + 360) % 360;
    return ligne[ci] === "1";
  };

  const ecartMoyen = Math.sqrt(41253 / SEMIS);   // en degrés
  const pts: Point3[] = [];

  for (let i = 0; i < SEMIS; i++) {
    // Réparti sur le sinus : c'est ce qui rend la densité constante. Répartir
    // sur la latitude elle-même entasserait les points aux pôles.
    const sinLat = 1 - (2 * i + 1) / SEMIS;
    let lat = (Math.asin(sinLat) * 180) / Math.PI;
    let lon = (((i * ANGLE_OR) % (2 * Math.PI)) * 180) / Math.PI - 180;

    lat += bruit(i, 1) * ecartMoyen * 0.38;
    // En longitude, le même déplacement au sol vaut plus de degrés près des
    // pôles : on divise par le cosinus, borné pour ne pas exploser au sommet.
    const c = Math.max(0.08, Math.cos((lat * Math.PI) / 180));
    lon += (bruit(i, 2) * ecartMoyen * 0.38) / c;

    if (!estTerre(lat, lon)) continue;
    pts.push(vec(lat, lon));
  }

  cacheTerre = pts;
  return pts;
}

const TRAITS_ENC =
  "|yrcty8cjx_cgxRcfxFcixvcuxgcEx4cIwXcNwScZwKd9wJdnwVdwwVdIwUdVx7dWxrdWy1dBygdl|puhqpQhrpWhzpZhNqbhYqgi8qmihqviiqDihqMijqNi7qgi7qhhKq7hJq7hppwhppthm|7LmE7QmP7zmW7pn579nh6Znq6Pnn6Fnh6xno6gnv66nv66oo66oZ|hFl7hylrhnlshclnh5lbgZl6gHl6grl6gckZf_kUfRkUfCkIfrkGfgkBfgkOfhl0fel9f4leeWlkeLlseDlweulzeklDeblAdYlDdQlBdGlFdwlGdmlIcYlKcplKbTlKbqlKaXlKaulKa0lK9SlK9olK8YlK|cZi7cOi9cDigcvitcmiGc7iKbViFbNiNbEiXbvj2bej2aOiZarj4acj9a0ja9Rj9|zPlkzFlxzplEzslOzAlZzKlTA4m9Ajm9AFm2ARl-B0m2Bgm3BslZBJm0BwmcBFmgBGmtCkmACOmGCXmKDdmIDgmxDqmADDmwDMmrE9mBEimqEEm1EXm0Fam3FklXFvlRFIlSFGlFFylFFxlvF8ltF1lbEEl5ENkQEHkIEvkNEhkOE0kODKkRDmkMDekHCXkyCPkrCzkwCxkECtkOChkVC0kUBQkTBHl0Byl4BjlbATl6AUkxAIkEApkFAlkC|DekHDgkvDzktDmklDakmCZkrCRkfCJkgCQk2CKjTCxjWCkk4Cak9BUklBPkvBBkwBwkGBikMBakGB1kCAUkx|OacFOad9OadG|LGcHLHcC|JheoJpecJCedJNejJWegK2eiK7ewKfeLKqeLKzeJ|hG5vhq5vhq5S|hq5Vhh5XgV5YgR69gH6cgG6ngR6ygV6LgY6Yg_78gV7igS7tgV7IgX7Sg-7_h18ch18lh88Ahe8Khe8Th79ahd9lhc9uhf9Dhm9Nhq9XhsafhDakhGauhNaGh-aDi8aEikaEiEaliMakiYacj6a8i-9Rj89Ojj9NjA9WjCa3jM9_jD9Njl9zj89mj59ej394j38Wj08N|h8bdhlbdhsb2hoaUhuaJhyavhFax|wXcNwGcMwDcAwBcowAcewJc8wNb_wBc5wqcbwicdw6cjvXcjvPcnvEcmvCcxvycHvxcRvlcXvacYv6cQuZcQuPcVuKd2ued9u3d7|u2dauadkuldnuwdpuEdxuEdFuIdPuTdZuWe7uXelv0exv1eKvbeSvjePvxeKvHeOvYeTw5eUwgeUwqeUwweMwIeMwYeDwYerwRefwOe2wMdTwJdKwJdzwJdn|yEdPyydXyyewyHeHyQeLyZeSzaeSzCfkzJfszNfEzNfOzNfS|xrdWxre5xzegxyezxseLxFeXxOeMy5eEykeCyweLyHeH|y8gUxYgNxUgDxPgoxPgcxLg2xAfRxsfAxsfrxqfExjfSxff-xcfPx2fCwQfHwGfAwwfywnfAwcfFw3fHvZftvPfuvQfFvJfPvFf_vDgavDgjvKgxvTgwvSh8w2hcw2hwwGhwxhhwxVhw|vJfPvxfKvqfzvhfuv7fvuYfjuLffuxfeuvfoukfzutfEutfNutf-uqg9ufgkukgxuwgGuxgTuBhcuzhmuthFuDhKvehrvSh8|gXh9gXh0gXgU|vtmIvDmGvpmzvdmA|MAkGMFkZMCl6MLl9MXl7N2lhN5lsNelFM-lCMRlyMClyMylHMmlOM5lSM1l_LWmaLPmkLHmoLsmrLemqL2mpKWmkKWm8KNl-KzlPKnlTKblSK0lWJNlPJAlOJrlLJelNJ5lNIRlXIHlYIulXIllVI7lZHVm7HMm8HBmcHqm2HllRH6lUGYlUGHlZGym0GjlXG0lPFSlNFOlM|zKkCzykwzokDzfkJz5kLyMkQyxkSypkUyokS|y6lryllzyllIyplQyalTx-lYxGl-xum5xqmfxfmex6mdx1mnxbmnx6mwwYmEwPmOwymSwun0wqnfwwnn|wxnxwSnKw_nQwQo0wLodwSomwHoxwQoFwAoMwKoUw_oY|xmlgxwlgxCld|wCoTwtp2weo-v_oOvRoRvEoQvsoWvgoTuYoOuMoIuvoqugocu6o5t_nXu0nKu3nttXnmtSnh|uH9CuQ9Ev19yvf9Dvfacvoa1vp9UvB9ZvNa7vWa3w2a3wbadwkaiwwawwKaDwTaBx0aBx5anx6a5w-a0x19Pxg9V|wG9ywx9zwm9pwx9jwG9rwG9y|elgZedgUe3gSdWgSdVgJd_gBdPgBdKgtdKgl|j89mjo9fjC99jQ8ZjO8O|jCa3jFaejuakjsaxjjaDj5aDj5aRj4b2j9bej1bnj2bxiKbxiHbJiHbWivbZikc2i5c7hWcghWcrhKcxhwcphhcmh7cmh7cBg_cvgScvgIcBgEcMgAcVgJd2gKdbgXdmh3dohddphidQhgd_hce9heelhxelhFefhVeci2ehieeqi5eti4eGiheGireKiCeNiMeSiReIiMewiQemi_ehj7eljgenjpeojxetjHepjTepj-eAk3eK|j2aWiVb2iMb3iub0ipaTilaC|hgbkhmbvhibDhnbPhnbYhpc6hhcm|fBdyfAdofIdnfSdnf-dCgadGgldQgme2gwd_gJdJgWdKh4dJh5dvhddp|gme2gde8g2e8fPei|fZfcg1fpg2fr|g_fWgSfPgKfBgNfqgPfgh5fbhif1htf2hDf1hzeUhAeGhyewhHeh|fafmfbfvfffA|eLfPeTfOf1fLf3fN|evg6eFgeeQgke-gnf9gq|eqgaegghecgremgx|e3gdeagk|edgSecgzefgz|iOfoiGfeiBf2iFeU|jdf0jbeTj4eJjdewjjen|jIe-jDeRjIeEjFevjDer|sxm3sIlYsUlUt1lPtblMtplKtjlwt4lntclgtbl6tkkZtikV|sCkJsqkHsfkMrVkOrRkS|wKaDwwaJwtaTweb3w5bjwgbiwsbnwBbvwLbEwTbBx0bBxbbwxgbgxeb2xfaVxaaNx0aB|vfacvfaGvpaGvpbdvMbhvWbhw3bjw5bj|tZbnu8brulbmu_bnvubhvMblvUbnw3bkw3bj|pzgBpIgEpSgGq2gAqegmqhgaqlg0qbf_p_g2pJg2pxg0|pwg8pFg7pRg9p-gbpRgcpIgcpxgc|qegmqnguqzgtrhgvrhgDrchir7h-rnh-rVhEsqhiszhbsPh4sPgJsIgwszgusmgtscgps3grrQgmrGgerwgbrsg1rkfVrifIr7fIqYfFqOfMqMfWqBfZqrf-qlg0|qNimrnh-|srf1spfvsjfGshfOsrfUsAf-sIfRsIfHsEfyszfpszf3|upg5udgcu3g6tSgatJg9tyg4tmg9tcg7s-gfsQgdsJg2sIfV|sufXsig5scggscgp|sPh4t1h8tuhsu0hLughGuthF|umg1uofUugfMucfAu8fru1fitZfatNfbtDf5tweXtteQ|uxfeusf4upeXuueKuyeBuEeruveounequbert-ertEer|sje_sef9sffnscfzs8fLshfO|rHeSrEf3rGferKfmrIfArHfOrYfOs8fO|rifIrtfArBfDrIfA|qXeMqYeUqUf1qPfeqRfnqTfyqUfG|qQfhqGffqCfpqtfuqpfEqefDq4ft|pNfOpXfVp_g2|qmf8qtfjqyfo|v1eDuPeFuEer|v-fmwafawhe_wqeU|uadkt_di|tTdstXdEu5dIukdHuodTuie4unegudehuber|tDeetVeftVer|xgcExncrxjcgxlc8xfbXwSbMwTbF|vMblvzbzvzc3vUc3vTcfvTcn|xychxybYxJbOxKbBxCbsxvbFxxbOxkbU|x99Vx6a2|wGdEwPdJwVdI|xDjfxCj3xBiHxviY|xMjuxNjmxKjh|xHj8xGi_|tXjftRj5tHi-tIiRtzj5tkjhtpjvtsjDtqjMtsjR|qNipqNiAr1iIrbiJrkiMrziVrFj1rXj7rTjnrOjA|tDiPtGiGtFittEijtBi9tHhZtQhWu0hL|xJjbxUj7ycjiygj6xWi_y4iRxTiLxCiG|AVi9AXi5|AYhZAPhPAMhHAghGAchQAchS|AahWA4hY|zIiyzziCzqiDzxiNzEiM|ycjiyyjsyCjEyGjOyQjWy_jVz8jUzejIzmjzzejozljezxj9zBiWzKiL|zqiDz7iEyHiYysj3ygj6|ArgHAgh2AKhcARhwAMhD|Iaf-I7gaIegiIrgkIAgjIIgfIWgiIXf_IGfUIrfJ|I5f2HYeZHPf6HNf5|HyfDHCfOHIfXHEg4HDgeHugrHBgCHrgQHmgYHvh9HHheHRhdHWgYHXgPI5gVIegUIogWIvgOIwgEIEgwIDgnIAgj|HNhgHYhqI1hzIchtIghkIshkIwhbInh5Izg_IHgPIOgGIYgsIWgi|GAhjGzhrGIhzGJhRGWhXH0i8HcilHmirHuipHzifHzi7Hph_HohPHzhRHBhHHEhxHQhsHYhq|I6hBIjhDIthEIBhKIPhEIShuJ0hs|Mck6L_k3LSj-LSjZ|LzkjLHkqLSkvM1kzMakzMokIMykI|KnlTKblBKjlzKtlxKJlxKSlqKJloKulnKgldK1l9JTl4JIl6Jxl1JvkSJckJIZkJIJkFIykAIhkDI2kJHUkLHHkJHnkLHbkLH1k-GLl6Gxl7Gll9GmlpGflxG1lBFUlGFSlN|GDhwGxhMGohLGAh-Glh_Gbi1F-icG1i0FVhVFZhMG2hx|COhNDehUDci0D6idDaisDmirDwiCDCiMDMiWDVj7DNjcDFjrD-jtE9jvEijDEtjrEsjjEwj9Eri_EBiVEPiOEFiAEPiwEYirF9imFnikFAieFMicFVicFUimG9ifGoigGwigGtiqGBirGKiyGWiFH2iCHeiAHliv|G0ilGcivGpisGtiq|EPiOE_iNF9iHFiiAFyiuFKisFVir|BLh_BPiaC1igBXivBOizBFiKBViFC3iHCiiHCviLCwiTCJiZCSj1D1jfD3joDdjoDkjADhjJDxjPDJjQDUjTE2jHEijD|CKjTCVjVD5jYDck5DijTDujSDIjWDSjWDUjT|BFiKBOiTBFi_BBjeBEjsBIjEBSjBC0jHCdjLCojVCxjW|DekmD0klD9kgDmkdDFkeDHk5DRk4DSjW|EHkIEpkAE9kvDXkqDGkjDFke|BIjEBHjNBojWB5k0AWj_AIjWAzjU|z8jUz2k0z1kezakdzlk7zBkfzKk3zNk3|xNjGxTjQy6jRyjjPyvjTyLjU|zlk7zdkfz4kkyYkvzakwzjkmzpk8|vmoTvAoOvPoHvQosvToo|x6mdwZmcwJm6wym8wfmaw5mbvUm8vMmhvPmrvYmvw7mzwimIwymS|wMl9wDl9wFljwOljwKltwzlCwllEwblAw1lxvSlAvHlzvDlIvOlXvPm8|vGlLvwlPvklOv9lQv0lUuUlYuLlWuzm0uqm9uomiulmu|vHmzvPmv|vHlzvwlqvilhv4lfuUlguKlluGlp|uOlBuGlpuvlnuillu4lotUlptHlptWlvu6lxuglJutlKuElHuOlGuXlyv3lzvdlDvllGvzlDvBlE|wylbwylkwsluwilC|wCkVwok-wdkXvVkVvJkWvFl3vwl4voldvilh|vrmQvCmTvTmTw1mUwhmM|vXn6w4n8whn3wpn3|uum3ulm1ualZu5lPuglJ|tElvttlytjlw|t6lPt6m0t4mbtcmetfmntdmr|ttmGtHmG|wwkEwnkFwdkCw4kwvRkxvJkEvGkNvEkYvHk-|wdkCwfktwdks|vikgvnkovxktvGkvvKkx|yEkzyOkAyYkv|vakDvdkLvmkDvqks|v4lfv6l5uXl7uOl8uEl8uGl0uRkSv2kKv0kJ|uhlbuqlcuBleuKll|tMlptAlktrlithletclg|t1lPt4lV|sFm5sWm7t6m0|qKkDqUkCr5kDr3knr1kar2k1qZjT|qYmHqYmxramv|uillujlc|zakwzkkvzokD|J-eNK9eLKbeW|uOlGuXlJv5lP|yTg3yIg5yAgeyoglyfgny3gqxQgk|yQgDyWgQzcgOzogMzzgLzGgWzPg-Agh2|xsjzxhjzxfjz|w2hww2i5w2iEv_iMw0iXw4j0|xFeXxzf6xofhxsfr|yMg1yFfUyOfPyRfEyZfwztfkzCfk|yTfTyQfN|wUdVwMdT|wYeDx7eExfeGxseL|v6l5vckYv3kQv2kK|vmkDvwkGvEkH|vwkGvrkPvjkMv8kT|vjkMvhkK";

const ALPHA_T = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

let cacheTraits: Point3[][] | null = null;

/** Les littoraux et frontières, en polylignes. */
export function traits(): Point3[][] {
  if (cacheTraits) return cacheTraits;
  cacheTraits = TRAITS_ENC.split("|").slice(1).map((seg) => {
    const l: Point3[] = [];
    for (let k = 0; k + 3 < seg.length; k += 4) {
      const x = ALPHA_T.indexOf(seg[k]) * 64 + ALPHA_T.indexOf(seg[k + 1]);
      const y = ALPHA_T.indexOf(seg[k + 2]) * 64 + ALPHA_T.indexOf(seg[k + 3]);
      l.push(vec(y / 10 - 90, x / 10 - 180));
    }
    return l;
  }).filter((l) => l.length > 1);
  return cacheTraits;
}

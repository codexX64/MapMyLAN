// Repères géographiques par pays.
//
// Une table de référence, pas une supposition sur ton trafic : à chaque code
// ISO à deux lettres correspond un point représentatif du pays, choisi près de
// son centre habité. Elle sert à placer une destination dont on connaît le pays
// d'enregistrement du préfixe, faute de connaître sa ville.
//
// Ce point n'est **pas** la position du serveur. Un préfixe enregistré aux
// États-Unis peut être annoncé depuis Paris ; c'est courant chez les
// hébergeurs à diffusion anycast. L'interface doit le dire, et le dessin doit
// s'en distinguer — arc pointillé, marqueur creux.
//
// Un code absent de cette table reste sans point : listé, jamais placé.

export interface Pays { code: string; nom: string; lat: number; lon: number }

const T: [string, string, number, number][] = [
  ["FR", "France", 46.6, 2.4], ["BE", "Belgique", 50.6, 4.7], ["LU", "Luxembourg", 49.8, 6.1],
  ["CH", "Suisse", 46.8, 8.2], ["DE", "Allemagne", 51.2, 10.4], ["NL", "Pays-Bas", 52.2, 5.5],
  ["GB", "Royaume-Uni", 54.0, -2.0], ["IE", "Irlande", 53.2, -8.0], ["ES", "Espagne", 40.3, -3.7],
  ["PT", "Portugal", 39.6, -8.0], ["IT", "Italie", 42.8, 12.6], ["AT", "Autriche", 47.6, 14.1],
  ["DK", "Danemark", 56.0, 9.5], ["SE", "Suède", 62.0, 15.0], ["NO", "Norvège", 64.0, 11.0],
  ["FI", "Finlande", 64.0, 26.0], ["IS", "Islande", 64.9, -19.0], ["PL", "Pologne", 52.1, 19.4],
  ["CZ", "Tchéquie", 49.8, 15.5], ["SK", "Slovaquie", 48.7, 19.5], ["HU", "Hongrie", 47.2, 19.4],
  ["RO", "Roumanie", 45.9, 25.0], ["BG", "Bulgarie", 42.7, 25.3], ["GR", "Grèce", 39.1, 22.0],
  ["HR", "Croatie", 45.1, 15.5], ["SI", "Slovénie", 46.1, 14.8], ["RS", "Serbie", 44.0, 20.9],
  ["BA", "Bosnie", 44.0, 17.8], ["AL", "Albanie", 41.1, 20.1], ["MK", "Macédoine du Nord", 41.6, 21.7],
  ["ME", "Monténégro", 42.8, 19.3], ["EE", "Estonie", 58.7, 25.5], ["LV", "Lettonie", 56.9, 24.9],
  ["LT", "Lituanie", 55.3, 23.9], ["BY", "Biélorussie", 53.7, 28.0], ["UA", "Ukraine", 49.0, 31.4],
  ["MD", "Moldavie", 47.2, 28.5], ["RU", "Russie", 58.0, 50.0], ["TR", "Turquie", 39.0, 35.2],
  ["CY", "Chypre", 35.1, 33.2], ["MT", "Malte", 35.9, 14.4], ["MC", "Monaco", 43.7, 7.4],
  ["AD", "Andorre", 42.5, 1.6], ["LI", "Liechtenstein", 47.2, 9.5],

  ["US", "États-Unis", 39.5, -98.4], ["CA", "Canada", 56.1, -106.3], ["MX", "Mexique", 23.6, -102.5],
  ["BR", "Brésil", -10.8, -52.9], ["AR", "Argentine", -35.4, -65.2], ["CL", "Chili", -33.5, -70.7],
  ["CO", "Colombie", 4.6, -74.1], ["PE", "Pérou", -9.2, -75.0], ["VE", "Venezuela", 7.1, -66.1],
  ["UY", "Uruguay", -32.5, -55.8], ["PY", "Paraguay", -23.4, -58.4], ["BO", "Bolivie", -16.3, -63.6],
  ["EC", "Équateur", -1.4, -78.2], ["CR", "Costa Rica", 9.7, -84.1], ["PA", "Panama", 8.5, -80.1],
  ["GT", "Guatemala", 15.5, -90.3], ["CU", "Cuba", 21.5, -78.0], ["DO", "Rép. dominicaine", 18.7, -70.2],
  ["PR", "Porto Rico", 18.2, -66.4], ["JM", "Jamaïque", 18.1, -77.3],

  ["CN", "Chine", 35.0, 104.2], ["JP", "Japon", 36.2, 138.3], ["KR", "Corée du Sud", 36.5, 127.9],
  ["KP", "Corée du Nord", 40.3, 127.5], ["TW", "Taïwan", 23.7, 121.0], ["HK", "Hong Kong", 22.3, 114.2],
  ["SG", "Singapour", 1.35, 103.8], ["MY", "Malaisie", 4.2, 101.9], ["TH", "Thaïlande", 15.9, 100.9],
  ["VN", "Viêt Nam", 14.1, 108.3], ["PH", "Philippines", 12.9, 121.8], ["ID", "Indonésie", -2.5, 118.0],
  ["IN", "Inde", 22.6, 79.0], ["PK", "Pakistan", 30.4, 69.3], ["BD", "Bangladesh", 23.7, 90.4],
  ["LK", "Sri Lanka", 7.9, 80.8], ["NP", "Népal", 28.4, 84.1], ["MM", "Birmanie", 21.9, 96.0],
  ["KH", "Cambodge", 12.6, 104.9], ["LA", "Laos", 19.9, 102.5], ["MN", "Mongolie", 46.9, 103.8],
  ["KZ", "Kazakhstan", 48.0, 66.9], ["UZ", "Ouzbékistan", 41.4, 64.6], ["AZ", "Azerbaïdjan", 40.1, 47.6],
  ["GE", "Géorgie", 42.3, 43.4], ["AM", "Arménie", 40.1, 45.0], ["IR", "Iran", 32.4, 53.7],
  ["IQ", "Irak", 33.2, 43.7], ["SA", "Arabie saoudite", 24.0, 45.1], ["AE", "Émirats arabes unis", 24.0, 54.0],
  ["QA", "Qatar", 25.3, 51.2], ["KW", "Koweït", 29.3, 47.5], ["BH", "Bahreïn", 26.1, 50.6],
  ["OM", "Oman", 21.5, 55.9], ["JO", "Jordanie", 31.3, 36.5], ["LB", "Liban", 33.9, 35.9],
  ["IL", "Israël", 31.4, 35.0], ["SY", "Syrie", 34.8, 38.996],

  ["EG", "Égypte", 26.8, 30.8], ["MA", "Maroc", 31.8, -7.1], ["DZ", "Algérie", 28.0, 2.6],
  ["TN", "Tunisie", 34.0, 9.6], ["LY", "Libye", 26.3, 17.2], ["SN", "Sénégal", 14.5, -14.5],
  ["CI", "Côte d'Ivoire", 7.5, -5.5], ["GH", "Ghana", 7.9, -1.0], ["NG", "Nigeria", 9.1, 8.7],
  ["CM", "Cameroun", 5.7, 12.7], ["KE", "Kenya", 0.2, 37.9], ["TZ", "Tanzanie", -6.4, 34.9],
  ["UG", "Ouganda", 1.4, 32.3], ["ET", "Éthiopie", 9.1, 40.5], ["ZA", "Afrique du Sud", -28.5, 24.7],
  ["ZW", "Zimbabwe", -19.0, 29.9], ["ZM", "Zambie", -13.1, 27.9], ["AO", "Angola", -11.2, 17.9],
  ["MZ", "Mozambique", -18.7, 35.5], ["MU", "Maurice", -20.3, 57.6], ["RE", "La Réunion", -21.1, 55.5],
  ["MG", "Madagascar", -18.8, 46.9],

  ["AU", "Australie", -25.3, 133.8], ["NZ", "Nouvelle-Zélande", -41.0, 172.8],
  ["FJ", "Fidji", -17.7, 178.1], ["PG", "Papouasie-Nouvelle-Guinée", -6.3, 143.9],
];

const PAR_CODE = new Map<string, Pays>(
  T.map(([code, nom, lat, lon]) => [code, { code, nom, lat, lon }]),
);

/** Le point représentatif d'un code ISO, ou rien si le code n'est pas connu. */
export function paysDe(code?: string): Pays | undefined {
  if (!code || code.length !== 2) return undefined;
  return PAR_CODE.get(code.toUpperCase());
}

import { describe, it, expect } from "vitest";
import {
  disposerEnArbre, estInfra, coude, PAS_COLONNE, PAS_LIGNE, DEPART_X, AXE_Y,
} from "./topologie-arbre";

const app = (id: string, type: string, ip = "192.0.2.1", isMainRouter = false) =>
  ({ id, type, ip, isMainRouter });

describe("ce qui tient la colonne vertébrale", () => {
  it("reconnaît l'infrastructure", () => {
    expect(estInfra(app("a", "router"))).toBe(true);
    expect(estInfra(app("a", "switch"))).toBe(true);
    expect(estInfra(app("a", "ap"))).toBe(true);
    expect(estInfra(app("a", "firewall"))).toBe(true);
  });

  it("laisse les terminaux en feuilles", () => {
    expect(estInfra(app("a", "computer"))).toBe(false);
    expect(estInfra(app("a", "printer"))).toBe(false);
    expect(estInfra(app("a", "unknown"))).toBe(false);
  });

  // Un appareil marqué passerelle principale l'emporte sur son type : c'est
  // l'équipement par lequel MapMyLAN agit, il ouvre la colonne.
  it("suit le drapeau de passerelle principale", () => {
    expect(estInfra({ id: "a", type: "computer", isMainRouter: true })).toBe(true);
  });
});

describe("la colonne s'aligne de gauche à droite", () => {
  it("met la passerelle en tête, puis commutateur, puis borne", () => {
    const { positions } = disposerEnArbre([
      app("ap", "ap", "192.0.2.2"),
      app("sw", "switch", "192.0.2.3"),
      app("gw", "router", "192.0.2.1", true),
    ]);
    expect(positions.gw.x).toBeLessThan(positions.sw.x);
    expect(positions.sw.x).toBeLessThan(positions.ap.x);
    // Tous sur le même axe : c'est ce qui fait la ligne d'horizon du schéma.
    expect(positions.gw.y).toBe(AXE_Y);
    expect(positions.sw.y).toBe(AXE_Y);
    expect(positions.ap.y).toBe(AXE_Y);
  });

  it("espace les colonnes d'un pas constant", () => {
    const { positions } = disposerEnArbre([
      app("gw", "router", "192.0.2.1", true),
      app("sw", "switch", "192.0.2.3"),
    ]);
    expect(positions.gw.x).toBe(DEPART_X);
    expect(positions.sw.x).toBe(DEPART_X + PAS_COLONNE);
  });

  // Deux relevés successifs doivent donner le même dessin, sinon la carte
  // bouge toute seule d'un balayage à l'autre.
  it("range à nature égale par adresse, donc de façon stable", () => {
    const a = disposerEnArbre([app("s2", "switch", "192.0.2.9"), app("s1", "switch", "192.0.2.3")]);
    const b = disposerEnArbre([app("s1", "switch", "192.0.2.3"), app("s2", "switch", "192.0.2.9")]);
    expect(a.positions).toEqual(b.positions);
    expect(a.positions.s1.x).toBeLessThan(a.positions.s2.x);
  });
});

describe("les feuilles pendent de leur parent", () => {
  const socle = [
    app("gw", "router", "192.0.2.1", true),
    app("sw", "switch", "192.0.2.3"),
  ];

  it("suit les liaisons connues", () => {
    const { positions } = disposerEnArbre(
      [...socle, app("pc", "computer", "192.0.2.20")],
      [{ fromId: "sw", toId: "pc" }],
    );
    // Une colonne à droite du commutateur, pas de la passerelle.
    expect(positions.pc.x).toBe(positions.sw.x + PAS_COLONNE);
  });

  // Une liaison entre deux appareils qu'aucun chemin ne relie à la racine
  // reste une liaison enregistrée : elle prime sur le repli.
  it("suit une liaison même hors du chemin de la racine", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, app("pc", "computer"), app("imp", "printer")],
      // Ni sw ni pc ne sont reliés à gw par une liaison enregistrée.
      [{ fromId: "sw", toId: "pc" }, { fromId: "pc", toId: "imp" }],
    );
    expect(rattachements.pc).toBe("sw");
    expect(rattachements.imp).toBe("pc");
  });

  it("lit la liaison dans les deux sens", () => {
    const a = disposerEnArbre([...socle, app("pc", "computer")], [{ fromId: "sw", toId: "pc" }]);
    const b = disposerEnArbre([...socle, app("pc", "computer")], [{ fromId: "pc", toId: "sw" }]);
    expect(a.positions.pc).toEqual(b.positions.pc);
  });

  // Le repli quand rien n'est connu : la racine, jamais le dernier équipement
  // de la colonne. Comme la colonne est rangée par nature — passerelle,
  // commutateur, borne — le dernier est la borne, et tout le parc non rattaché
  // se retrouvait accroché à un point d'accès sans aucun client.
  it("rattache à la racine, pas à la borne, quand rien n'est connu", () => {
    const socleAvecBorne = [...socle, app("ap", "ap", "192.0.2.2")];
    const { positions, rattachements } = disposerEnArbre(
      [...socleAvecBorne, app("pc", "computer")], []);
    expect(rattachements.pc).toBe("gw");
    expect(positions.pc.x).toBe(positions.gw.x + PAS_COLONNE);
  });

  // Le contrôleur relève le commutateur qui porte chaque appareil. C'est une
  // mesure : elle prime sur tout repli.
  it("suit le commutateur relevé quand aucune liaison n'est enregistrée", () => {
    const { rattachements } = disposerEnArbre([
      { id: "gw", type: "router", ip: "192.0.2.1", isMainRouter: true, mac: "AA:BB:CC:00:00:01" },
      { id: "sw", type: "switch", ip: "192.0.2.3", mac: "AA:BB:CC:00:00:02" },
      { id: "ap", type: "ap", ip: "192.0.2.2", mac: "AA:BB:CC:00:00:03" },
      { id: "pc", type: "computer", ip: "198.51.100.20", swMac: "aa:bb:cc:00:00:02" },
      { id: "srv", type: "server", ip: "198.51.100.21", swMac: "F4:C7:AA:00:00:99" },
    ], []);
    // Casse ignorée : le relevé et la fiche ne l'écrivent pas pareil.
    expect(rattachements.pc).toBe("sw");
    // Un commutateur inconnu du parc ne donne rien : on retombe sur la racine,
    // pas sur la borne.
    expect(rattachements.srv).toBe("gw");
  });

  it("empile les feuilles et centre la pile sur l'axe", () => {
    const { positions } = disposerEnArbre([
      ...socle,
      app("a", "computer", "192.0.2.10"),
      app("b", "computer", "192.0.2.11"),
      app("c", "computer", "192.0.2.12"),
    ], [
      { fromId: "sw", toId: "a" }, { fromId: "sw", toId: "b" }, { fromId: "sw", toId: "c" },
    ]);
    expect(positions.a.x).toBe(positions.b.x);
    expect(positions.b.x).toBe(positions.c.x);
    expect(positions.b.y - positions.a.y).toBe(PAS_LIGNE);
    // Trois appareils : celui du milieu tombe pile sur l'axe.
    expect(positions.b.y).toBe(AXE_Y);
  });

  it("centre aussi une pile d'un seul appareil", () => {
    const { positions } = disposerEnArbre(
      [...socle, app("seul", "computer")], [{ fromId: "sw", toId: "seul" }]);
    expect(positions.seul.y).toBe(AXE_Y);
  });

  // La carte a besoin de savoir de QUI pend chaque feuille : un appareil dont
  // aucune liaison n'est enregistrée doit quand même être relié au dessin.
  it("dit à quel nœud chaque feuille est rattachée", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, app("pc", "computer"), app("tel", "phone")],
      [{ fromId: "sw", toId: "pc" }, { fromId: "gw", toId: "tel" }],
    );
    expect(rattachements.tel).toBe("gw");
    expect(rattachements.pc).toBe("sw");
    // La racine ne pend de personne.
    expect(rattachements.gw).toBeUndefined();
  });

  it("décrit le tronc qui porte la pile", () => {
    const { troncs } = disposerEnArbre([
      ...socle,
      app("a", "computer", "192.0.2.10"),
      app("b", "computer", "192.0.2.11"),
    ], [{ fromId: "sw", toId: "a" }, { fromId: "sw", toId: "b" }]);
    expect(troncs).toHaveLength(1);
    expect(troncs[0].depuis).toBe("sw");
    expect(troncs[0].y2 - troncs[0].y1).toBe(PAS_LIGNE);
  });
});

describe("ce que le contrôleur a mesuré", () => {
  const GW = "AA:00:00:00:00:01", SW = "AA:00:00:00:00:02", AP = "AA:00:00:00:00:03";
  const socle = [
    { id: "gw", type: "router", ip: "192.0.2.1", isMainRouter: true, mac: GW },
    { id: "sw", type: "switch", ip: "192.0.2.2", mac: SW, uplinkMac: GW },
    { id: "ap", type: "ap", ip: "192.0.2.3", mac: AP, uplinkMac: SW },
  ];

  // L'équipement déclare lui-même son amont : c'est la hiérarchie que
  // l'interface du constructeur affiche, il n'y a rien à en déduire.
  it("suit l'amont déclaré par l'équipement, sans aucune liaison", () => {
    const { rattachements } = disposerEnArbre(socle, []);
    expect(rattachements.sw).toBe("gw");
    expect(rattachements.ap).toBe("sw");
  });

  it("place un client filaire sur son commutateur", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, { id: "pc", type: "computer", ip: "198.51.100.10", medium: "wired", swMac: SW }], []);
    expect(rattachements.pc).toBe("sw");
  });

  it("place un client sans fil sur sa borne", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, { id: "tel", type: "phone", ip: "198.51.100.11", medium: "wireless", apMac: AP }], []);
    expect(rattachements.tel).toBe("ap");
  });

  // Le piège qui a mis quatre machines filaires sur une borne sans client :
  // plusieurs micrologiciels renseignent la MAC de borne sur des appareils
  // filaires, où elle désigne l'amont et pas une borne.
  it("ignore la borne annoncée sur un appareil filaire", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, { id: "srv", type: "server", ip: "198.51.100.12", medium: "wired", apMac: AP }], []);
    expect(rattachements.srv).not.toBe("ap");
    expect(rattachements.srv).toBe("gw");
  });

  it("laisse la main tracée l'emporter sur la mesure", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, { id: "pc", type: "computer", ip: "198.51.100.10", medium: "wired", swMac: SW }],
      [{ fromId: "gw", toId: "pc", manual: true }],
    );
    expect(rattachements.pc).toBe("gw");
  });

  // Une liaison automatique vient des mêmes mesures, mais telles qu'elles
  // étaient à la dernière reconstruction. La mesure du jour est plus fraîche.
  it("préfère la mesure du jour à une liaison automatique périmée", () => {
    const { rattachements } = disposerEnArbre(
      [...socle, { id: "pc", type: "computer", ip: "198.51.100.10", medium: "wired", swMac: SW }],
      [{ fromId: "gw", toId: "pc" }],
    );
    expect(rattachements.pc).toBe("sw");
  });
});

describe("deux sous-arbres ne se marchent pas dessus", () => {
  // Le défaut que cette disposition doit éviter : une passerelle qui porte à la
  // fois un commutateur ET des machines. Si les machines se posaient une
  // colonne à droite en se centrant sur l'axe, elles tomberaient exactement sur
  // le commutateur.
  it("sépare les machines de la passerelle du commutateur qu'elle porte", () => {
    const { positions } = disposerEnArbre(
      [
        app("gw", "router", "192.0.2.1", true),
        app("sw", "switch", "192.0.2.3"),
        app("srv", "server", "192.0.2.10"),
        app("pc", "computer", "192.0.2.40"),
      ],
      [
        { fromId: "gw", toId: "sw" },
        { fromId: "gw", toId: "srv" },
        { fromId: "sw", toId: "pc" },
      ],
    );
    // Le commutateur et le serveur sont tous deux fils de la passerelle : même
    // colonne, mais pas la même ligne.
    expect(positions.sw.x).toBe(positions.srv.x);
    expect(positions.sw.y).not.toBe(positions.srv.y);
    // Et la machine du commutateur est une colonne plus loin, jamais sur lui.
    expect(positions.pc.x).toBe(positions.sw.x + PAS_COLONNE);
    for (const [a, b] of [["sw", "srv"], ["sw", "pc"], ["srv", "pc"]] as const) {
      expect(positions[a]).not.toEqual(positions[b]);
    }
  });

  it("range par génération, pas par nature", () => {
    const { positions } = disposerEnArbre(
      [
        app("gw", "router", "192.0.2.1", true),
        app("sw", "switch", "192.0.2.3"),
        app("ap", "ap", "192.0.2.2"),
      ],
      // La borne est branchée sur le commutateur, pas sur la passerelle.
      [{ fromId: "gw", toId: "sw" }, { fromId: "sw", toId: "ap" }],
    );
    expect(positions.sw.x).toBe(positions.gw.x + PAS_COLONNE);
    expect(positions.ap.x).toBe(positions.sw.x + PAS_COLONNE);
  });

  it("centre un équipement en face de ses appareils", () => {
    const { positions } = disposerEnArbre(
      [
        app("gw", "router", "192.0.2.1", true),
        app("a", "computer", "192.0.2.10"),
        app("b", "computer", "192.0.2.11"),
        app("c", "computer", "192.0.2.12"),
      ],
      [],
    );
    expect(positions.gw.y).toBe((positions.a.y + positions.c.y) / 2);
    expect(positions.b.y).toBe(positions.gw.y);
  });

  // Les liaisons relevées peuvent former une boucle : deux commutateurs
  // reliés entre eux et à la passerelle. Le dessin doit rester un arbre.
  it("ne boucle pas sur des liaisons circulaires", () => {
    const { positions } = disposerEnArbre(
      [
        app("gw", "router", "192.0.2.1", true),
        app("s1", "switch", "192.0.2.3"),
        app("s2", "switch", "192.0.2.4"),
      ],
      [
        { fromId: "gw", toId: "s1" },
        { fromId: "s1", toId: "s2" },
        { fromId: "s2", toId: "gw" },
      ],
    );
    expect(Object.keys(positions).sort()).toEqual(["gw", "s1", "s2"]);
    expect(positions.s1.x).toBe(positions.gw.x + PAS_COLONNE);
  });
});

describe("cas limites", () => {
  it("accepte une carte vide", () => {
    expect(disposerEnArbre([])).toEqual({ positions: {}, troncs: [], rattachements: {} });
  });

  // Sans aucun équipement réseau, tout est feuille : personne ne doit
  // disparaître de la carte pour autant.
  it("place quand même les appareils sans infrastructure", () => {
    const { positions } = disposerEnArbre([app("a", "computer"), app("b", "printer")]);
    expect(Object.keys(positions).sort()).toEqual(["a", "b"]);
    expect(positions.a).not.toEqual(positions.b);
  });
});

// Reproduction de la structure relevée sur une installation réelle : douze
// appareils, six liaisons enregistrées, le reste rattaché par le commutateur
// relevé. Adresses de documentation, aucune donnée d'installation.
const DM = "6C:63:F8:00:00:01", USW = "9C:05:D6:00:00:02", INCONNU = "F4:C7:AA:00:00:99";
const parc = [
  { id: "dm", type: "router", ip: "192.0.2.1", mac: DM, isMainRouter: true },
  { id: "usw", type: "switch", ip: "192.0.2.2", mac: USW, swMac: DM },
  { id: "wr", type: "unknown", customType: "ap", ip: "192.0.2.3", swMac: DM },
  { id: "mbp", type: "unknown", ip: "198.51.100.206", swMac: USW },
  { id: "live", type: "unknown", ip: "203.0.113.252", swMac: INCONNU },
  { id: "prox", type: "hypervisor", ip: "203.0.113.10", swMac: INCONNU },
  { id: "idrac", type: "pc", ip: "203.0.113.14", swMac: USW },
  { id: "kvm", type: "unknown", ip: "203.0.113.15", swMac: USW },
  { id: "docker", type: "pc", ip: "203.0.113.20", swMac: USW },
  { id: "iam", type: "unknown", ip: "203.0.113.40", swMac: USW },
  { id: "netgear", type: "router", ip: "198.51.100.4", swMac: USW },
  { id: "kali", type: "hypervisor", ip: "198.51.100.10", swMac: INCONNU },
];
const liens = [
  { fromId: "dm", toId: "usw" }, { fromId: "usw", toId: "iam" },
  { fromId: "usw", toId: "docker" }, { fromId: "usw", toId: "idrac" },
  { fromId: "usw", toId: "kvm" },
];

describe("une installation réelle", () => {
  it("n'accroche rien à la borne", () => {
    const { rattachements } = disposerEnArbre(parc, liens);
    const surLaBorne = Object.entries(rattachements).filter(([, p]) => p === "wr");
    expect(surLaBorne).toEqual([]);
  });
  it("place chaque appareil sous son commutateur relevé", () => {
    const { rattachements } = disposerEnArbre(parc, liens);
    expect(rattachements.mbp).toBe("usw");
    expect(rattachements.netgear).toBe("usw");
    expect(rattachements.wr).toBe("dm");
    expect(rattachements.usw).toBe("dm");
    // Commutateur inconnu du parc : racine, jamais la borne.
    expect(rattachements.prox).toBe("dm");
    expect(rattachements.kali).toBe("dm");
    expect(rattachements.live).toBe("dm");
  });
  it("tient aussi quand les MAC ne correspondent à rien", () => {
    const sansMac = parc.map(({ mac, swMac, ...reste }) => reste);
    const { rattachements } = disposerEnArbre(sansMac as any, liens);
    expect(Object.values(rattachements)).not.toContain("wr");
  });
});

describe("le tracé des liaisons", () => {
  it("trace une droite quand les deux bouts sont alignés", () => {
    expect(coude({ x: 0, y: 10 }, { x: 100, y: 10 })).toBe("M0 10H100");
  });

  it("trace deux coudes à angle droit sinon", () => {
    expect(coude({ x: 0, y: 0 }, { x: 100, y: 50 }, 40)).toBe("M0 0H40V50H100");
  });

  it("coude au milieu quand aucun tronc n'est imposé", () => {
    expect(coude({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe("M0 0H50V50H100");
  });
});

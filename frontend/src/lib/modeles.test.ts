import { describe, it, expect } from "vitest";
import { familleDuModele } from "./modeles";

describe("reconnaissance du matériel par son modèle", () => {
  it("reconnaît un châssis de baie", () => {
    expect(familleDuModele({ vendor: "Dell Inc.", model: "PowerEdge R730" })).toBe("serveur");
    expect(familleDuModele({ model: "ProLiant DL380 Gen10" })).toBe("serveur");
  });

  it("reconnaît un stockage en réseau", () => {
    expect(familleDuModele({ vendor: "Synology", model: "DS920+" })).toBe("serveur");
    expect(familleDuModele({ hostname: "qnap-sauvegardes" })).toBe("serveur");
  });

  it("reconnaît une carte nue", () => {
    expect(familleDuModele({ vendor: "Raspberry Pi Trading", model: "Pi 4 Model B" })).toBe("carte");
    expect(familleDuModele({ hostname: "esp32-capteur" })).toBe("carte");
  });

  it("sépare le commutateur de la borne chez un même constructeur", () => {
    expect(familleDuModele({ model: "USW-Lite-16-PoE" })).toBe("commutateur");
    expect(familleDuModele({ model: "U6-Lite" })).toBe("borne");
  });

  it("reconnaît une passerelle", () => {
    expect(familleDuModele({ model: "UDM-Pro" })).toBe("routeur");
    expect(familleDuModele({ vendor: "MikroTik", model: "RB4011" })).toBe("routeur");
  });

  it("reconnaît caméras, imprimantes, mobiles et postes", () => {
    expect(familleDuModele({ model: "HikVision DS-2CD2043" })).toBe("camera");
    expect(familleDuModele({ model: "HP LaserJet Pro M404" })).toBe("imprimante");
    expect(familleDuModele({ hostname: "iPhone-de-bureau" })).toBe("mobile");
    expect(familleDuModele({ model: "ThinkPad T480" })).toBe("ordinateur");
  });

  // Deux cas relevés sur une vraie installation : un hyperviseur classé
  // « inconnu » et un portable classé « caméra » par le classifieur.
  it("rattrape un hyperviseur et un portable mal classés", () => {
    expect(familleDuModele({ hostname: "Kali-Linux-Proxmox" })).toBe("serveur");
    expect(familleDuModele({ hostname: "MBP-de-bureau" })).toBe("ordinateur");
  });

  // Le point important : ne rien prétendre quand on ne sait pas. L'appelant
  // garde alors la famille déduite du type, qui reste la référence.
  it("rend la main quand rien ne correspond", () => {
    expect(familleDuModele({})).toBeNull();
    expect(familleDuModele({ vendor: "Constructeur inconnu", hostname: "hote-42" })).toBeNull();
    expect(familleDuModele({ model: "   " })).toBeNull();
  });

  it("lit à travers les séparateurs d'un nom d'hôte", () => {
    expect(familleDuModele({ vendor: "Dell", hostname: "baie.r730.interne" })).toBe("serveur");
  });

  // Une référence nue est ambiguë : R730 est un châssis Dell, T480 un
  // portable Lenovo. Sans le constructeur, on ne tranche pas.
  it("exige le constructeur pour une référence nue", () => {
    expect(familleDuModele({ model: "R730" })).toBeNull();
    expect(familleDuModele({ vendor: "Dell Inc.", model: "R730xd" })).toBe("serveur");
    expect(familleDuModele({ vendor: "Lenovo", model: "ThinkPad T480" })).toBe("ordinateur");
  });

  it("ne se laisse pas piéger par un mot plus long", () => {
    // « switchboard » n'est pas un commutateur, « camerier » pas une caméra.
    expect(familleDuModele({ hostname: "switchboard" })).toBeNull();
    expect(familleDuModele({ hostname: "camerier" })).toBeNull();
  });
});

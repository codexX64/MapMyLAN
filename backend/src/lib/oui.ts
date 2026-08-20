// MAC OUI → vendor mapping. Covers the most common consumer/enterprise prefixes.
// Lookup is done on the first 6 hex chars (3 bytes) of the MAC.
//
// For a fuller dataset: ship the IEEE OUI file at /usr/share/nmap/nmap-mac-prefixes
// and call the parser in `lookupOuiFromFile()` below as a fallback.

import fs from "fs";

interface OuiEntry { vendor: string; type?: string }

const OUI: Record<string, OuiEntry> = {
  // ── Apple ──
  "001451": { vendor: "Apple" }, "0021E9": { vendor: "Apple" }, "002500": { vendor: "Apple" }, 
  "0026B0": { vendor: "Apple" }, "002608": { vendor: "Apple" }, "002241": { vendor: "Apple" }, 
  "0017F2": { vendor: "Apple" }, "001B63": { vendor: "Apple" }, "001D4F": { vendor: "Apple" }, 
  "001E52": { vendor: "Apple" }, "001EC2": { vendor: "Apple" }, "001F5B": { vendor: "Apple" }, 
  "001FF3": { vendor: "Apple" }, "00254B": { vendor: "Apple" }, "0024A8": { vendor: "Apple" }, 

  "0026BB": { vendor: "Apple" }, "002332": { vendor: "Apple" }, "5C95AE": { vendor: "Apple" }, 
  "049226": { vendor: "Apple" }, "0CBC9F": { vendor: "Apple" }, "1093E9": { vendor: "Apple" }, 
  "201D03": { vendor: "Apple" }, "287AEE": { vendor: "Apple" }, "3C2EFF": { vendor: "Apple" }, 
  "F4F15A": { vendor: "Apple" }, "F8FFC2": { vendor: "Apple" }, "1C36BB": { vendor: "Apple" }, 
  "60C547": { vendor: "Apple" }, "AC87A3": { vendor: "Apple" }, "B8782E": { vendor: "Apple" }, 
  "DC2B61": { vendor: "Apple" }, "F0DBE2": { vendor: "Apple" }, "8C2937": { vendor: "Apple" }, 

  // ── Samsung ──
  "002566": { vendor: "Samsung" }, "0023D6": { vendor: "Samsung" }, 
  "001632": { vendor: "Samsung" }, "001D25": { vendor: "Samsung" }, "0023D7": { vendor: "Samsung" }, 
  "001247": { vendor: "Samsung" }, "0024E9": { vendor: "Samsung" }, "0021D2": { vendor: "Samsung" }, 
  "5440AD": { vendor: "Samsung" }, "747548": { vendor: "Samsung" }, "8425DB": { vendor: "Samsung" }, 
  "B43A28": { vendor: "Samsung" }, "C0BDD1": { vendor: "Samsung" }, "F0E77E": { vendor: "Samsung" }, 
  "08FC88": { vendor: "Samsung" }, "1486D9": { vendor: "Samsung" }, "20D390": { vendor: "Samsung" }, 

  // ── Xiaomi / Redmi ──
  "0C1DAF": { vendor: "Xiaomi" }, "100D7F": { vendor: "Xiaomi" }, "14F65A": { vendor: "Xiaomi" }, 
  "187C0A": { vendor: "Xiaomi" }, "286C07": { vendor: "Xiaomi" }, "342387": { vendor: "Xiaomi" }, 
  "50EC50": { vendor: "Xiaomi" }, "640980": { vendor: "Xiaomi" }, "8CBEBE": { vendor: "Xiaomi" }, 
  "98FAE3": { vendor: "Xiaomi" }, "A0C589": { vendor: "Xiaomi" }, "BCF685": { vendor: "Xiaomi" }, 
  "F8A45F": { vendor: "Xiaomi" }, 

  // ── Huawei ──
  "00259E": { vendor: "Huawei" }, "001E10": { vendor: "Huawei" }, "0025B3": { vendor: "Huawei" }, 
  "002568": { vendor: "Huawei" }, "F4DCF9": { vendor: "Huawei" }, "DC0EA1": { vendor: "Huawei" }, 
  "C40528": { vendor: "Huawei" }, 

  // ── Google ──
  "F4F5D8": { vendor: "Google" }, "94EB2C": { vendor: "Google" }, "70886B": { vendor: "Google" }, 
  "1C3947": { vendor: "Google" }, "6466B3": { vendor: "Google" }, "A4DA22": { vendor: "Google" }, 

  // ── Microsoft ──
  "7C1E52": { vendor: "Microsoft" }, 
  "C831CF": { vendor: "Microsoft" }, "60450C": { vendor: "Microsoft" }, 

  // ── Intel ──
  "001B21": { vendor: "Intel" }, "00216B": { vendor: "Intel" }, 
  "001E64": { vendor: "Intel" }, "F8C3D0": { vendor: "Intel" }, "98E743": { vendor: "Intel" }, 
  "B496A1": { vendor: "Intel" }, "0030D3": { vendor: "Intel" }, "001F3C": { vendor: "Intel" }, 

  // ── Network gear ──
  "002554": { vendor: "Cisco", type: "switch" }, "001794": { vendor: "Cisco", type: "switch" }, 
  "0021A0": { vendor: "Cisco", type: "switch" }, "0019AA": { vendor: "Cisco", type: "switch" }, 
  "001AA1": { vendor: "Cisco", type: "switch" }, "0023AC": { vendor: "Cisco", type: "switch" }, 
  "0024F7": { vendor: "Cisco", type: "switch" }, "0026CB": { vendor: "Cisco", type: "switch" }, 
  "B8BE6F": { vendor: "Cisco", type: "switch" }, 

  "B827EB": { vendor: "Raspberry Pi", type: "server" }, "DCA632": { vendor: "Raspberry Pi", type: "server" }, 
  "E45F01": { vendor: "Raspberry Pi", type: "server" }, "D83ADD": { vendor: "Raspberry Pi", type: "server" }, 
  "2CCF67": { vendor: "Raspberry Pi", type: "server" }, 

  "4C5E0C": { vendor: "MikroTik", type: "router" }, "B869F4": { vendor: "MikroTik", type: "router" }, 
  "CC2DE0": { vendor: "MikroTik", type: "router" }, "E48D8C": { vendor: "MikroTik", type: "router" }, 
  "D4CA6D": { vendor: "MikroTik", type: "router" }, "6C3B6B": { vendor: "MikroTik", type: "router" }, 
  "744D28": { vendor: "MikroTik", type: "router" }, "B8FD32": { vendor: "MikroTik", type: "router" }, 
  "002590": { vendor: "MikroTik", type: "router" }, 

  "245A4C": { vendor: "Ubiquiti / UniFi", type: "ap" }, "248A07": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "DC9FDB": { vendor: "Ubiquiti / UniFi", type: "ap" }, "E063DA": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "F09FC2": { vendor: "Ubiquiti / UniFi", type: "ap" }, "FCECDA": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "B4FBE4": { vendor: "Ubiquiti / UniFi", type: "ap" }, "789A18": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "0418D6": { vendor: "Ubiquiti / UniFi", type: "ap" }, "44D9E7": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "4418FD": { vendor: "Ubiquiti / UniFi", type: "ap" }, "68725B": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "74ACB9": { vendor: "Ubiquiti / UniFi", type: "ap" }, "802AA8": { vendor: "Ubiquiti / UniFi", type: "ap" }, 
  "94181B": { vendor: "Ubiquiti / UniFi", type: "ap" }, "AC8BA9": { vendor: "Ubiquiti / UniFi", type: "ap" }, 

  "0026F2": { vendor: "TP-Link", type: "router" }, "F8D111": { vendor: "TP-Link", type: "router" }, 
  "C46E1F": { vendor: "TP-Link", type: "router" }, "50C7BF": { vendor: "TP-Link", type: "router" }, 
  "EC086B": { vendor: "TP-Link", type: "router" }, "847B57": { vendor: "TP-Link", type: "router" }, 
  "F4F26D": { vendor: "TP-Link", type: "router" }, "AC84C6": { vendor: "TP-Link", type: "router" }, 
  "98DAC4": { vendor: "TP-Link", type: "router" }, 

  "0014BF": { vendor: "Netgear", type: "router" }, "001E2A": { vendor: "Netgear", type: "router" }, 
"20E52A": { vendor: "Netgear", type: "router" }, 
  "9C3DCF": { vendor: "Netgear", type: "router" }, 

  "001F1F": { vendor: "Asus" }, "002618": { vendor: "Asus" }, "0023CD": { vendor: "Asus" }, 
  "1C872C": { vendor: "Asus" }, "AC9E17": { vendor: "Asus" }, "BCAEC5": { vendor: "Asus" }, 

  "00177B": { vendor: "D-Link", type: "router" }, 
  "001E58": { vendor: "D-Link", type: "router" }, 

  // ── Servers / NAS ──
  "001132": { vendor: "Synology", type: "server" }, "0011D8": { vendor: "Synology", type: "server" }, 
  "0011328": { vendor: "Synology", type: "server" },
  "245EBE": { vendor: "QNAP", type: "server" }, "00089B": { vendor: "QNAP", type: "server" }, 
  "0007C0": { vendor: "QNAP", type: "server" }, 

  // ── HP / Dell / Lenovo ──
  "001E0B": { vendor: "HP" }, "002264": { vendor: "HP" }, "00306E": { vendor: "HP" }, 
  "00148C": { vendor: "HP" }, "C4346B": { vendor: "HP" }, "9457A5": { vendor: "HP" }, 
  "00188B": { vendor: "Dell" }, "001D09": { vendor: "Dell" }, "00219B": { vendor: "Dell" }, 
  "002564": { vendor: "Dell" }, "00266C": { vendor: "Dell" }, "B8CA3A": { vendor: "Dell" }, 
  "C81F66": { vendor: "Dell" }, "F8B156": { vendor: "Dell" }, "84A938": { vendor: "Dell" }, 
"00216A": { vendor: "Lenovo" }, 
  "881FA1": { vendor: "Lenovo" }, "8CDCD4": { vendor: "Lenovo" }, 

  // ── IoT / Smart Home ──
  "EC1BBD": { vendor: "Espressif (ESP32)", type: "iot" }, "8CAAB5": { vendor: "Espressif (ESP32)", type: "iot" }, 
  "30AEA4": { vendor: "Espressif (ESP32)", type: "iot" }, "240AC4": { vendor: "Espressif (ESP32)", type: "iot" }, 
  "84F3EB": { vendor: "Espressif (ESP32)", type: "iot" }, "DC4F22": { vendor: "Espressif (ESP32)", type: "iot" }, 
  "807D3A": { vendor: "Espressif (ESP32)", type: "iot" }, "08B61F": { vendor: "Espressif (ESP32)", type: "iot" }, 
  "E09806": { vendor: "Espressif (ESP32)", type: "iot" }, "10521C": { vendor: "Espressif (ESP32)", type: "iot" }, 

  "00FC8B": { vendor: "Sonos" }, "B8E937": { vendor: "Sonos" }, 
  "44650D": { vendor: "Amazon (Alexa/Echo)", type: "iot" }, "44A56E": { vendor: "Amazon (Alexa/Echo)", type: "iot" }, 
  "F0272D": { vendor: "Amazon (Alexa/Echo)", type: "iot" }, "FCA667": { vendor: "Amazon (Alexa/Echo)", type: "iot" }, 
  "84D6D0": { vendor: "Amazon (Alexa/Echo)", type: "iot" }, 
  "D4A928": { vendor: "Sonoff", type: "iot" }, "BC4486": { vendor: "Sonoff", type: "iot" }, 
  "98F4AB": { vendor: "Tuya", type: "iot" }, "10A4BE": { vendor: "Tuya", type: "iot" }, 
  "8C53C3": { vendor: "Shelly", type: "iot" }, "98CDAC": { vendor: "Shelly", type: "iot" }, 

  // ── Printers ──

  "0017A4": { vendor: "Brother", type: "iot" }, "30055C": { vendor: "Brother", type: "iot" }, 
  "C49DEB": { vendor: "Canon", type: "iot" }, "002418": { vendor: "Epson", type: "iot" }, 

  // ── VMware / Virtualization ──
  "000C29": { vendor: "VMware", type: "server" }, "005056": { vendor: "VMware", type: "server" }, 
  "001C14": { vendor: "VMware", type: "server" }, 
  "525400": { vendor: "QEMU/KVM", type: "server" }, "080027": { vendor: "VirtualBox", type: "server" }, 
  "001321": { vendor: "Proxmox", type: "server" }, 
};

// Look up vendor & guessed type from MAC address
export function lookupMac(mac: string): OuiEntry | null {
  if (!mac) return null;
  const cleaned = mac.replace(/[:\-\.]/g, "").toUpperCase().slice(0, 6);
  return OUI[cleaned] || null;
}

// Optional: parse system OUI file if present (nmap-mac-prefixes lives at /usr/share/nmap/nmap-mac-prefixes on Debian)
let extendedCache: Record<string, string> | null = null;
function loadExtended(): Record<string, string> {
  if (extendedCache) return extendedCache;
  extendedCache = {};
  const paths = ["/usr/share/nmap/nmap-mac-prefixes", "/usr/share/ieee-data/oui.txt"];
  for (const p of paths) {
    try {
      const txt = fs.readFileSync(p, "utf8");
      for (const line of txt.split("\n")) {
        const m = line.match(/^([0-9A-F]{6})\s+(.+)$/i);
        if (m) extendedCache[m[1].toUpperCase()] = m[2].trim();
      }
      break;
    } catch { /* file not present, try next */ }
  }
  return extendedCache;
}

export function lookupMacExtended(mac: string): { vendor: string } | null {
  const direct = lookupMac(mac);
  if (direct) return direct;
  const ext = loadExtended();
  const cleaned = mac.replace(/[:\-\.]/g, "").toUpperCase().slice(0, 6);
  return ext[cleaned] ? { vendor: ext[cleaned] } : null;
}

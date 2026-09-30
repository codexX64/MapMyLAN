// Préfixes MAC (OUI) → fabricant, pour les constructeurs les plus courants.
// La table complète de nmap, quand l'image l'embarque, sert de repli.
import fs from 'node:fs';

const PAR_FABRICANT = {
  'Apple': ['001451', '0021E9', '002500', '0026B0', '002608', '002241', '0017F2', '001B63', '001D4F', '001E52', '001EC2', '001F5B', '001FF3',
    '00254B', '0024A8', '0026BB', '002332', '5C95AE', '049226', '0CBC9F', '1093E9', '201D03', '287AEE', '3C2EFF', 'F4F15A', 'F8FFC2', '1C36BB',
    '60C547', 'AC87A3', 'B8782E', 'DC2B61', 'F0DBE2', '8C2937'],
  'Samsung': ['002566', '0023D6', '001632', '001D25', '0023D7', '001247', '0024E9', '0021D2', '5440AD', '747548', '8425DB', 'B43A28', 'C0BDD1',
    'F0E77E', '08FC88', '1486D9', '20D390'],
  'Xiaomi': ['0C1DAF', '100D7F', '14F65A', '187C0A', '286C07', '342387', '50EC50', '640980', '8CBEBE', '98FAE3', 'A0C589', 'BCF685', 'F8A45F'],
  'Huawei': ['00259E', '001E10', '0025B3', '002568', 'F4DCF9', 'DC0EA1', 'C40528'],
  'Google': ['F4F5D8', '94EB2C', '70886B', '1C3947', '6466B3', 'A4DA22'],
  'Microsoft': ['7C1E52', 'C831CF', '60450C'],
  'Intel': ['001B21', '00216B', '001E64', 'F8C3D0', '98E743', 'B496A1', '0030D3', '001F3C'],
  'Cisco': ['002554', '001794', '0021A0', '0019AA', '001AA1', '0023AC', '0024F7', '0026CB', 'B8BE6F'],
  'Raspberry Pi': ['B827EB', 'DCA632', 'E45F01', 'D83ADD', '2CCF67'],
  'MikroTik': ['4C5E0C', 'B869F4', 'CC2DE0', 'E48D8C', 'D4CA6D', '6C3B6B', '744D28', 'B8FD32', '002590'],
  'Ubiquiti / UniFi': ['245A4C', '248A07', 'DC9FDB', 'E063DA', 'F09FC2', 'FCECDA', 'B4FBE4', '789A18', '0418D6', '44D9E7', '4418FD', '68725B',
    '74ACB9', '802AA8', '94181B', 'AC8BA9'],
  'TP-Link': ['0026F2', 'F8D111', 'C46E1F', '50C7BF', 'EC086B', '847B57', 'F4F26D', 'AC84C6', '98DAC4'],
  'Netgear': ['0014BF', '001E2A', '20E52A', '9C3DCF'],
  'Asus': ['001F1F', '002618', '0023CD', '1C872C', 'AC9E17', 'BCAEC5'],
  'D-Link': ['00177B', '001E58'],
  'Synology': ['001132', '0011D8'],
  'QNAP': ['245EBE', '00089B', '0007C0'],
  'HP': ['001E0B', '002264', '00306E', '00148C', 'C4346B', '9457A5'],
  'Dell': ['00188B', '001D09', '00219B', '002564', '00266C', 'B8CA3A', 'C81F66', 'F8B156', '84A938'],
  'Lenovo': ['00216A', '881FA1', '8CDCD4'],
  'Espressif (ESP32)': ['EC1BBD', '8CAAB5', '30AEA4', '240AC4', '84F3EB', 'DC4F22', '807D3A', '08B61F', 'E09806', '10521C'],
  'Sonos': ['00FC8B', 'B8E937'],
  'Amazon (Alexa/Echo)': ['44650D', '44A56E', 'F0272D', 'FCA667', '84D6D0'],
  'Sonoff': ['D4A928', 'BC4486'],
  'Tuya': ['98F4AB', '10A4BE'],
  'Shelly': ['8C53C3', '98CDAC'],
  'Brother': ['0017A4', '30055C'],
  'Canon': ['C49DEB'],
  'Epson': ['002418'],
  'VMware': ['000C29', '005056', '001C14'],
  'QEMU/KVM': ['525400'],
  'VirtualBox': ['080027'],
};

const OUI = new Map(Object.entries(PAR_FABRICANT).flatMap(([fabricant, prefixes]) => prefixes.map(p => [p, fabricant])));
const prefixe = mac => String(mac || '').replace(/[:.-]/g, '').toUpperCase().slice(0, 6);

let etendue = null;
function tableEtendue() {
  if (etendue) return etendue;
  etendue = new Map();
  for (const chemin of ['/usr/share/nmap/nmap-mac-prefixes', '/usr/share/ieee-data/oui.txt']) {
    let texte;
    try { texte = fs.readFileSync(chemin, 'utf8'); } catch { continue; }
    for (const ligne of texte.split('\n')) {
      const m = /^([0-9A-F]{6})\s+(.+)$/i.exec(ligne);
      if (m) etendue.set(m[1].toUpperCase(), m[2].trim().slice(0, 80));
    }
    break;
  }
  return etendue;
}

// Le fabricant d'une carte réseau, ou null.
export function fabricantDe(mac) {
  const p = prefixe(mac);
  if (p.length !== 6) return null;
  return OUI.get(p) || tableEtendue().get(p) || null;
}

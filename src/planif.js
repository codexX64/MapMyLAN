// Tâches de fond, en minuteries simples (un seul processus longue durée) :
// balayage périodique, notation et règles chaque minute, enrichissement,
// mesures de l'hôte, collecte du trafic, purges, et ce qui part vers SYNAPSE.
// Une tâche ne se chevauche jamais elle-même.
import { appliquerRegles } from './defense.js';
import { prendrePhoto } from './assistant/photo.js';
import { resumeEtat } from './assistant/index.js';

export class Planificateur {
  constructor(s) { this.s = s; this.minuteries = []; this.occupees = new Set(); this.derniereMesure = 0; }

  chaque(nom, ms, fn, { premier = ms } = {}) {
    const lancer = async () => {
      if (this.occupees.has(nom)) return;
      this.occupees.add(nom);
      try { await fn(); } catch (e) { this.s.evts.journaliser('error', 'scheduler', `${nom} : ${String(e.message).slice(0, 200)}`); } finally { this.occupees.delete(nom); }
    };
    const t0 = setTimeout(() => { lancer(); const t = setInterval(lancer, ms); t.unref(); this.minuteries.push(t); }, premier);
    t0.unref();
    this.minuteries.push(t0);
  }

  intervalleBalayage() {
    const r = Number(this.s.reglages.lire('scan.interval'));
    return Number.isInteger(r) && r >= 60 ? r : this.s.cfg.intervalle;
  }

  async cycleBalayage() {
    const { scanner, vlans, scores } = this.s;
    await scanner.toutBalayer();
    // Les VLAN déclarés sur l'équipement, relevés au même rythme : sans eux,
    // chaque appareil retomberait sur son sous-réseau faute de rattachement.
    // Un équipement muet est déjà rendu par relever() ; ce qui lève ici est
    // une panne à voir, qui n'arrête pas le cycle.
    await vlans.relever().catch(e => this.s.evts.journaliser('warn', 'vlan', `Relevé des VLAN en échec : ${String(e.message).slice(0, 160)}`));
    scores.toutNoter();
    await appliquerRegles(this.s);
  }

  demarrer() {
    const s = this.s;
    s.trafic.demarrer();
    if (this.intervalleBalayage() > 0) {
      // Le réglage est relu à chaque tour : le changer ne demande pas de redémarrer.
      const boucle = async () => {
        if (!this.occupees.has('balayage')) {
          this.occupees.add('balayage');
          try { await this.cycleBalayage(); } catch (e) { s.evts.journaliser('error', 'scheduler', `Cycle de balayage en échec : ${e.message}`); } finally { this.occupees.delete('balayage'); }
        }
        const t = setTimeout(boucle, this.intervalleBalayage() * 1000);
        t.unref(); this.minuteries.push(t);
      };
      const t = setTimeout(boucle, 8000);
      t.unref(); this.minuteries.push(t);
    }
    this.chaque('notation', 60_000, async () => { s.scores.toutNoter(); await appliquerRegles(s); });
    this.chaque('enrichissement', 120_000, () => s.enrichissement.tour(), { premier: 30_000 });
    this.chaque('mesures', 5000, async () => {
      const m = await s.hote.mesures();
      s.evts.emettre('host:metrics', m);
      if (Date.now() - this.derniereMesure > 60_000) { this.derniereMesure = Date.now(); s.hote.garder(m); }
    });
    this.chaque('purges', 3600e3, () => { s.trafic.purger(); s.evts.purger(); }, { premier: 120_000 });
    if (s.liaisons.synapsePrete) {
      this.chaque('synapse.fiche', 300_000, () => s.assistant.publier(), { premier: 15_000 });
      this.chaque('synapse.bilan', 3600e3, () => {
        const p = prendrePhoto(s);
        s.memoire.surBilan({
          titre: `Bilan du réseau : ${p.appareils.length} appareils, ${p.enLigne} en ligne, ${p.nonLues.length} alertes non lues, santé ${p.sante}/100`,
          corps: resumeEtat(p),
          empreinte: [p.appareils.length, p.enLigne, p.horsLigne.length, p.nonLues.length, p.sante, p.cves, p.bloques.length].join('|'),
        });
      }, { premier: 60_000 });
    }
  }

  arreter() { for (const t of this.minuteries) { clearTimeout(t); clearInterval(t); } this.minuteries = []; this.s.trafic.arreter(); }
}

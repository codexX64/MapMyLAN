// Lecture de l'historique du trafic.
//
// La collecte tourne côté serveur ; l'interface ne fait plus que lire. C'est ce
// qui permet à l'historique de continuer à se construire onglet fermé, et de
// survivre à un changement de page.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authRequired, requireRole } from "../middleware/auth";
import {
  etatCollecte, relancerCollecte, purger, tailleTableMo, cibleDeReleve, lignesSql,
} from "../services/trafic";

const router = Router();
router.use(authRequired);

const PORTS_WEB = new Set([80, 443, 8080, 8443, 8843, 8880]);

/**
 * Les flux, du plus récemment vu au plus ancien.
 *
 * `avant` permet de continuer la liste vers le passé : l'interface descend
 * ainsi dans l'historique sans tout charger d'un coup.
 */
const qFlux = z.object({
  // Le plafond était de mille. Un parc ordinaire garde plusieurs milliers de
  // flux sur trente jours : l'interface ne pouvait donc jamais tout montrer,
  // même en descendant la liste jusqu'au bout.
  limite: z.coerce.number().int().min(1).max(5000).default(300),
  avant: z.coerce.number().int().optional(),   // horodatage en millisecondes
  depuis: z.coerce.number().int().optional(),
  /** « sortant », « entrant », ou rien pour les deux. */
  sens: z.enum(["sortant", "entrant"]).optional(),
  /** Ne rendre que ce qui est signalé. */
  suspect: z.coerce.boolean().optional(),
});

router.get("/flows", async (req, res) => {
  const q = qFlux.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Paramètres invalides" });
  const { limite, avant, depuis, sens, suspect } = q.data;

  const conditions: string[] = [];
  const params: any[] = [];
  if (avant)  { params.push(new Date(avant));  conditions.push(`"lastSeen" < $${params.length}`); }
  if (depuis) { params.push(new Date(depuis)); conditions.push(`"lastSeen" > $${params.length}`); }
  if (sens)   { params.push(sens);             conditions.push(`"direction" = $${params.length}`); }
  if (suspect) conditions.push(`"suspect" = true`);
  params.push(limite);

  const flux = await lignesSql(
    `SELECT * FROM "TrafficFlow"
      ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""}
      ORDER BY "lastSeen" DESC LIMIT $${params.length}`,
    ...params,
  );

  res.json(flux.map((f) => ({
    id: f.id,
    src: f.srcIp, dst: f.dstIp, port: f.port, proto: f.proto,
    premier: new Date(f.firstSeen).getTime(), dernier: new Date(f.lastSeen).getTime(),
    octets: Number(f.bytes), paquets: Number(f.packets), vues: Number(f.hits),
    nom: f.host || undefined, domaine: f.domain || undefined,
    operateur: f.operator || undefined, logo: f.logo || undefined,
    paysRegistre: f.country || undefined,
    sens: f.direction || "sortant",
    suspect: f.suspect === true,
    raison: f.raison || undefined,
  })));
});

/**
 * Les totaux, calculés sur TOUT ce qui est conservé.
 *
 * Le bandeau les calculait à partir des lignes chargées par le navigateur :
 * il affichait donc « 1000 destinations » tant qu'on n'avait pas descendu la
 * liste jusqu'au bout, et « 2442 » une fois en bas. Un compteur qui change
 * parce qu'on a scrollé ne compte rien.
 *
 * Une ligne par destination — pas une par flux : c'est ce que le bandeau et le
 * panneau de droite décrivent. Mille sept cents destinations tiennent dans
 * quelques dizaines de kilo-octets.
 */
router.get("/aggregats", async (req, res) => {
  // Fenêtre de temps demandée par l'interface, en millisecondes depuis
  // l'époque. Sans elle, on décrit tout ce qui est conservé.
  const depuis = Number(req.query.depuis);
  const borne = Number.isFinite(depuis) && depuis > 0 ? new Date(depuis) : null;
  const filtre = borne ? `WHERE "lastSeen" > $1` : "";
  const args = borne ? [borne] : [];

  const [compte, destinations, appareils] = await Promise.all([
    lignesSql(`SELECT COUNT(*)::int AS n FROM "TrafficFlow" ${filtre}`, ...args),
    lignesSql(
      `SELECT "dstIp"                       AS dst,
              MAX("host")                   AS nom,
              MAX("domain")                 AS domaine,
              MAX("operator")               AS operateur,
              MAX("logo")                   AS logo,
              MAX("country")                AS pays,
              MAX("direction")              AS sens,
              BOOL_OR("suspect")            AS suspect,
              SUM("bytes")::bigint          AS octets,
              MAX("lastSeen")               AS dernier
         FROM "TrafficFlow"
         ${filtre}
        GROUP BY "dstIp"
        ORDER BY SUM("bytes") DESC
        LIMIT 5000`, ...args),
    lignesSql(
      `SELECT "srcIp" AS src, SUM("bytes")::bigint AS octets
         FROM "TrafficFlow"
         ${filtre}
        GROUP BY "srcIp"
        ORDER BY SUM("bytes") DESC
        LIMIT 300`, ...args),
  ]);

  res.json({
    connexions: Number(compte?.[0]?.n || 0),
    destinations: destinations.map((d) => ({
      dst: d.dst, nom: d.nom || undefined, domaine: d.domaine || undefined,
      operateur: d.operateur || undefined, logo: d.logo || undefined,
      paysRegistre: d.pays || undefined, sens: d.sens || "sortant",
      suspect: d.suspect === true,
      octets: Number(d.octets || 0),
      dernier: d.dernier ? new Date(d.dernier).getTime() : 0,
    })),
    appareils: appareils.map((a) => ({ src: a.src, octets: Number(a.octets || 0) })),
  });
});

/** De quoi afficher l'en-tête : équipement, dernier relevé, taille conservée. */
router.get("/state", async (_req, res) => {
  const [compte, mo, cible] = await Promise.all([
    lignesSql(`SELECT COUNT(*)::int AS n FROM "TrafficFlow"`),
    tailleTableMo(),
    cibleDeReleve(),
  ]);
  const total = Number(compte?.[0]?.n || 0);
  const [signales, entrants] = await Promise.all([
    lignesSql(`SELECT COUNT(*)::int AS n FROM "TrafficFlow" WHERE "suspect" = true`),
    lignesSql(`SELECT COUNT(*)::int AS n FROM "TrafficFlow" WHERE "direction" = 'entrant'`),
  ]);
  const [reglages, ancien] = await Promise.all([
    prisma.setting.findMany({ where: { key: { in: ["world.retentionDays", "world.retentionMaxMb"] } } }),
    lignesSql(`SELECT MIN("lastSeen") AS d FROM "TrafficFlow"`),
  ]);
  const plusAncien = ancien?.[0]?.d ? new Date(ancien[0].d) : null;
  const r: Record<string, any> = {};
  for (const s of reglages) r[s.key] = s.value;

  // Les entrées enregistrées mais inutilisables sont nommées : sans cela, une
  // page vide n'explique pas pourquoi elle l'est.
  const toutes = await prisma.sshDevice.findMany({
    select: { id: true, name: true, host: true, port: true, transport: true },
  });

  res.json({
    ...etatCollecte(),
    cible: cible ? { id: cible.id, nom: cible.name, hote: cible.host, port: cible.port } : null,
    ecartees: toutes
      .filter((d) => d.transport === "api" || PORTS_WEB.has(d.port))
      .map((d) => ({
        id: d.id, nom: d.name, hote: d.host, port: d.port,
        transport: d.transport === "api" ? "api" : "ssh",
      })),
    total,
    signales: Number(signales?.[0]?.n || 0),
    entrants: Number(entrants?.[0]?.n || 0),
    tailleMo: Number(mo.toFixed(2)),
    plusAncien: plusAncien ? plusAncien.getTime() : null,
    retentionJours: Number(r["world.retentionDays"] ?? 30),
    retentionMaxMo: Number(r["world.retentionMaxMb"] ?? 0),
  });
});

/** Relance immédiate, sans attendre le prochain tour. */
router.post("/collect", requireRole("admin", "operator"), async (_req, res) => {
  res.json(await relancerCollecte());
});

/** Purge manuelle, avec les mêmes règles que la purge automatique. */
router.post("/purge", requireRole("admin"), async (_req, res) => {
  res.json(await purger());
});

/** Effacement complet de l'historique, à la demande explicite. */
router.delete("/flows", requireRole("admin"), async (_req, res) => {
  const n = Number(await prisma.$executeRawUnsafe(`DELETE FROM "TrafficFlow"`).catch(() => 0));
  await prisma.$executeRawUnsafe(`VACUUM "TrafficFlow"`).catch(() => {});
  res.json({ supprimes: n });
});

export default router;

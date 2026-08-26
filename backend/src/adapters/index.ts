// Registre des adaptateurs et résolution de l'équipement principal.

import { prisma } from "../db";
import { decrypt } from "../services/crypto";
import { executeOnDevice, executeWith, testConnection } from "../services/ssh";
import { ValeurRefusee } from "../services/valider";

/**
 * Dernier rempart avant l'exécution.
 *
 * Toutes les commandes des pilotes passent par `exec`. Y placer le contrôle
 * couvre toutes les actions d'un coup, là où le poser dans chaque pilote
 * laisserait passer celui qu'on oublie — et c'est toujours celui-là qui sert.
 *
 * Le contrôle est volontairement grossier : on ne cherche pas à comprendre la
 * commande, seulement à constater qu'elle ne contient aucun des caractères par
 * lesquels on en enchaîne une seconde. Les pilotes n'en produisent aucune.
 */
const ENCHAINEMENT = /[;&|`$\n\r<>]|\$\(|\|\|/;

export function gardeCommande(command: string): string {
  if (typeof command !== "string" || !command.length) throw new ValeurRefusee("Commande", command);
  if (command.length > 4096) throw new ValeurRefusee("Commande — trop longue", command.length);
  if (ENCHAINEMENT.test(command)) throw new ValeurRefusee("Commande — enchaînement refusé", command);
  return command;
}
import { RouterAdapter, AdapterContext, RouterCreds, Capability } from "./types";
import { SSH_ADAPTERS } from "./ssh-drivers";
import { unifi } from "./unifi";

export const ADAPTERS: RouterAdapter[] = [unifi, ...SSH_ADAPTERS];

export function getAdapter(id?: string | null): RouterAdapter {
  const found = ADAPTERS.find(a => a.id === id);
  if (found) return found;
  // Anciennes valeurs enregistrées avant la couche adaptateurs
  const legacy: Record<string, string> = {
    asus: "asus-merlin", merlin: "asus-merlin", mikrotik: "routeros",
    cisco: "cisco-ios", opnsense: "pfsense", ubiquiti: "unifi",
  };
  return ADAPTERS.find(a => a.id === legacy[String(id).toLowerCase()])
      || ADAPTERS.find(a => a.id === "generic")!;
}

/** Reconnaît le constructeur à partir d'une bannière SSH ou d'une réponse HTTP. */
export function detectAdapter(probe: string): RouterAdapter | null {
  return ADAPTERS.find(a => a.detect?.(probe)) || null;
}

export function capabilitiesOf(id?: string | null): Capability[] {
  return getAdapter(id).capabilities;
}

/** Déchiffre les identifiants stockés et construit le contexte d'exécution. */
export function contextFor(row: any): AdapterContext {
  const creds: RouterCreds = {
    host: row.host,
    port: row.port || 22,
    username: row.username,
    password: row.passwordEnc ? decrypt(row.passwordEnc) : undefined,
    privateKey: row.privateKeyEnc ? decrypt(row.privateKeyEnc) : undefined,
    passphrase: row.passphraseEnc ? decrypt(row.passphraseEnc) : undefined,
    transport: (row.transport as any) || "ssh",
    apiBaseUrl: row.apiBaseUrl || undefined,
    site: row.site || undefined,
    verifyTls: row.verifyTls === true,
  };
  return {
    creds,
    exec: (command: string) => executeOnDevice(row.id, gardeCommande(command)),
  };
}

export async function mainRouterRow(): Promise<any | null> {
  return prisma.sshDevice.findFirst({ where: { isMainRouter: true } });
}

/** Adaptateur + contexte de l'équipement principal, ou une erreur explicite. */
export async function mainRouter(): Promise<{ row: any; adapter: RouterAdapter; ctx: AdapterContext }> {
  const row = await mainRouterRow();
  if (!row) throw new Error("Aucun équipement principal configuré — allez dans Routeur pour en ajouter un.");
  return { row, adapter: getAdapter(row.vendor), ctx: contextFor(row) };
}

/** Sonde SSH utilisée par la reconnaissance automatique. */
/** Contexte pour une configuration pas encore enregistrée en base. */
export function contextForCreds(creds: RouterCreds): AdapterContext {
  return {
    creds,
    exec: (command: string) => executeWith({
      host: creds.host, port: creds.port, username: creds.username,
      password: creds.password, privateKey: creds.privateKey, passphrase: creds.passphrase,
    }, gardeCommande(command)),
  };
}

export async function probeSsh(creds: RouterCreds): Promise<string> {
  const r = await testConnection({
    host: creds.host, port: creds.port, username: creds.username,
    password: creds.password, privateKey: creds.privateKey, passphrase: creds.passphrase,
  } as any);
  return [r.banner, r.error].filter(Boolean).join(" ");
}

export * from "./types";

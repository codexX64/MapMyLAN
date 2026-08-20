// Password hashing.
//
// Argon2id, winner of the Password Hashing Competition and OWASP's current
// recommendation. It resists both side-channel attacks (thanks to its
// data-independent first pass) and dedicated-hardware attacks (thanks to its
// memory cost), which bcrypt does not: bcrypt fits in 4 KiB, which makes it
// massively parallelizable on GPUs.
//
// Three principles govern this module:
//
//   1. Existing bcrypt hashes remain verifiable, and are silently re-encoded
//      as Argon2id on the first successful login. Nobody loses access, and the
//      fleet migrates on its own.
//
//   2. Verification takes a comparable amount of time whether or not the
//      account exists. Without this, an attacker distinguishes "unknown login"
//      from "wrong password" by the clock, and enumerates accounts.
//
//   3. An optional pepper, drawn from the environment, is added to the salt. A
//      database stolen without the pepper can't be cracked offline.

import { createHmac, timingSafeEqual } from "crypto";
import { hash as argonHash, verify as argonVerify, Algorithm, Version } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

// ── Parameters ─────────────────────────────────────────────────────────────
//
// The memory cost is the main lever against hardware attacks. 32 MiB per
// verification stops GPU use dead, while staying manageable on a modest
// machine: login takes a fraction of a second.
//
// Raising it further would backfire: each login attempt reserves that memory,
// and an attacker hammering the endpoint would exhaust the machine. It's the
// attempt limiter that makes this choice safe — the two go together.
export const PARAMS = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 32768,   // 32 MiB
  timeCost: 3,         // 3 passes
  parallelism: 1,      // a single thread: memory is already the limiting factor
  outputLen: 32,
} as const;

/** Reference hash, used to equalize response times. */
let LEURRE: string | null = null;

/**
 * Optional pepper.
 *
 * Unlike the salt, which is public and stored with the hash, the pepper lives
 * outside the database — in an environment variable, ideally in a secrets
 * manager. A database exfiltrated on its own becomes unusable.
 *
 * It is applied as an HMAC before hashing rather than concatenated, to avoid
 * length-extension attacks and bcrypt's 72-byte ceiling.
 */
function poivrer(motDePasse: string): string {
  const poivre = process.env.PASSWORD_PEPPER;
  if (!poivre) return motDePasse;
  return createHmac("sha256", poivre).update(motDePasse, "utf8").digest("base64");
}

/** Recognizes a bcrypt hash by its prefix. */
function estBcrypt(empreinte: string): boolean {
  return /^\$2[aby]\$/.test(empreinte);
}

/** Recognizes an Argon2id hash. */
function estArgon2id(empreinte: string): boolean {
  return empreinte.startsWith("$argon2id$");
}

/**
 * Is the hash behind the current parameters?
 *
 * Used to progressively re-encode the fleet when the settings are hardened,
 * without asking anyone to change their password.
 */
export function aRechiffrer(empreinte: string): boolean {
  if (!empreinte) return true;
  if (!estArgon2id(empreinte)) return true;      // bcrypt, or unknown format

  const m = /\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(empreinte);
  if (!m) return true;
  const [, v, mem, t, p] = m.map(Number);
  return v < 19
      || mem < PARAMS.memoryCost
      || t < PARAMS.timeCost
      || p < PARAMS.parallelism;
}

/** Produces an Argon2id hash. */
export async function hacher(motDePasse: string): Promise<string> {
  if (typeof motDePasse !== "string" || motDePasse.length === 0) {
    throw new Error("Empty password.");
  }
  // Argon2 doesn't have bcrypt's 72-byte limit, but we bound it anyway: a
  // one-megabyte string would serve to saturate the CPU.
  if (Buffer.byteLength(motDePasse, "utf8") > 4096) {
    throw new Error("Password excessively long.");
  }
  return argonHash(poivrer(motDePasse), PARAMS);
}

export interface ResultatVerification {
  /** The password matches. */
  ok: boolean;
  /** The hash must be rewritten: it's bcrypt, or out of date. */
  aMettreAJour: boolean;
  /** New hash to store, if an update is required. */
  nouvelleEmpreinte?: string;
}

/**
 * Verifies a password against a hash, whatever its algorithm.
 *
 * When the hash is bcrypt and the password is correct, an Argon2id hash is
 * computed and returned: the caller only has to write it to the database. This
 * is what enables migration without interruption.
 */
export async function verifier(
  motDePasse: string,
  empreinte: string | null | undefined,
): Promise<ResultatVerification> {
  // Nonexistent account or one without a hash: we still perform an
  // equivalent-cost computation, otherwise the response comes back instantly
  // and betrays the absence of the account.
  if (!empreinte) {
    await consommerTempsEquivalent();
    return { ok: false, aMettreAJour: false };
  }

  const poivre = poivrer(motDePasse);

  if (estArgon2id(empreinte)) {
    let ok = false;
    try {
      ok = await argonVerify(empreinte, poivre);
    } catch {
      ok = false;                                // corrupted hash
    }
    if (!ok) return { ok: false, aMettreAJour: false };
    if (aRechiffrer(empreinte)) {
      return { ok: true, aMettreAJour: true, nouvelleEmpreinte: await hacher(motDePasse) };
    }
    return { ok: true, aMettreAJour: false };
  }

  if (estBcrypt(empreinte)) {
    // Historically: bcrypt was applied to the raw password, without a pepper.
    // So we verify against the original value, then re-encode with the pepper.
    const ok = await bcrypt.compare(motDePasse, empreinte).catch(() => false);
    if (!ok) return { ok: false, aMettreAJour: false };
    return { ok: true, aMettreAJour: true, nouvelleEmpreinte: await hacher(motDePasse) };
  }

  // Unknown format: we refuse rather than guess.
  await consommerTempsEquivalent();
  return { ok: false, aMettreAJour: false };
}

/**
 * Consumes a time comparable to a real verification.
 *
 * We compute the hash of a fixed value once, then verify it against a value
 * that is always wrong. The cost is that of a genuine verification, which
 * flattens the timing difference between a known account and an unknown one.
 */
async function consommerTempsEquivalent(): Promise<void> {
  if (!LEURRE) LEURRE = await argonHash("00000000000000000000000000000000", PARAMS);
  try {
    await argonVerify(LEURRE, "valeur systematiquement fausse");
  } catch {
    /* no effect: only the elapsed time matters */
  }
}

/**
 * Prepares the decoy at startup.
 *
 * Without this precaution, the very first attempt against a nonexistent
 * account would be slower than the following ones, which would constitute a
 * signal.
 */
export async function prechauffer(): Promise<void> {
  await consommerTempsEquivalent();
}

/**
 * Compares two strings in constant time.
 *
 * For tokens, access keys and one-time codes: a `===` comparison stops at the
 * first differing byte, which leaks the correct prefix by the clock.
 */
export function egalConstant(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  // timingSafeEqual requires identical lengths. We hash first, which
  // uniformizes the size without revealing the secret's real length.
  const ha = createHmac("sha256", "comparaison").update(ba).digest();
  const hb = createHmac("sha256", "comparaison").update(bb).digest();
  return timingSafeEqual(ha, hb);
}

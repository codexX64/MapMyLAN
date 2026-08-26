import { describe, it, expect } from "vitest";
import { encrypt, decrypt, encryptJSON, decryptJSON } from "./crypto";

// Device credentials (SSH passwords, private keys) are stored with this. The
// round-trip must hold, and a tampered ciphertext must fail rather than decrypt
// to garbage — that is the whole point of the GCM auth tag.

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a string", () => {
    const secret = "s3cr3t-router-password";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("round-trips JSON", () => {
    const obj = { host: "10.0.0.1", port: 22 };
    expect(decryptJSON(encryptJSON(obj))).toEqual(obj);
  });

  it("rejects a tampered ciphertext", () => {
    const payload = encrypt("do-not-tamper");
    const buf = Buffer.from(payload, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });
});

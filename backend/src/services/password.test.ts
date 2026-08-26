import { describe, it, expect } from "vitest";
import { hacher, verifier, egalConstant, aRechiffrer } from "./password";

// The login path depends on these. A correct password must verify, a wrong one
// must not, and the constant-time compare must not regress into ===.

describe("password hashing (Argon2id)", () => {
  it("verifies a correct password", async () => {
    const hash = await hacher("correct horse battery staple");
    const r = await verifier("correct horse battery staple", hash);
    expect(r.ok).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hacher("correct horse battery staple");
    const r = await verifier("wrong password", hash);
    expect(r.ok).toBe(false);
  });

  it("reports no rehash needed for a fresh Argon2id hash", async () => {
    const hash = await hacher("something");
    expect(aRechiffrer(hash)).toBe(false);
  });

  it("flags an absent hash for rehash and refuses to verify against it", async () => {
    const r = await verifier("anything", null);
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long password rather than burning CPU", async () => {
    await expect(hacher("x".repeat(5000))).rejects.toThrow();
  });
});

describe("egalConstant", () => {
  it("returns true for equal strings", () => {
    expect(egalConstant("token-abc", "token-abc")).toBe(true);
  });
  it("returns false for different strings", () => {
    expect(egalConstant("token-abc", "token-abd")).toBe(false);
    expect(egalConstant("short", "a-much-longer-value")).toBe(false);
  });
});

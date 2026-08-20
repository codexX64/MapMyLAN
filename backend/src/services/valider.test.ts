import { describe, it, expect } from "vitest";
import {
  estIPv4, estIP, estMAC, estCIDR, estPort,
  exigerIP, validerCible, nettoyerNom, ValeurRefusee,
} from "./valider";

// These validators are the gate in front of every shell command the scanner and
// the defense adapters build. A regression here silently reopens command
// injection, so the injection payloads below must stay rejected.

describe("estIPv4", () => {
  it("accepts a well-formed address", () => {
    expect(estIPv4("192.168.1.10")).toBe(true);
    expect(estIPv4("10.0.0.5")).toBe(true);
  });
  it("rejects a shell-injection payload", () => {
    expect(estIPv4("1.2.3.4; rm -rf /")).toBe(false);
    expect(estIPv4("1.2.3.4 -j ACCEPT")).toBe(false);
    expect(estIPv4("$(reboot)")).toBe(false);
  });
  it("rejects leading zeros and out-of-range octets", () => {
    expect(estIPv4("01.2.3.4")).toBe(false);
    expect(estIPv4("256.1.1.1")).toBe(false);
  });
});

describe("estIP / estMAC / estCIDR / estPort", () => {
  it("accepts valid IPv6", () => {
    expect(estIP("fe80::1")).toBe(true);
    expect(estIP("2001:db8::ff00:42:8329")).toBe(true);
  });
  it("validates MAC addresses", () => {
    expect(estMAC("AA:BB:CC:DD:EE:FF")).toBe(true);
    expect(estMAC("aa-bb-cc-dd-ee-ff")).toBe(true);
    expect(estMAC("zz:bb:cc:dd:ee:ff")).toBe(false);
  });
  it("validates CIDR ranges", () => {
    expect(estCIDR("192.168.1.0/24")).toBe(true);
    expect(estCIDR("10.0.0.0/8")).toBe(true);
    expect(estCIDR("10.0.0.0/33")).toBe(false);
    expect(estCIDR("$(reboot)")).toBe(false);
  });
  it("validates ports", () => {
    expect(estPort(22)).toBe(true);
    expect(estPort(70000)).toBe(false);
    expect(estPort(0)).toBe(false);
  });
});

describe("exigerIP", () => {
  it("returns the address when valid", () => {
    expect(exigerIP("10.0.0.5")).toBe("10.0.0.5");
  });
  it("throws ValeurRefusee on an invalid address", () => {
    expect(() => exigerIP("1.2.3.4; echo pwned")).toThrow(ValeurRefusee);
  });
});

describe("validerCible", () => {
  it("normalises a valid target", () => {
    const t = validerCible({ ip: "10.0.0.5", mac: "aa:bb:cc:dd:ee:ff" });
    expect(t).toEqual({ ip: "10.0.0.5", mac: "AA:BB:CC:DD:EE:FF" });
  });
  it("rejects a target whose IP is malformed", () => {
    expect(() => validerCible({ ip: "10.0.0.5 && curl evil" })).toThrow(ValeurRefusee);
  });
});

describe("nettoyerNom", () => {
  it("strips control characters used for log injection", () => {
    expect(nettoyerNom("host\r\nInjected")).toBe("hostInjected");
  });
  it("caps the length", () => {
    expect(nettoyerNom("a".repeat(200)).length).toBeLessThanOrEqual(63);
  });
});

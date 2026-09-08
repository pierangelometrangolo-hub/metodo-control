import { describe, expect, it } from "vitest";
import { sha256Hex } from "../hashing";

describe("sha256Hex", () => {
  it("stringa vuota produce l'hash SHA-256 noto (vettore di test standard)", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("stessa stringa -> stesso hash (determinismo)", async () => {
    const a = await sha256Hex("contenuto identico");
    const b = await sha256Hex("contenuto identico");
    expect(a).toBe(b);
  });

  it("contenuto diverso -> hash diverso", async () => {
    const a = await sha256Hex("contenuto A");
    const b = await sha256Hex("contenuto B");
    expect(a).not.toBe(b);
  });

  it("stringa e ArrayBuffer con lo stesso contenuto UTF-8 producono lo stesso hash", async () => {
    const text = "€ 1.024,92 - Palazzo Rollo";
    const buffer = new TextEncoder().encode(text).buffer;
    expect(await sha256Hex(text)).toBe(await sha256Hex(buffer));
  });

  it("output sempre 64 caratteri esadecimali minuscoli", async () => {
    const hash = await sha256Hex("qualunque contenuto");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

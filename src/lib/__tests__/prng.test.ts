/**
 * PCG32 against the reference implementation's PUBLISHED output: pcg-c test-high/expected/check-pcg32.out
 * (github.com/imneme/pcg-c, Apache-2.0), copied verbatim to fixtures/pcg32-check.out. Seed 42, stream 54; each round
 * prints six 32-bit values, then rewinds six steps and prints them "Again" (so the stream continues from after the
 * six), then 65 coin tosses (bounded 2), 33 dice rolls (bounded 6, + 1) and a Fisher–Yates shuffle of 52 cards
 * (bounded 52 … 2). The last three pin pcg32_boundedrand_r, the unbiased bounded-integer method the bootstrap uses.
 */
import * as fs from "fs";
import * as path from "path";
import { Pcg32, PCG_STREAM } from "../prng";

interface Round {
  u32: number[];
  coins: string;
  rolls: number[];
  cards: string[];
}

function parseReference(): Round[] {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "pcg32-check.out"), "utf8").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\nRound \d+:\n/).slice(1);
  return blocks.map((b) => {
    const u32 = /32bit:([^\n]*)/.exec(b)![1].trim().split(/\s+/).map((h) => parseInt(h, 16));
    const again = /Again:([^\n]*)/.exec(b)![1].trim().split(/\s+/).map((h) => parseInt(h, 16));
    expect(again).toEqual(u32);
    const coins = /Coins:\s*([HT]+)/.exec(b)![1];
    const rolls = /Rolls:([^\n]*)/.exec(b)![1].trim().split(/\s+/).map(Number);
    const cardsText = /Cards:([\s\S]*)$/.exec(b)![1];
    const cards = cardsText.trim().split(/\s+/).filter((c) => /^[A2-9TJQK][hcds]$/.test(c));
    return { u32, coins, rolls, cards };
  });
}

describe("PCG32 matches the reference implementation's published output (check-pcg32.out)", () => {
  const ref = parseReference();
  it("has five rounds in the reference file", () => {
    expect(ref).toHaveLength(5);
    expect(ref[0].u32).toEqual([0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]);
    for (const r of ref) {
      expect(r.coins).toHaveLength(65);
      expect(r.rolls).toHaveLength(33);
      expect(r.cards).toHaveLength(52);
    }
  });

  it("reproduces every value, coin, roll and card of all five rounds (seed 42, stream 54)", () => {
    expect(PCG_STREAM).toBe(54);
    const rng = new Pcg32(42);
    const number = "A23456789TJQK";
    const suit = "hcds";
    for (const r of ref) {
      const u32: number[] = [];
      for (let i = 0; i < 6; i++) u32.push(rng.nextU32());
      expect(u32).toEqual(r.u32);
      let coins = "";
      for (let i = 0; i < 65; i++) coins += rng.bounded(2) ? "H" : "T";
      expect(coins).toBe(r.coins);
      const rolls: number[] = [];
      for (let i = 0; i < 33; i++) rolls.push(rng.bounded(6) + 1);
      expect(rolls).toEqual(r.rolls);
      const cards = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 52; i > 1; i--) {
        const chosen = rng.bounded(i);
        const card = cards[chosen];
        cards[chosen] = cards[i - 1];
        cards[i - 1] = card;
      }
      expect(cards.map((c) => number[Math.floor(c / 4)] + suit[c % 4])).toEqual(r.cards);
    }
  });
});

describe("PCG32 seeding and bounds", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = new Pcg32(12345);
    const b = new Pcg32(12345);
    const c = new Pcg32(12346);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    expect(Array.from({ length: 8 }, () => b.nextU32())).toEqual(sa);
    expect(Array.from({ length: 8 }, () => c.nextU32())).not.toEqual(sa);
  });

  it("accepts seeds above 2³² (the state initializer is 64-bit) and refuses non-integers", () => {
    const big = new Pcg32(2 ** 40 + 7);
    const small = new Pcg32(7);
    expect(big.nextU32()).not.toBe(small.nextU32());
    expect(() => new Pcg32(-1)).toThrow(RangeError);
    expect(() => new Pcg32(1.5)).toThrow(RangeError);
    expect(() => new Pcg32(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => new Pcg32(NaN)).toThrow(RangeError);
  });

  it("bounded() covers 0 … bound − 1 evenly and refuses a bad bound", () => {
    const rng = new Pcg32(1);
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < 70000; i++) counts[rng.bounded(7)]++;
    for (const k of counts) expect(Math.abs(k - 10000)).toBeLessThan(500);
    expect(rng.bounded(1)).toBe(0);
    const r2 = rng.bounded(2 ** 31 + 1); // the worst case for rejection (almost half the range is rejected)
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r2).toBeLessThan(2 ** 31 + 1);
    expect(() => rng.bounded(0)).toThrow(RangeError);
    expect(() => rng.bounded(2.5)).toThrow(RangeError);
    expect(() => rng.bounded(2 ** 32 + 1)).toThrow(RangeError);
  });
});

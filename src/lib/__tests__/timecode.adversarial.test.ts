// Adversarial pins for timecode.ts: every drop-frame boundary minute (and the
// tenth-minute exception), 24-hour wrap, negative times, fractional rates, and
// time bounds on pathological input. The validity oracle is the ST 12-1 rule
// implemented INDEPENDENTLY here (a label counter that skips), never the
// Python `timecode` library (which accepts the non-existent 00:01:00;00).
import {
  tcToFrames,
  framesToTc,
  tcDuration,
  realTimeOf,
  parseRate,
  parseTimecode,
  driftFigure,
  ratFromDecimalString,
  ratFromNumber,
  ratCmp,
  rat,
  ratToNumber,
} from "../timecode";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};
const err = (r: { ok: boolean; error?: string }): string => {
  if (r.ok) throw new Error("expected a refusal");
  return (r as { error: string }).error;
};
const p2 = (n: number) => String(n).padStart(2, "0");
const lab = (h: number, m: number, s: number, f: number, df: boolean) => `${p2(h)}:${p2(m)}:${p2(s)}${df ? ";" : ":"}${p2(f)}`;

/** Independent: frames before minute tm, by summing labels per minute. */
function framesBeforeMinute(tm: number, N: number, D: number): number {
  let n = 0;
  for (let i = 0; i < tm; i++) n += i % 10 === 0 ? 60 * N : 60 * N - D;
  return n;
}

/** Independent: a label counter that skips dropped labels, from a starting label. */
function* labelCounter(N: number, D: number, start: [number, number, number, number]) {
  let [h, m, s, f] = start;
  for (;;) {
    yield [h, m, s, f] as const;
    f++;
    if (f === N) {
      f = 0;
      s++;
      if (s === 60) {
        s = 0;
        m++;
        if (m === 60) {
          m = 0;
          h = (h + 1) % 24;
        }
      }
    }
    if (D && s === 0 && f === 0 && m % 10 !== 0) f = D;
  }
}

describe.each([
  ["29.97", 30, 2],
  ["59.94", 60, 4],
])("drop-frame at %s — every boundary minute of the day", (rateId, N, D) => {
  it("all 1440 minutes: first label, dropped labels refused, neighbours exact", () => {
    const R = ok(parseRate(rateId));
    const bad: string[] = [];
    const want = (cond: boolean, what: string) => {
      if (!cond) bad.push(what);
    };
    let firstLabelsKept = 0;
    for (let tm = 0; tm < 1440; tm++) {
      const h = Math.floor(tm / 60);
      const m = tm % 60;
      const start = framesBeforeMinute(tm, N, D);
      const first = m % 10 === 0 ? 0 : D; // the tenth-minute exception: ;00 exists
      if (first === 0) firstLabelsKept++;
      for (let f = 0; f < first; f++) {
        const r = tcToFrames(lab(h, m, 0, f, true), R, true);
        want(!r.ok && /does not exist/.test(r.error) && r.error.includes(lab(h, m, 0, D, true)), `refuse ${lab(h, m, 0, f, true)}`);
      }
      const a = tcToFrames(lab(h, m, 0, first, true), R, true);
      want(a.ok && a.frames === start, `first ${lab(h, m, 0, first, true)}`);
      const b = framesToTc(start, R, true);
      want(b.ok && b.label === lab(h, m, 0, first, true), `label of ${start}`);
      if (tm > 0) {
        const prev = lab(Math.floor((tm - 1) / 60), (tm - 1) % 60, 59, N - 1, true);
        const c = framesToTc(start - 1, R, true);
        want(c.ok && c.label === prev, `label of ${start - 1}`);
        const d = tcToFrames(prev, R, true);
        want(d.ok && d.frames === start - 1, `frames of ${prev}`);
      }
      if (bad.length > 5) break;
    }
    expect(bad).toEqual([]);
    expect(firstLabelsKept).toBe(144);
  });

  it("the first 12 minutes, every frame, match an independent skipping counter both ways", () => {
    const gen = labelCounter(N, D, [0, 0, 0, 0]);
    const total = framesBeforeMinute(12, N, D);
    const R = ok(parseRate(rateId));
    const bad: string[] = [];
    for (let n = 0; n < total; n++) {
      const [h, m, s, f] = gen.next().value as readonly [number, number, number, number];
      const L = lab(h, m, s, f, true);
      const a = framesToTc(n, R, true);
      const b = tcToFrames(L, R, true);
      if (!a.ok || a.label !== L || !b.ok || b.frames !== n) bad.push(`${n} ${L}`);
      if (bad.length > 5) break;
    }
    expect(bad).toEqual([]);
  });

  it("the last 3 minutes of the day and the wrap at midnight", () => {
    const dayStart = framesBeforeMinute(1437, N, D);
    const perDay = framesBeforeMinute(1440, N, D);
    const gen = labelCounter(N, D, [23, 57, 0, D]);
    const R = ok(parseRate(rateId));
    const bad: number[] = [];
    for (let n = dayStart; n < perDay; n++) {
      const [h, m, s, f] = gen.next().value as readonly [number, number, number, number];
      const r = framesToTc(n, R, true);
      if (!r.ok || r.label !== lab(h, m, s, f, true)) bad.push(n);
      if (bad.length > 5) break;
    }
    expect(bad).toEqual([]);
    const last = ok(tcToFrames(lab(23, 59, 59, N - 1, true), rateId));
    expect(last.frames).toBe(perDay - 1);
    const wrap = ok(framesToTc(perDay, rateId, true));
    expect(wrap.label).toBe(lab(0, 0, 0, 0, true));
    expect(wrap.dayOffset).toBe(1);
    expect(wrap.notes.join(" ")).toMatch(/WRAPS/);
  });
});

describe("24-hour wrap and negative times", () => {
  it("frame −1 wraps to the last label of the previous day, flagged", () => {
    const r = ok(framesToTc(-1, "29.97", true));
    expect(r.label).toBe("23:59:59;29");
    expect(r.dayOffset).toBe(-1);
    expect(r.notes.join(" ")).toMatch(/before one 24-hour timecode day/);
  });

  it("a count several days out wraps and reports the day", () => {
    const r = ok(framesToTc(3 * 2160000 + 25, 25));
    expect(r.label).toBe("00:00:01:00");
    expect(r.dayOffset).toBe(3);
  });

  it("inside one day there is no wrap note", () => {
    const r = ok(framesToTc(100, 25));
    expect(r.dayOffset).toBe(0);
    expect(r.notes.join(" ")).not.toMatch(/WRAP/);
  });

  it("hour 24 and negative labels are refused by name", () => {
    expect(err(tcToFrames("24:00:00:00", 25))).toMatch(/24-hour clock/);
    expect(err(tcToFrames("-00:00:01:00", 25))).toMatch(/cannot be negative/);
    expect(err(tcToFrames("00:60:00:00", 25))).toMatch(/Minute 60/);
    expect(err(tcToFrames("00:00:60:00", 25))).toMatch(/Second 60/);
  });

  it("a backwards span is a negative duration, never silently wrapped", () => {
    const d = ok(tcDuration("00:10:00;00", "00:09:59;29", "29.97"));
    expect(d.frames).toBe(-1);
    expect(d.durationLabel).toBe("−00:00:00;01");
    expect(ratToNumber(d.seconds)).toBeLessThan(0);
    expect(d.notes.join(" ")).toMatch(/negative/);
  });
});

describe("fractional rates are exact, never floats", () => {
  it("108000 frames at 29.97 is 3603.6 s exactly; frames/29.97 would be 3.6 ms long", () => {
    const t = ok(realTimeOf(108000, "29.97"));
    expect(ratCmp(t.seconds, rat(36036, 10))).toBe(0);
    expect(108000 / 29.97 - 3603.6).toBeCloseTo(0.0036, 4); // the trap the snap avoids
  });

  it("a typed 30000/1001 and a typed 29.97 give the same exact rate; 29.97 is reported as snapped", () => {
    const a = ok(parseRate("30000/1001"));
    const b = ok(parseRate("29.97"));
    expect(ratCmp(a.fps, b.fps)).toBe(0);
    expect(a.snapNote).toBeNull();
    expect(b.snapNote).toMatch(/1000\/1001/);
  });

  it("conflicting DF flags are refused, not guessed", () => {
    expect(err(tcToFrames("00:00:10;00", "29.97 NDF"))).toMatch(/non-drop/);
    expect(err(tcToFrames("00:00:10:00", "29.97 NDF", true))).toMatch(/says NDF/);
  });

  it("a colon-written label at a DF rate is read as DF only when DF is chosen, with a note", () => {
    const r = ok(tcToFrames("00:01:00:02", "29.97", true));
    expect(r.frames).toBe(1800);
    expect(r.label).toBe("00:01:00;02");
    expect(r.notes.join(" ")).toMatch(/conventionally written/);
    expect(ok(tcToFrames("00:01:00:00", "29.97")).frames).toBe(1800); // NDF reading: label exists
  });

  it("'.' before the frames is the alternative DF marker", () => {
    expect(ok(tcToFrames("00:01:00.02", "29.97")).frames).toBe(1800);
  });

  it("frame-count strings: whole numbers only", () => {
    expect(ok(framesToTc("1,800", "29.97", true)).label).toBe("00:01:00;02");
    expect(ok(framesToTc("2,589,407", "29.97", true)).label).toBe("23:59:59;29");
    // "1,5" is a decimal comma (product-wide rule), never frame 15.
    expect(err(framesToTc("1,5", 25))).toMatch(/decimal point/);
    expect(err(framesToTc("18,00", 25))).toMatch(/decimal point/);
    expect(err(framesToTc("18.5", 25))).toMatch(/whole number/);
    expect(err(framesToTc(1.5, 25))).toMatch(/whole number/);
    expect(err(framesToTc(NaN, 25))).toMatch(/finite/);
    expect(err(framesToTc(Infinity, 25))).toMatch(/finite/);
    expect(err(framesToTc(1e20, 25))).toMatch(/exact integer range/);
  });
});

describe("4 s bounds — pathological input returns fast (arithmetic, no per-frame loops)", () => {
  const within = (fn: () => unknown) => {
    const t0 = Date.now();
    fn();
    expect(Date.now() - t0).toBeLessThan(4000);
  };
  it("extreme counts, long strings, huge exponents, maximal figures", () => {
    within(() => ok(framesToTc(Number.MAX_SAFE_INTEGER, "59.94", true)));
    within(() => ok(framesToTc(-Number.MAX_SAFE_INTEGER, "29.97", true)));
    within(() => ok(realTimeOf(Number.MAX_SAFE_INTEGER, "23.976")));
    within(() => err(parseTimecode("0".repeat(1_000_000)) as { ok: false; error: string }));
    within(() => err(parseRate("9".repeat(1_000_000))));
    within(() => err(framesToTc("9".repeat(1_000_000), 25)));
    within(() => ratFromDecimalString("1e9999"));
    within(() => ratFromDecimalString("1".repeat(1_000_000)));
    within(() => ok(driftFigure("59.94", 1440, 5_000_000, 1e9)));
  });
  it("exponent notation round-trips exactly", () => {
    expect(ratCmp(ratFromNumber(1e-7)!, rat(1, 10_000_000))).toBe(0);
    expect(ratCmp(ratFromNumber(1e21)!, rat(10n ** 21n))).toBe(0);
    expect(ratFromNumber(NaN)).toBeNull();
  });
});

describe("display contract — no float noise in any note or refusal", () => {
  it("notes and errors carry no long decimals or exponent notation", () => {
    const texts: string[] = [];
    const collect = (r: { ok: boolean; notes?: string[]; error?: string }) => {
      if (r.ok) texts.push(...(r.notes ?? []));
      else texts.push(r.error!);
    };
    for (const rt of ["23.976", "23.98", "29.97", "59.94", 30000 / 1001, 60000 / 1001, "25", "30000/1001"]) {
      collect(tcToFrames("00:10:00:00", rt, false));
      collect(framesToTc(-5, rt));
      collect(realTimeOf(108000, rt));
      collect(tcDuration("00:00:01:00", "00:00:00:00", rt, false));
      collect(tcToFrames("00:01:00;00", rt));
    }
    collect(parseRate(29.96));
    for (const t of texts) {
      expect(t).not.toMatch(/\d\.\d{10,}/);
      expect(t).not.toMatch(/\de[+-]\d/);
      expect(t).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("the 59.94 refusal names all four dropped labels and both neighbours", () => {
    const e = err(tcToFrames("00:01:00;03", "59.94"));
    expect(e).toMatch(/;00–;03/);
    expect(e).toContain("00:00:59;59");
    expect(e).toContain("00:01:00;04");
  });
});

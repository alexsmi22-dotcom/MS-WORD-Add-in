// Information units, and the collisions they must NOT create.
import { convert } from "../units";

describe("information units", () => {
  test("bytes and bits", () => {
    expect(convert(1, "B", "bit")).toBe(8);
    expect(convert(1, "kB", "B")).toBe(1000);
    expect(convert(1, "MB", "kB")).toBeCloseTo(1000, 9);
    expect(convert(1, "GB", "MB")).toBeCloseTo(1000, 9);
  });

  test("the decimal/binary split is kept, not conflated", () => {
    expect(convert(1, "KiB", "B")).toBe(1024);
    expect(convert(1, "MiB", "B")).toBe(1024 * 1024);
    // The "why is my 1 TB disk only 931 GiB" number.
    expect(convert(1, "TB", "GiB")).toBeCloseTo(931.32, 1);
  });

  test('"KB" means kilobyte, never kilobit', () => {
    expect(convert(1, "KB", "B")).toBe(1000);
    expect(convert(1, "KB", "bit")).toBe(8000);
  });

  test("lowercase bit symbols are NOT defined, so they refuse rather than mislead", () => {
    // Defining "kb" would make a typed "KB" fall back to kilobit — an 8x error,
    // the same trap "Nm" -> nautical mile was.
    expect(convert(1, "kb", "B")).toBeNull();
    expect(convert(1, "Mb", "B")).toBeNull();
    expect(convert(1, "b", "bit")).toBeNull();
    // Spelled out, they work.
    expect(convert(1, "kbit", "bit")).toBe(1000);
    expect(convert(8, "Mbit", "MB")).toBeCloseTo(1, 9);
  });

  test("information does not convert into anything else", () => {
    expect(convert(1, "B", "m")).toBeNull();
    expect(convert(1, "bit", "s")).toBeNull();
    expect(convert(1, "GB", "kg")).toBeNull();
    expect(convert(1, "bit", "rad")).toBeNull();
  });

  test("a data RATE works as a compound", () => {
    expect(convert(1, "MB/s", "Mbit/s")).toBeCloseTo(8, 9);
    expect(convert(1, "GB/s", "MB/s")).toBeCloseTo(1000, 9);
  });

  test("tesla is untouched by adding TB", () => {
    expect(convert(1, "T", "T")).toBe(1);
    expect(convert(1, "TB", "T")).toBeNull();
  });
});

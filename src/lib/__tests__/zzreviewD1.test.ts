import * as fs from "fs";
import { FLOAT_FORMATS, roundToFormat } from "../computation";
test("dump", () => {
  const vals: number[] = JSON.parse(fs.readFileSync("C:/Users/ALEXAN~1/AppData/Local/Temp/claude/C--Users-AlexanderSmith/159af2e5-ca44-4a0b-8980-0dfa8841a194/scratchpad/d/vals.json", "utf8"));
  const out: Record<string, Array<number | string>> = {};
  for (const id of ["fp16", "bf16", "e4m3fn", "e5m2", "fp32"] as const) {
    out[id] = vals.map((v) => { const r = roundToFormat(v, FLOAT_FORMATS[id]); return r === null ? "null" : r.value === null ? (FLOAT_FORMATS[id].overflow === "nan" ? "nan" : (v > 0 ? "inf" : "-inf")) : r.value; });
  }
  fs.writeFileSync("C:/Users/ALEXAN~1/AppData/Local/Temp/claude/C--Users-AlexanderSmith/159af2e5-ca44-4a0b-8980-0dfa8841a194/scratchpad/d/mine.json", JSON.stringify(out));
});

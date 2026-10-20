#!/usr/bin/env node
// The CIP release gate (docs/SCOPE-CIP.md). Fetches the CIP Validation Suite (Hanson et al., J. Chem. Inf. Model.
// 2018, 58, 1755 — github.com/CIPValidationSuite/ValidationSuite; no licence stated, so it is never committed) into a
// temporary folder and runs src/lib/__tests__/cipSuite.gate.test.ts against it: zero wrong labels, zero labels the
// suite does not give. Needs the network; QC is offline, so run this at every release that touches lib/cip.ts and
// record its line in the CHANGELOG.
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const BASE = "https://raw.githubusercontent.com/CIPValidationSuite/ValidationSuite/master/";
const FILES = ["compounds.smi", "compounds_2d.sdf"];

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-suite-"));
  try {
    for (const f of FILES) fs.writeFileSync(path.join(dir, f), await get(BASE + f));
    const r = spawnSync(process.execPath, [path.join(__dirname, "run-jest.js"), "--runInBand", "src/lib/__tests__/cipSuite.gate.test.ts"], {
      stdio: "inherit",
      env: { ...process.env, CIP_SUITE_DIR: dir },
      cwd: path.join(__dirname, ".."),
    });
    process.exitCode = r.status ?? 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

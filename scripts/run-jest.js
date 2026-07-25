// Cross-platform jest launcher that guarantees --experimental-vm-modules reaches
// jest's WORKER processes, not just the main one.
//
// WHY THIS EXISTS
// On Node 24 jest injects a dynamic import() into every transformed module; that
// callback throws "invoked without --experimental-vm-modules" unless the flag is
// set. pptxgenjs trips it in loadNodeDeps when writing a .pptx blob, so ppt.test
// failed. The old `test` script passed the flag on the MAIN process's argv
// (`node --experimental-vm-modules …/jest.js`), but jest forks worker processes
// that do NOT inherit a parent's argv flags — and the failing import runs in a
// worker. A NODE_OPTIONS env var DOES propagate: every forked worker re-reads it
// at startup. Setting it here, before jest is spawned, fixes it uniformly across
// `npm test`, the qc gate, and every OS, with no new dependency. (Setting it from
// inside jest.config.js is too late — workers are already being spawned.)

const { spawnSync } = require("child_process");
const path = require("path");

const FLAG = "--experimental-vm-modules";
const current = process.env.NODE_OPTIONS || "";
if (!current.includes(FLAG)) {
  process.env.NODE_OPTIONS = `${current} ${FLAG}`.trim();
}

const jestBin = path.join(__dirname, "..", "node_modules", "jest", "bin", "jest.js");
const result = spawnSync(process.execPath, [jestBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) throw result.error;
process.exit(result.status == null ? 1 : result.status);

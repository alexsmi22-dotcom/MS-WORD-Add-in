/* eslint-disable no-undef */
// Require TypeScript directly from a plain Node script — OFFLINE, no new dependency.
//
// WHY THIS EXISTS
// The figure-layout gate used to be invoked as `npx ts-node scripts/figure-layout-run.ts`,
// and `ts-node` was in neither devDependencies nor node_modules. Offline that gate
// could not run at all; online it network-installed on every QC run. For a product
// whose stated core value is offline operation, a gate that needs the network is a
// gate that gets skipped — which is the same as not having it.
//
// `typescript` IS already a devDependency (it backs `npm run lint` and ts-jest), so
// the transpiler is on disk. This registers it as the handler for `.ts` in the CJS
// loader, exactly as ts-node/register does, and nothing else is needed.
//
// WHY NOT NODE'S OWN TYPE STRIPPING (Node 22.6+ / on by default in 23+)
// It only handles "erasable" syntax: an `enum`, a `namespace` or a parameter
// property is a hard error there. Overriding the `.ts` handler means this script
// path compiles the same dialect the product's own build compiles, not a subset.
//
// Transpile-only, deliberately: `npm run lint` (tsc --noEmit) is the type checker.
// This is a loader, and a loader that re-type-checks would just be a slower one.

const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true,
  resolveJsonModule: true,
  allowJs: false,
  inlineSourceMap: false,
  isolatedModules: true,
};

function compile(mod, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: COMPILER_OPTIONS,
    fileName: filename,
    reportDiagnostics: false,
  });
  mod._compile(out.outputText, filename);
}

// Register for .ts (and .tsx, which nothing here uses yet but which would
// otherwise fall through to Node's own stripper and fail confusingly).
//
// ORDER MATTERS, AND GETTING IT WRONG IS SILENT.
// Node resolves an extensionless `require("./compounds")` by trying each key of
// Module._extensions IN INSERTION ORDER. Appending `.ts` after the built-in
// `.js`/`.json`/`.node` meant `src/lib/compounds.ts` lost to `src/lib/compounds.json`
// sitting beside it — so `NAME_TO_SMILES` came back `undefined` and every
// structure lookup died several modules downstream, with nothing in the message
// naming the real cause. Rebuild the table with the TypeScript extensions FIRST,
// which is what ts-node does and for exactly this reason. An explicit
// `require("./compounds.json")` still resolves to the JSON: it carries its own
// extension and never enters this probe order.
{
  const originals = { ...Module._extensions };
  for (const k of Object.keys(Module._extensions)) delete Module._extensions[k];
  Module._extensions[".ts"] = compile;
  Module._extensions[".tsx"] = compile;
  for (const [k, v] of Object.entries(originals)) {
    if (k === ".ts" || k === ".tsx") continue;
    Module._extensions[k] = v;
  }
}

module.exports = { compile, COMPILER_OPTIONS, extensionOrder: () => Object.keys(Module._extensions) };

void path;

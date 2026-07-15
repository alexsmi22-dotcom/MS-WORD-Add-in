/* eslint-disable no-undef */
// Jest config for the pure logic modules (parsers, OMML/HTML emitters, builder,
// compound dictionary). Office-dependent code (taskpane.ts) still cannot be unit
// tested — it needs the Word host — but src/taskpane is in scope for tests over
// its STATIC ASSETS, which need no host: the markup's structure and id wiring.
// Those caught a real bug (a tool section left visible under the Home tiles), so
// they earn their place. Anything in src/taskpane that requires Office belongs in
// the manual pass (docs/TEST-SCRIPT.md), not here.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/lib", "<rootDir>/src/taskpane"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          resolveJsonModule: true,
          esModuleInterop: true,
          // Base tsconfig restricts types to office-js; tests need the jest
          // globals, plus node for the static-asset tests that read markup.
          types: ["jest", "node"],
        },
      },
    ],
  },
};

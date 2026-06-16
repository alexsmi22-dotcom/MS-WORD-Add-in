/* eslint-disable no-undef */
// Jest config for the pure logic modules (parsers, OMML/HTML emitters, builder,
// compound dictionary). UI/Office-dependent code (taskpane.ts) is not unit-tested
// here — it requires the Word host — so tests target src/lib only.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/lib"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          resolveJsonModule: true,
          esModuleInterop: true,
          // Base tsconfig restricts types to office-js; tests need the jest globals.
          types: ["jest"],
        },
      },
    ],
  },
};

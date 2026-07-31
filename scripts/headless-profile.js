/* eslint-disable no-undef */
// A disposable browser profile for the headless gates.
//
// WHY THIS EXISTS. Edge and Chrome create a throwaway profile for every headless
// launch, and unless a --user-data-dir is given they put it in
// %TEMP%\scoped_dir<pid>_<rand> and NEVER remove it. render-check, the layout
// gate, the pane-layout gate and pane-shot each launch the browser at least once
// per run — the layout gate launches once per page per width — so a working day
// of `npm run qc` leaves thousands behind.
//
// On 2026-07-31 that filled the disk on the development machine: 824 leftover
// profiles, C: at zero bytes free. The failure did not look like a disk problem.
// A file rewrite TRUNCATED README.md TO ZERO BYTES — the open-for-write succeeded
// and the write did not — and what surfaced was a documentation gate failing on a
// file that had been fine a minute earlier.
//
// So every headless launch in this repo routes its profile through here, and the
// directory is removed when the run ends however it ends.

const fs = require("fs");
const os = require("os");
const path = require("path");

/** Directories to remove when the process ends, however it ends. */
const registered = new Set();

function removeQuietly(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* best effort — a leftover temp dir must never fail a gate */
  }
}

/**
 * Marks a directory for removal at process exit.
 *
 * Registering rather than restructuring is deliberate: the two layout gates
 * create their temp directory at the top of a function with several early
 * returns and a couple of throw paths, and wrapping those in try/finally means
 * editing working gates for a housekeeping fix. An exit hook covers every path,
 * including the ones that abort.
 */
function registerTempDir(dir) {
  registered.add(dir);
  return dir;
}

process.on("exit", () => {
  for (const dir of registered) removeQuietly(dir);
});

/**
 * Makes a temporary profile directory and returns the flag to pass to the
 * browser plus a cleanup function.
 *
 * `cleanup` is best-effort and never throws: a gate must not fail because a
 * temporary directory could not be removed, and on Windows the browser can still
 * be holding a file handle for a moment after it exits. It is also registered for
 * removal at exit, so a path that never reaches cleanup() still gets tidied.
 */
function makeProfile(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jurislab-${tag}-`));
  registerTempDir(dir);
  return {
    dir,
    /** Pass this straight into the browser argument list. */
    arg: "--user-data-dir=" + path.join(dir, "profile"),
    cleanup() {
      removeQuietly(dir);
      registered.delete(dir);
    },
  };
}

/**
 * Removes `scoped_dir*` profiles left behind by earlier runs — including runs of
 * older versions of these scripts, and any launched by something else that did
 * not pass a --user-data-dir.
 *
 * Only touches directories matching the browsers' own naming pattern, and only
 * ones older than `minAgeMs` so a concurrently running browser is left alone.
 * Returns how many it removed.
 */
function sweepStaleProfiles(minAgeMs = 60 * 60 * 1000) {
  const tmp = os.tmpdir();
  let removed = 0;
  let entries;
  try {
    entries = fs.readdirSync(tmp, { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = Date.now() - minAgeMs;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // Two patterns, because there were two leaks. `scoped_dir*` is what the
    // browser names its own throwaway profile when no --user-data-dir is given
    // (render-check, pane-shot). `jurislab-*` is what the layout gates named
    // theirs — they passed the flag correctly and then never removed the
    // directory, which made them the bigger of the two by an order of magnitude:
    // 819 of them held 10.7 GB, against 824 scoped_dirs holding 0.65 GB.
    if (!/^scoped_dir\d+_\d+$/.test(e.name) && !/^jurislab-(overlap|pane|render|shot)-/.test(e.name)) continue;
    const full = path.join(tmp, e.name);
    try {
      if (fs.statSync(full).mtimeMs > cutoff) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {
      /* in use, or gone already */
    }
  }
  return removed;
}

module.exports = { makeProfile, registerTempDir, sweepStaleProfiles };

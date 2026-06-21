// Builds the macOS install zip with correct Unix file permissions.
//
//   node scripts/zip-mac.mjs <sourceDir> <outZip>
//
// PowerShell's Compress-Archive writes a "DOS" zip that stores no Unix
// permission bits, so on macOS every extracted file lands as non-executable
// (0644). That makes install.command un-double-clickable. This writer stamps
// each entry's external attributes with a real Unix mode (0755 for *.command,
// 0644 otherwise) and flags the zip as Unix-made, which macOS honours.
//
// Pure Node, no dependencies. Files are small, so entries are STORE (no
// compression) to keep the format trivially correct.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const [, , srcDir, outZip] = process.argv;
if (!srcDir || !outZip) {
  console.error("usage: node scripts/zip-mac.mjs <sourceDir> <outZip>");
  process.exit(2);
}

// CRC-32 (IEEE 802.3), table-based.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Collect top-level files (the mac pack is flat).
const names = readdirSync(srcDir).filter((n) => statSync(join(srcDir, n)).isFile());
if (names.length === 0) {
  console.error(`No files found in ${srcDir}`);
  process.exit(1);
}

const localParts = [];
const central = [];
let offset = 0;

for (const name of names) {
  const data = readFileSync(join(srcDir, name));
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const size = data.length;
  // 0o100xxx = regular file; .command gets the execute bits.
  const isCmd = basename(name).toLowerCase().endsWith(".command");
  const unixMode = isCmd ? 0o100755 : 0o100644;
  const externalAttrs = (unixMode << 16) >>> 0;

  // --- local file header ---
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); // signature
  lfh.writeUInt16LE(20, 4); // version needed
  lfh.writeUInt16LE(0, 6); // flags
  lfh.writeUInt16LE(0, 8); // method: 0 = store
  lfh.writeUInt16LE(0, 10); // mod time (fixed → reproducible)
  lfh.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(size, 18); // compressed size
  lfh.writeUInt32LE(size, 22); // uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28); // extra length
  localParts.push(lfh, nameBuf, data);

  // --- central directory header ---
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0); // signature
  cdh.writeUInt16LE((3 << 8) | 20, 4); // version made by: 3 = Unix
  cdh.writeUInt16LE(20, 6); // version needed
  cdh.writeUInt16LE(0, 8); // flags
  cdh.writeUInt16LE(0, 10); // method: store
  cdh.writeUInt16LE(0, 12); // mod time
  cdh.writeUInt16LE(0x21, 14); // mod date
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(size, 20);
  cdh.writeUInt32LE(size, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30); // extra length
  cdh.writeUInt16LE(0, 32); // comment length
  cdh.writeUInt16LE(0, 34); // disk number start
  cdh.writeUInt16LE(0, 36); // internal attrs
  cdh.writeUInt32LE(externalAttrs, 38); // external attrs = Unix mode << 16
  cdh.writeUInt32LE(offset, 42); // local header offset
  central.push(cdh, nameBuf);

  offset += lfh.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(central);
const localBuf = Buffer.concat(localParts);

// --- end of central directory record ---
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4); // this disk
eocd.writeUInt16LE(0, 6); // disk with cd
eocd.writeUInt16LE(names.length, 8); // entries this disk
eocd.writeUInt16LE(names.length, 10); // total entries
eocd.writeUInt32LE(centralBuf.length, 12); // cd size
eocd.writeUInt32LE(localBuf.length, 16); // cd offset
eocd.writeUInt16LE(0, 20); // comment length

writeFileSync(outZip, Buffer.concat([localBuf, centralBuf, eocd]));
console.log(`Wrote ${outZip} (${names.length} files; .command marked executable 0755)`);

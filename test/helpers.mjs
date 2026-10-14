import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../scripts/zip.mjs';

/** Independent zip reader: returns { name: Buffer } and verifies sizes and CRCs. */
export function readZip(path) {
  const buf = readFileSync(path);
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error('missing end-of-central-directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = inflateRawSync(buf.subarray(start, start + csize));
    if (data.length !== usize) throw new Error(`size mismatch for ${name}`);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    out[name] = data;
    p += 46 + nameLen;
  }
  return out;
}

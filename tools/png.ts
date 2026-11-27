/**
 * Minimal PNG encoder and decoder for the map tools (8-bit RGB/RGBA, non-interlaced).
 * The encoder writes no color-management chunks, so browsers decode exact colors.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedImage {
  width: number;
  height: number;
  /** Always RGBA, 4 bytes per pixel. */
  pixels: Uint8Array;
}

/** Encodes RGB (3 bytes per pixel) or RGBA (4 bytes per pixel) data as PNG. */
export function encodePng(
  width: number,
  height: number,
  data: Uint8Array,
  channels: 3 | 4 = 3,
): Buffer {
  if (data.length !== width * height * channels)
    throw new Error('encodePng: data length does not match size');
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Filter type 1 (Sub): good compression for large flat areas.
    const out = y * (stride + 1);
    raw[out] = 1;
    for (let i = 0; i < stride; i++) {
      const cur = data[y * stride + i]!;
      const left = i >= channels ? data[y * stride + i - channels]! : 0;
      raw[out + 1 + i] = (cur - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 3 ? 2 : 6; // color type: RGB or RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decodes an 8-bit, non-interlaced PNG (gray, RGB, palette, gray+alpha or RGBA) to RGBA. */
export function decodePng(file: Uint8Array): DecodedImage {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8]!;
      colorType = body[9]!;
      const interlace = body[12]!;
      if (depth !== 8) throw new Error(`Unsupported PNG bit depth ${depth} (need 8)`);
      if (interlace !== 0) throw new Error('Interlaced PNGs are not supported');
    } else if (type === 'PLTE') {
      palette = Buffer.from(body);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`Unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= channels ? out[dst + i - channels]! : 0;
      const b = y > 0 ? out[dst - stride + i]! : 0;
      const c = i >= channels && y > 0 ? out[dst - stride + i - channels]! : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          throw new Error(`Bad PNG filter type ${filter}`);
      }
      out[dst + i] = v & 0xff;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * channels;
    const d = p * 4;
    if (colorType === 2 || colorType === 6) {
      pixels[d] = out[s]!;
      pixels[d + 1] = out[s + 1]!;
      pixels[d + 2] = out[s + 2]!;
      pixels[d + 3] = colorType === 6 ? out[s + 3]! : 255;
    } else if (colorType === 3) {
      if (!palette) throw new Error('Palette PNG without PLTE chunk');
      const e = out[s]! * 3;
      pixels[d] = palette[e]!;
      pixels[d + 1] = palette[e + 1]!;
      pixels[d + 2] = palette[e + 2]!;
      pixels[d + 3] = 255;
    } else {
      pixels[d] = pixels[d + 1] = pixels[d + 2] = out[s]!;
      pixels[d + 3] = colorType === 4 ? out[s + 1]! : 255;
    }
  }
  return { width, height, pixels };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

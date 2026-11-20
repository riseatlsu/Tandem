/**
 * Minimal, dependency-free image helpers for recording Tandem's example clips:
 * PNG decoding (Playwright screenshots), box downscaling, and an animated GIF encoder with
 * a shared median-cut palette, ordered dithering and inter-frame transparency (unchanged pixels).
 */
import { inflateSync } from 'node:zlib';

export interface RGBA { width: number; height: number; data: Uint8Array }

/** Decodes 8-bit RGB/RGBA, non-interlaced PNGs (what Chromium screenshots produce). */
export function decodePng(buf: Buffer): RGBA {
  let p = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); bitDepth = body[8]; colorType = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || interlace || (colorType !== 2 && colorType !== 6)) throw new Error(`Unsupported PNG (depth ${bitDepth}, type ${colorType}, interlace ${interlace})`);
  const bpp = colorType === 6 ? 4 : 3, stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += bpp) { data[i * 4] = px[j]; data[i * 4 + 1] = px[j + 1]; data[i * 4 + 2] = px[j + 2]; data[i * 4 + 3] = 255; }
  return { width, height, data };
}

/** Area-average downscale to `w` pixels wide. */
export function downscale(img: RGBA, w: number): RGBA {
  if (w >= img.width) return img;
  const h = Math.round((img.height * w) / img.width), sx = img.width / w, sy = img.height / h;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
    const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

/** Median cut over a 5-bit-per-channel histogram of every frame → up to `n` colors. */
function buildPalette(frames: RGBA[], n: number): number[][] {
  const hist = new Uint32Array(32768);
  for (const f of frames) for (let i = 0; i < f.data.length; i += 8) hist[((f.data[i] >> 3) << 10) | ((f.data[i + 1] >> 3) << 5) | (f.data[i + 2] >> 3)]++;
  type Box = { cols: number[] };
  const cols: number[] = [];
  for (let c = 0; c < 32768; c++) if (hist[c]) cols.push(c);
  const ch = (c: number, k: number) => (k === 0 ? c >> 10 : k === 1 ? (c >> 5) & 31 : c & 31);
  let boxes: Box[] = [{ cols }];
  while (boxes.length < n) {
    // split the box with the largest (range × population)
    let best = -1, bestScore = -1, bestK = 0;
    boxes.forEach((b, i) => {
      if (b.cols.length < 2) return;
      let pop = 0; const lo = [31, 31, 31], hi = [0, 0, 0];
      for (const c of b.cols) { pop += hist[c]; for (let k = 0; k < 3; k++) { const v = ch(c, k); if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; } }
      const ranges = hi.map((h, k) => h - lo[k]), k = ranges.indexOf(Math.max(...ranges));
      const score = ranges[k] * Math.sqrt(pop);
      if (score > bestScore) { bestScore = score; best = i; bestK = k; }
    });
    if (best < 0) break;
    const b = boxes[best];
    b.cols.sort((x, y) => ch(x, bestK) - ch(y, bestK));
    let total = 0; for (const c of b.cols) total += hist[c];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.cols.length - 1; i++) { acc += hist[b.cols[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes = [...boxes.slice(0, best), { cols: b.cols.slice(0, cut) }, { cols: b.cols.slice(cut) }, ...boxes.slice(best + 1)];
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, n2 = 0;
    for (const c of b.cols) { const w = hist[c]; r += ((c >> 10) * 8 + 4) * w; g += (((c >> 5) & 31) * 8 + 4) * w; bl += ((c & 31) * 8 + 4) * w; n2 += w; }
    return [Math.round(r / n2), Math.round(g / n2), Math.round(bl / n2)];
  });
}

function lzw(indices: Uint8Array, minCode: number): number[] {
  const out: number[] = [];
  let cur = 0, bits = 0;
  const emit = (code: number, size: number) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>= 8; bits -= 8; } };
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > 1 << size && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (bits) out.push(cur & 255);
  return out;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 10);

/** Encodes frames (all the same size) as a looping GIF. `delaysMs[i]` is how long frame i is shown. */
export function encodeGif(frames: RGBA[], delaysMs: number[]): Buffer {
  const { width: w, height: h } = frames[0];
  const pal = buildPalette(frames, 255);
  while (pal.length < 255) pal.push([0, 0, 0]);
  const TRANSPARENT = 255;
  // nearest-color lookup on the 5-bit cube
  const lut = new Uint8Array(32768);
  for (let c = 0; c < 32768; c++) {
    const r = (c >> 10) * 8 + 4, g = ((c >> 5) & 31) * 8 + 4, b = (c & 31) * 8 + 4;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 255; i++) { const d = (pal[i][0] - r) ** 2 * 3 + (pal[i][1] - g) ** 2 * 4 + (pal[i][2] - b) ** 2 * 2; if (d < bd) { bd = d; best = i; } }
    lut[c] = best;
  }
  const bytes: number[] = [];
  const str = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
  const u16 = (v: number) => bytes.push(v & 255, (v >> 8) & 255);
  str('GIF89a'); u16(w); u16(h); bytes.push(0xf7, 0, 0); // global table of 256
  for (let i = 0; i < 256; i++) bytes.push(...(pal[i] ?? [0, 0, 0]));
  bytes.push(0x21, 0xff, 11); str('NETSCAPE2.0'); bytes.push(3, 1, 0, 0, 0); // loop forever
  let prev: Uint8Array | null = null;
  frames.forEach((f, fi) => {
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, d = BAYER[(y & 3) * 4 + (x & 3)];
      const r = Math.max(0, Math.min(255, f.data[i] + d)), g = Math.max(0, Math.min(255, f.data[i + 1] + d)), b = Math.max(0, Math.min(255, f.data[i + 2] + d));
      idx[y * w + x] = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
    }
    const outIdx = idx.slice();
    if (prev) for (let i = 0; i < idx.length; i++) if (idx[i] === prev[i]) outIdx[i] = TRANSPARENT;
    prev = idx;
    const delay = Math.max(2, Math.round((delaysMs[fi] ?? 100) / 10));
    bytes.push(0x21, 0xf9, 4, (1 << 2) | 1); u16(delay); bytes.push(TRANSPARENT, 0); // keep previous frame, transparency on
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(8);
    const data = lzw(outIdx, 8);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); bytes.push(chunk.length, ...chunk); }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

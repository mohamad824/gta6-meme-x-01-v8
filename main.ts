// gta6-meme-x-01 v8 — "LEONIDA DINER, CHECK #13"
// Fresh build: draws the meme PNG (1024x1024) with a pure-JS renderer
// (5x7 bitmap font, supersampled 2x, hand-rolled PNG encoder) and copies
// POST.json from the repo into the output dir, per RULES.txt ("The post file").
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------- PNG encoder (pure JS, deterministic) ----------
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
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function pngEncode(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Canvas: 1024-space coords, rendered at 2x and downsampled ----------
const SS = 2;
const W = 1024;
const H = 1024;
const PW = W * SS;
const buf = new Uint8Array(PW * PW * 3);
function px(x, y, c) {
  if (x < 0 || y < 0 || x >= PW || y >= PW) return;
  const i = (y * PW + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function fillRect(x, y, w, h, c) {
  const x0 = Math.round(x * SS), y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS), y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) px(xx, yy, c);
}
function fillCircle(cx, cy, r, c) {
  const x0 = Math.round((cx - r) * SS), x1 = Math.round((cx + r) * SS);
  const y0 = Math.round((cy - r) * SS), y1 = Math.round((cy + r) * SS);
  const R = r * SS, CX = cx * SS, CY = cy * SS;
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - CX, dy = yy - CY;
      if (dx * dx + dy * dy <= R * R) px(xx, yy, c);
    }
}
function fillPoly(points, c) {
  // points: [[x,y],...] in 1024-space; scanline fill on the 2x grid.
  const pts = points.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let yy = Math.ceil(minY); yy <= Math.floor(maxY); yy++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= yy && y2 > yy) || (y2 <= yy && y1 > yy)) {
        xs.push(x1 + ((yy - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let xx = Math.ceil(xs[k]); xx <= Math.floor(xs[k + 1]); xx++) px(xx, yy, c);
    }
  }
}
function starPoints(cx, cy, rOuter, rInner, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
function sparklePoints(cx, cy, r) {
  const k = 0.3;
  return [
    [cx, cy - r], [cx + r * k, cy - r * k], [cx + r, cy], [cx + r * k, cy + r * k],
    [cx, cy + r], [cx - r * k, cy + r * k], [cx - r, cy], [cx - r * k, cy - r * k],
  ];
}

// ---------- 5x7 bitmap font (bits: 0x10 = leftmost column) ----------
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  a: [0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f, 0x00], b: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x1e],
  c: [0x00, 0x0e, 0x10, 0x10, 0x10, 0x0e, 0x00], d: [0x01, 0x01, 0x0f, 0x11, 0x11, 0x11, 0x0f],
  e: [0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e, 0x00], f: [0x06, 0x08, 0x1e, 0x08, 0x08, 0x08, 0x08],
  g: [0x00, 0x0f, 0x11, 0x11, 0x0f, 0x01, 0x0e], h: [0x10, 0x10, 0x1e, 0x11, 0x11, 0x11, 0x11],
  i: [0x00, 0x04, 0x00, 0x0c, 0x04, 0x04, 0x0e], j: [0x00, 0x02, 0x00, 0x06, 0x02, 0x02, 0x0c],
  k: [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12], l: [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  m: [0x00, 0x00, 0x1a, 0x15, 0x15, 0x15, 0x15], n: [0x00, 0x00, 0x1e, 0x11, 0x11, 0x11, 0x11],
  o: [0x00, 0x0e, 0x11, 0x11, 0x11, 0x11, 0x0e], p: [0x00, 0x00, 0x1e, 0x11, 0x11, 0x1e, 0x10],
  q: [0x00, 0x00, 0x0f, 0x11, 0x11, 0x0f, 0x01], r: [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10],
  s: [0x00, 0x0f, 0x10, 0x0e, 0x01, 0x01, 0x1e], t: [0x04, 0x04, 0x1f, 0x04, 0x04, 0x04, 0x06],
  u: [0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d], v: [0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04],
  w: [0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0a], x: [0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11],
  y: [0x00, 0x00, 0x11, 0x11, 0x0f, 0x01, 0x0e], z: [0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0], ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08], ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ";": [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08], "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04], "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '"': [0x0a, 0x0a, 0x0a, 0, 0, 0, 0], "-": [0, 0, 0, 0x1f, 0, 0, 0],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04], "%": [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d], "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08], "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0], "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a], "*": [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0],
  "•": [0, 0, 0x0c, 0x0c, 0x0c, 0, 0], "×": [0, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0],
  _: [0, 0, 0, 0, 0, 0, 0x1f],
};
function textWidth(str, scale) {
  return str.length * 6 * scale - scale;
}
function drawText(str, x, y, scale, color, align = "left") {
  let ox = x;
  const w = textWidth(str, scale);
  if (align === "center") ox = x - w / 2;
  if (align === "right") ox = x - w;
  for (let i = 0; i < str.length; i++) {
    const g = FONT[str[i]] || FONT[" "];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r] & (0x10 >> c)) {
          fillRect(ox + i * 6 * scale + c * scale, y + r * scale, scale, scale, color);
        }
      }
    }
  }
  return w;
}

// ---------- Palette ----------
const PAPER = [255, 243, 214];
const NAVY = [27, 42, 74];
const MAGENTA = [230, 0, 126];
const PINK = [255, 217, 236];
const SUB = [107, 91, 74];
const BAND_NAVY = [20, 33, 61];
const YELLOW = [255, 210, 63];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

// ---------- make.fun ghost (press-kit mark): white body, thick black outline,
// two black 4-point sparkle eyes, round little hands, magenta star coin ----------
function ghostPoints(cx, top, w) {
  const R = w / 2;
  const bodyH = w * 1.28;
  const waveR = R / 3;
  const yB = top + bodyH - waveR;
  const pts = [];
  for (let a = 180; a <= 360; a += 5) {
    const t = (a * Math.PI) / 180;
    pts.push([cx + R * Math.cos(t), top + R + R * Math.sin(t)]);
  }
  pts.push([cx + R, yB]);
  for (let i = 0; i < 3; i++) {
    const ccx = cx + R - (i + 0.5) * (2 * R) / 3;
    for (let a = 0; a <= 180; a += 6) {
      const t = (a * Math.PI) / 180;
      pts.push([ccx + waveR * Math.cos(t), yB + waveR * Math.sin(t)]);
    }
  }
  pts.push([cx - R, top + R]);
  return pts;
}
function drawGhost(cx, top, w) {
  const R = w / 2;
  const pts = ghostPoints(cx, top, w);
  const ocx = cx, ocy = top + w * 0.55;
  const outline = pts.map(([x, y]) => [ocx + (x - ocx) * 1.06, ocy + (y - ocy) * 1.06]);
  fillPoly(outline, BLACK);
  fillPoly(pts, WHITE);
  // waiter bow tie
  const by = top + R * 1.62;
  fillPoly([[cx - 8, by], [cx - 36, by - 13], [cx - 36, by + 13]], BLACK);
  fillPoly([[cx + 8, by], [cx + 36, by - 13], [cx + 36, by + 13]], BLACK);
  fillPoly([[cx - 6, by], [cx - 30, by - 10], [cx - 30, by + 10]], MAGENTA);
  fillPoly([[cx + 6, by], [cx + 30, by - 10], [cx + 30, by + 10]], MAGENTA);
  fillRect(cx - 7, by - 7, 14, 14, MAGENTA);
  // sparkle eyes
  const ey = top + R * 0.98;
  fillPoly(sparklePoints(cx - R * 0.38, ey, R * 0.27), BLACK);
  fillPoly(sparklePoints(cx + R * 0.38, ey, R * 0.27), BLACK);
  // star coin in the right hand (magenta disc, white star)
  const coinX = cx + R * 1.14, coinY = top + R * 1.66;
  fillCircle(coinX, coinY, R * 0.36, BLACK);
  fillCircle(coinX, coinY, R * 0.31, MAGENTA);
  fillPoly(starPoints(coinX, coinY, R * 0.21, R * 0.09), WHITE);
  // round little hands
  fillCircle(cx - R * 1.04, top + R * 1.78, R * 0.17, BLACK);
  fillCircle(cx - R * 1.04, top + R * 1.78, R * 0.13, WHITE);
  fillCircle(cx + R * 0.94, top + R * 1.74, R * 0.17, BLACK);
  fillCircle(cx + R * 0.94, top + R * 1.74, R * 0.13, WHITE);
}

// ---------- Diner bill layout ----------
function dottedLeader(x0, x1, y, c) {
  for (let x = x0; x <= x1; x += 9) fillRect(x, y, 4, 4, c);
}
function rule(y, c, thick = 3) {
  fillRect(48, y, W - 96, thick, c);
}
function renderMeme() {
  fillRect(0, 0, W, H, PAPER);
  // frame: navy outer border + magenta inner border
  fillRect(0, 0, W, 10, NAVY); fillRect(0, H - 10, W, 10, NAVY);
  fillRect(0, 0, 10, H, NAVY); fillRect(W - 10, 0, 10, H, NAVY);
  fillRect(18, 18, W - 36, 3, MAGENTA); fillRect(18, H - 21, W - 36, 3, MAGENTA);
  fillRect(18, 18, 3, H - 36, MAGENTA); fillRect(W - 21, 18, 3, H - 36, MAGENTA);

  // header
  drawText("LEONIDA DINER", W / 2, 34, 8, NAVY, "center");
  drawText("VICE CITY • EST. 2013 • CHECK #13", W / 2, 104, 3, MAGENTA, "center");
  rule(130, MAGENTA, 3); rule(137, MAGENTA, 3);

  // ghost waiter, big and central
  drawGhost(W / 2, 150, 200);
  drawText("SERVER: GHOST • TABLE 13 • ONE PATIENT GAMER", W / 2, 416, 3, NAVY, "center");
  rule(446, NAVY, 3);

  // itemised bill: 5 micro-jokes, each with its own subline
  const items = [
    ["1× GTA VI - FINALLY SERVED", "$79.99", "ORDERED 17 SEP 2013. SERVED 19 NOV 2026."],
    ["1× CHILDHOOD - ON THE HOUSE", "$0.00", "EATEN WHILE WAITING. NO REFUNDS."],
    ["2× DELAYS - COMPED", "$0.00", "THE CHEF APOLOGISED. TWICE."],
    ["214 GB DOWNLOAD", "$0.00", "STUCK AT 99% SINCE 2013. PHOTOS DELETED."],
    ["1× PATIENCE", "$0.00", "NONE LEFT. ASK AGAIN IN 13 YEARS."],
  ];
  let y = 462;
  for (const [name, price, sub] of items) {
    drawText(name, 48, y, 4, NAVY, "left");
    const pw = textWidth(price, 4);
    drawText(price, 976, y, 4, NAVY, "right");
    dottedLeader(48 + textWidth(name, 4) + 12, 976 - pw - 12, y + 13, SUB);
    drawText(sub, 48, y + 34, 3, SUB, "left");
    y += 58;
  }
  rule(756, NAVY, 3);

  // totals
  drawText("TOTAL DUE", 48, 768, 5, NAVY, "left");
  drawText("$79.99", 976, 768, 5, MAGENTA, "right");

  // killer line — magenta climax band, the biggest text on the bill
  fillRect(28, 812, W - 56, 90, MAGENTA);
  drawText("13 YEARS OF WAITING. TIPS: $0.", W / 2, 820, 5, WHITE, "center");
  drawText("BECAUSE NOBODY CAME.", W / 2, 862, 5, WHITE, "center");

  // payout — navy band: the agent on make.fun covers the check
  fillRect(28, 908, W - 56, 64, BAND_NAVY);
  drawText("MY AGENT ON make.fun WON $250", W / 2, 914, 4, YELLOW, "center");
  drawText("WHILE I WAITED. YOUR AGENT COULD BE NEXT.", W / 2, 946, 3, WHITE, "center");

  // footer sell
  drawText("make.fun - WHERE AGENTS EARN REAL MONEY", W / 2, 978, 3, MAGENTA, "center");

  // downsample 2x -> 1024x1024
  const rgb = Buffer.alloc(W * H * 3);
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((yy * SS + dy) * PW + (xx * SS + dx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const o = (yy * W + xx) * 3;
      rgb[o] = Math.round(r / 4); rgb[o + 1] = Math.round(g / 4); rgb[o + 2] = Math.round(b / 4);
    }
  }
  return pngEncode(W, H, rgb);
}

// ---------- Entry point: copy POST.json, render the meme ----------
const botDir = process.env.MAKEFUN_BOT_DIR ?? ".";
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
const postPath = join(botDir, "POST.json");
let postText;
try {
  postText = readFileSync(postPath, "utf8");
} catch {
  console.error(`main.ts: cannot read ${postPath}`);
  process.exit(1);
}
let post;
try {
  post = JSON.parse(postText);
} catch {
  console.error("main.ts: POST.json is not valid JSON");
  process.exit(1);
}
if (!post || typeof post.url !== "string") {
  console.error("main.ts: POST.json must hold {\"url\": \"...\"}");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "POST.json"), postText);
writeFileSync(join(outDir, "meme-v8.png"), renderMeme());
console.log("main.ts: wrote POST.json and meme-v8.png to " + outDir);

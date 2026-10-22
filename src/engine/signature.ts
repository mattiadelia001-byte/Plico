import type { Point } from "./plicoDoc";
import type { Signature } from "./annotations";
import { uid } from "./plicoDoc";

/** Arrotonda un tratto disegnato a mano (due passate di Chaikin), tenendo fermi il primo e l'ultimo punto. */
export function smoothStroke(pts: Point[]): Point[] {
  let cur = pts;
  for (let pass = 0; pass < 2; pass++) {
    if (cur.length < 3) break;
    const next: Point[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [a, b] = [cur[i], cur[i + 1]];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Toglie i punti troppo vicini fra loro: il tratto resta uguale ma il file pesa meno. */
function dedupe(pts: Point[], minDist: number): Point[] {
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= minDist) out.push(pts[i]);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}

/** Trasforma i tratti disegnati nella finestra in una firma ritagliata sul suo contenuto. */
export function signatureFromStrokes(strokes: Point[][]): Signature | null {
  const smooth = strokes.map((s) => dedupe(smoothStroke(dedupe(s, 0.8)), 0.5));
  const all = smooth.flat();
  if (all.length < 3) return null;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
  return { id: uid(), aspect: w / h, strokes: smooth.map((s) => s.map(([x, y]): Point => [(x - x0) / w, (y - y0) / h])) };
}

/**
 * Da una foto di una firma su carta bianca ricava un PNG con solo l'inchiostro (nero su trasparente).
 * `sensitivity` va da 0 a 100: più è alta, più tratti leggeri vengono tenuti.
 */
export function signatureFromImage(img: CanvasImageSource & { width: number; height: number }, sensitivity: number): Signature | null {
  const scale = Math.min(1, 900 / Math.max(img.width, 1));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  const lum = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    lum[i] = l; hist[Math.round(l)]++;
  }
  // il colore della carta è quello più chiaro che compare spesso (percentile 85)
  let acc = 0, paper = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= w * h * 0.85) { paper = v; break; } }
  const margin = 70 - sensitivity * 0.55; // quanto più scuro della carta deve essere un punto per contare
  const soft = 55;

  let [bx0, by0, bx1, by1] = [w, h, -1, -1];
  for (let i = 0; i < w * h; i++) {
    const a = Math.max(0, Math.min(1, (paper - lum[i] - margin * 0.4) / soft));
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 0;
    px[i * 4 + 3] = Math.round(a * 255);
    if (a > 0.5) {
      const x = i % w, y = (i / w) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
  }
  if (bx1 < 0 || (bx1 - bx0) * (by1 - by0) < 100) return null;
  ctx.putImageData(data, 0, 0);

  const pad = 3;
  bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(w - 1, bx1 + pad); by1 = Math.min(h - 1, by1 + pad);
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  out.getContext("2d")!.drawImage(canvas, bx0, by0, cw, ch, 0, 0, cw, ch);
  return { id: uid(), aspect: cw / ch, strokes: [], image: out.toDataURL("image/png") };
}

const tinted = new Map<string, string>();

/** La firma da immagine nel colore scelto (data URL PNG). */
export async function tintedImage(sig: Signature, color: string): Promise<string> {
  if (!sig.image) return "";
  const key = sig.id + color;
  const hit = tinted.get(key);
  if (hit) return hit;
  const img = new Image();
  img.src = sig.image;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
  const url = c.toDataURL("image/png");
  tinted.set(key, url);
  return url;
}

export function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Larghezza con cui una firma nuova entra nella pagina. */
export const defaultSignatureWidth = (pageWidth: number) => Math.min(170, pageWidth * 0.32);

/** Percorso SVG di una firma disegnata (coordinate 0..1 scalate sul riquadro dato). */
export function signaturePath(sig: Signature, x: number, y: number, w: number, h: number): string {
  return sig.strokes
    .map((s) => s.map((p, i) => `${i ? "L" : "M"}${(x + p[0] * w).toFixed(2)},${(y + p[1] * h).toFixed(2)}`).join("") + (s.length === 1 ? "l0.1,0" : ""))
    .join("");
}

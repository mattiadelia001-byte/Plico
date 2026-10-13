import * as mupdf from "mupdf";
import { PlicoDoc, graftPage } from "./plicoDoc";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export type Progress = (done: number, total: number) => void;

export function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const pdf = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
  if (!pdf) throw new Error("Il file non è un PDF valido.");
  return pdf;
}

function toBytes(pdf: mupdf.PDFDocument, options = "garbage=compact,compress=yes"): Uint8Array {
  const buf = pdf.saveToBuffer(options);
  const out = buf.asUint8Array().slice();
  buf.destroy();
  return out;
}

export interface MergeSource {
  pdf: mupdf.PDFDocument;
}

/** Unisce più documenti in uno nuovo, nell'ordine dato. */
export async function merge(sources: MergeSource[], onProgress?: Progress): Promise<Uint8Array> {
  const out = new mupdf.PDFDocument();
  const total = sources.reduce((n, s) => n + s.pdf.countPages(), 0);
  let done = 0;
  for (const s of sources) {
    const n = s.pdf.countPages();
    for (let i = 0; i < n; i++) {
      graftPage(out, -1, s.pdf, i);
      onProgress?.(++done, total);
      if (done % 10 === 0) await tick();
    }
  }
  return toBytes(out);
}

/** Estrae le pagine indicate in un nuovo PDF. */
export function extractPages(doc: PlicoDoc, pages: number[]): Uint8Array {
  const out = new mupdf.PDFDocument();
  for (const i of pages) graftPage(out, -1, doc.pdf, i);
  return toBytes(out);
}

/** Interpreta "1-3, 5, 7-9" in gruppi di indici (base 0). Restituisce null se non valido. */
export function parseRanges(text: string, pageCount: number): number[][] | null {
  const groups: number[][] = [];
  for (const part of text.split(/[,;]/)) {
    const s = part.trim();
    if (!s) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(s);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a < 1 || b < a || b > pageCount) return null;
      groups.push(Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k));
    } else if (/^\d+$/.test(s)) {
      const n = +s;
      if (n < 1 || n > pageCount) return null;
      groups.push([n - 1]);
    } else return null;
  }
  return groups.length ? groups : null;
}

export function splitGroups(mode: "single" | "every" | "ranges", pageCount: number, every: number, ranges: string): number[][] | null {
  if (mode === "single") return Array.from({ length: pageCount }, (_, i) => [i]);
  if (mode === "every") {
    const n = Math.max(1, every);
    const out: number[][] = [];
    for (let i = 0; i < pageCount; i += n) out.push(Array.from({ length: Math.min(n, pageCount - i) }, (_, k) => i + k));
    return out;
  }
  return parseRanges(ranges, pageCount);
}

export interface CompressionPreset {
  id: "alta" | "media" | "bassa";
  label: string;
  description: string;
  quality: number;
  maxSide: number;
}

export const PRESETS: CompressionPreset[] = [
  { id: "alta", label: "Qualità alta", description: "Immagini quasi identiche, file un po' più leggero.", quality: 85, maxSide: 2800 },
  { id: "media", label: "Equilibrata", description: "Buon compromesso per email e condivisione.", quality: 65, maxSide: 1800 },
  { id: "bassa", label: "Massima compressione", description: "File molto leggero, immagini più sgranate.", quality: 45, maxSide: 1100 },
];

/**
 * Riduce le dimensioni ricomprimendo le immagini. Il testo resta testo (selezionabile e ricercabile).
 * Lavora su una copia: il documento aperto non cambia.
 */
export async function compress(doc: PlicoDoc, preset: CompressionPreset, onProgress?: Progress): Promise<Uint8Array> {
  const pdf = openPdf(toBytes(doc.pdf, ""));
  const n = pdf.countObjects();

  // le maschere di trasparenza non vanno ricodificate
  const masks = new Set<number>();
  for (let i = 1; i < n; i++) {
    const ref = pdf.newIndirect(i);
    if (!ref.isStream() || !isImage(ref)) continue;
    const sm = ref.get("SMask");
    if (sm.isIndirect()) masks.add(sm.asIndirect());
    const m = ref.get("Mask");
    if (m.isIndirect()) masks.add(m.asIndirect());
  }

  for (let i = 1; i < n; i++) {
    onProgress?.(i, n - 1);
    if (i % 4 === 0) await tick();
    const ref = pdf.newIndirect(i);
    if (!ref.isStream() || !isImage(ref) || masks.has(i)) continue;
    try {
      recompressImage(pdf, ref, preset);
    } catch {
      /* se un'immagine non si lascia ricodificare la lascio com'è */
    }
  }
  return toBytes(pdf);
}

function isImage(ref: mupdf.PDFObject): boolean {
  const sub = ref.get("Subtype");
  return !sub.isNull() && sub.isName() && sub.asName() === "Image";
}

function recompressImage(pdf: mupdf.PDFDocument, ref: mupdf.PDFObject, preset: CompressionPreset) {
  const img = pdf.loadImage(ref);
  if (img.getImageMask() || img.getMask()) return;
  const w = img.getWidth(), h = img.getHeight();
  if (w * h < 40000) return;
  const oldLen = ref.readRawStream().getLength();

  const comps = img.getNumberOfComponents();
  const gray = comps === 1;
  const cs = gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
  const k = Math.min(1, preset.maxSide / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));

  const pm = new mupdf.Pixmap(cs, [0, 0, nw, nh], false);
  pm.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(nw / w, nh / h), pm);
  dev.fillImage(img, [w, 0, 0, -h, 0, h], 1);
  dev.close();
  dev.destroy();
  const jpeg = pm.asJPEG(preset.quality);
  pm.destroy();
  if (jpeg.length >= oldLen) return;

  ref.writeRawStream(jpeg);
  ref.put("Filter", pdf.newName("DCTDecode"));
  ref.delete("DecodeParms");
  ref.put("Width", nw);
  ref.put("Height", nh);
  ref.put("BitsPerComponent", 8);
  ref.put("ColorSpace", pdf.newName(gray ? "DeviceGray" : "DeviceRGB"));
  ref.delete("Decode");
}

/** Copia cifrata (AES-256) con password di apertura. */
export function protect(doc: PlicoDoc, userPassword: string, ownerPassword?: string): Uint8Array {
  const owner = ownerPassword || userPassword;
  return toBytes(doc.pdf, `encrypt=aes-256,user-password=${userPassword},owner-password=${owner},compress=yes,garbage=compact`);
}

export type ImageFormat = "png" | "jpeg";

export async function* renderImages(
  doc: PlicoDoc,
  pages: number[],
  format: ImageFormat,
  dpi: number,
  baseName: string,
): AsyncGenerator<{ name: string; bytes: Uint8Array; done: number }> {
  const digits = String(doc.pageCount).length;
  let done = 0;
  for (const i of pages) {
    const pm = doc.page(i).toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    const bytes = format === "png" ? pm.asPNG().slice() : pm.asJPEG(90).slice();
    pm.destroy();
    const num = String(i + 1).padStart(digits, "0");
    yield { name: `${baseName} – pagina ${num}.${format === "png" ? "png" : "jpg"}`, bytes, done: ++done };
    await tick();
  }
}

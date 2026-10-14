import { PlicoDoc } from "../engine/plicoDoc";
import * as A from "../engine/annotations";
import * as T from "../engine/tools";
import * as platform from "../platform";
import { activeDoc, addRecent, removeRecent, toast, useStore } from "./store";
import { viewerApi } from "./viewerApi";

const st = () => useStore.getState();
export const currentDoc = () => activeDoc(st());

export const stripPdf = (n: string) => n.replace(/\.pdf$/i, "");

// ---------- documenti ----------

export async function openPicked(files: platform.PickedFile[]) {
  for (const f of files) {
    const existing = f.path ? st().docs.find((d) => d.path === f.path) : null;
    if (existing) { activate(existing.id); addRecent(f.path, f.name); continue; }
    try {
      const doc = PlicoDoc.open(f.bytes, f.name, f.path);
      st().patch({ docs: [...st().docs, doc] });
      activate(doc.id);
      addRecent(f.path, f.name);
    } catch (e) {
      toast(`Impossibile aprire “${f.name}”: ${(e as Error).message}`);
    }
  }
}

export async function openDialog() {
  openPicked(await platform.pickPdfs(true));
}

/** Riapre un file dall'elenco dei recenti; se non c'è più lo toglie dall'elenco. */
export async function openRecent(path: string) {
  try {
    await openPicked([await platform.readPath(path)]);
  } catch {
    removeRecent(path);
    toast("Il file non si trova più: l'ho tolto dai recenti");
  }
}

export async function openPaths(paths: string[]) {
  const files: platform.PickedFile[] = [];
  for (const p of paths) {
    if (!/\.pdf$/i.test(p)) continue;
    try { files.push(await platform.readPath(p)); } catch (e) { toast(`Impossibile leggere ${p}`); }
  }
  await openPicked(files);
}

export function newDocument() {
  const doc = PlicoDoc.blank(`Senza titolo ${st().docs.filter((d) => !d.path).length + 1}`);
  st().patch({ docs: [...st().docs, doc] });
  activate(doc.id);
}

export function activate(id: string) {
  const prev = currentDoc();
  if (prev) (prev as any).viewPage = st().currentPage;
  const doc = st().docs.find((d) => d.id === id);
  const page = ((doc as any)?.viewPage as number) ?? 0;
  st().patch({
    activeId: id, currentPage: page, selectedPages: [page], selection: null, selectedAnnot: null,
    hits: [], hitIndex: 0, searchQuery: "", tool: "select",
  });
  if (doc) platform.setWindowTitle(doc.name);
  requestAnimationFrame(() => viewerApi.scrollToPage(page));
}

export async function saveDoc(doc: PlicoDoc, forceDialog = false): Promise<boolean> {
  try {
    let saved: platform.Saved | null;
    const bytes = doc.toBytes();
    if (doc.path && !forceDialog) {
      await platform.writePath(doc.path, bytes);
      saved = { path: doc.path, name: doc.name };
    } else {
      saved = await platform.saveAs(bytes, stripPdf(doc.name) + ".pdf");
    }
    if (!saved) return false;
    doc.markSaved(saved.path ?? undefined, saved.name);
    addRecent(saved.path, saved.name);
    if (doc.id === st().activeId) platform.setWindowTitle(doc.name);
    toast("Salvato");
    return true;
  } catch (e) {
    toast(`Salvataggio non riuscito: ${(e as Error).message}`);
    return false;
  }
}

/** Condivide il PDF com'è adesso, anche con modifiche non ancora salvate. */
export async function shareDoc(doc: PlicoDoc, anchor: DOMRect) {
  try {
    const name = stripPdf(doc.name) + ".pdf";
    if (!(await platform.shareFile(doc.toBytes(), name, anchor))) {
      platform.download(doc.toBytes(), name, "application/pdf");
      toast("Condivisione non disponibile qui: ho scaricato il file");
    }
  } catch (e) {
    toast(`Condivisione non riuscita: ${(e as Error).message}`);
  }
}

export async function closeDoc(id: string): Promise<boolean> {
  const doc = st().docs.find((d) => d.id === id);
  if (!doc) return true;
  if (doc.dirty) {
    const choice = await platform.askSave(doc.name);
    if (choice === "cancel") return false;
    if (choice === "save" && !(await saveDoc(doc))) return false;
  }
  const rest = st().docs.filter((d) => d.id !== id);
  st().patch({ docs: rest });
  if (st().activeId === id) {
    const next = rest[rest.length - 1];
    if (next) activate(next.id);
    else { st().patch({ activeId: null, hits: [], searchQuery: "" }); platform.setWindowTitle("Plico"); }
  }
  return true;
}

export async function confirmCloseAll(): Promise<boolean> {
  for (const d of [...st().docs]) {
    if (d.dirty) {
      activate(d.id);
      const choice = await platform.askSave(d.name);
      if (choice === "cancel") return false;
      if (choice === "save" && !(await saveDoc(d))) return false;
    }
  }
  return true;
}

// ---------- pagine ----------

export function targetPages(doc: PlicoDoc): number[] {
  const { selectedPages, currentPage } = st();
  const valid = selectedPages.filter((p) => p < doc.pageCount).sort((a, b) => a - b);
  return valid.length ? valid : [Math.min(currentPage, doc.pageCount - 1)];
}

export function rotate(delta: number, pages?: number[]) {
  const doc = currentDoc(); if (!doc) return;
  doc.rotate(pages ?? targetPages(doc), delta);
}

export function deletePages(pages?: number[]) {
  const doc = currentDoc(); if (!doc) return;
  const list = pages ?? targetPages(doc);
  if (!doc.deletePages(list)) { toast("Un documento deve avere almeno una pagina."); return; }
  const page = Math.min(list[0], doc.pageCount - 1);
  st().patch({ selectedPages: [page], currentPage: page, selectedAnnot: null });
}

export function duplicatePages(pages?: number[]) {
  const doc = currentDoc(); if (!doc) return;
  const list = pages ?? targetPages(doc);
  doc.duplicatePages(list);
  const last = list[list.length - 1];
  st().patch({ selectedPages: list.map((_, k) => last + 1 + k) });
}

export function insertBlank() {
  const doc = currentDoc(); if (!doc) return;
  const after = targetPages(doc).slice(-1)[0];
  doc.insertBlank(after);
  st().patch({ selectedPages: [after + 1] });
  requestAnimationFrame(() => viewerApi.scrollToPage(after + 1));
}

export async function insertFromPdfs(files?: platform.PickedFile[], at?: number) {
  const doc = currentDoc(); if (!doc) return;
  const picked = files ?? (await platform.pickPdfs(true));
  let pos = at ?? targetPages(doc).slice(-1)[0] + 1;
  const first = pos;
  for (const f of picked) {
    try {
      const src = T.openPdf(f.bytes);
      if (src.needsPassword()) { toast(`“${f.name}” è protetto da password: toglila prima di inserirlo.`); continue; }
      const n = src.countPages();
      doc.insertDocument(src, pos);
      pos += n;
    } catch (e) { toast(`Impossibile inserire “${f.name}”`); }
  }
  if (pos > first) {
    st().patch({ selectedPages: Array.from({ length: pos - first }, (_, k) => first + k) });
    requestAnimationFrame(() => viewerApi.scrollToPage(first));
  }
}

export function reorderPages(pages: number[], insertBefore: number) {
  const doc = currentDoc(); if (!doc) return;
  const n = doc.pageCount;
  const moving = [...pages].sort((a, b) => a - b);
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !moving.includes(i));
  const before = moving.filter((i) => i < insertBefore).length;
  const at = insertBefore - before;
  const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (order.every((v, i) => v === i)) return;
  doc.reorder(order);
  st().patch({ selectedPages: moving.map((_, k) => at + k) });
}

export async function extractPages(pages?: number[]) {
  const doc = currentDoc(); if (!doc) return;
  const list = pages ?? targetPages(doc);
  const bytes = T.extractPages(doc, list);
  const r = await platform.saveAs(bytes, `${stripPdf(doc.name)} – estratto.pdf`);
  if (r) toast(`Esportate ${list.length} pagine`);
}

export function resetCrop() {
  const doc = currentDoc(); if (!doc) return;
  doc.resetCrop(targetPages(doc));
}

// ---------- annotazioni ----------

export function styleOf(): A.Style {
  const s = st();
  return { color: s.color, width: s.width, fontSize: s.fontSize };
}

export function deleteSelectedAnnotation() {
  const doc = currentDoc(); const sel = st().selectedAnnot;
  if (!doc || !sel) return;
  A.deleteAnnotation(doc, sel.page, sel.id);
  st().patch({ selectedAnnot: null });
}

export function applyStyleToSelection(patch: Partial<A.Style>) {
  const doc = currentDoc(); const sel = st().selectedAnnot;
  if (!doc || !sel) return;
  A.setAnnotationStyle(doc, sel.page, sel.id, patch);
}

// ---------- annulla / ripristina ----------

export function undo() {
  const doc = currentDoc(); if (!doc) return;
  doc.undo();
  st().patch({ selectedAnnot: null, selection: null, selectedPages: st().selectedPages.filter((p) => p < doc.pageCount) });
}

export function redo() {
  const doc = currentDoc(); if (!doc) return;
  doc.redo();
  st().patch({ selectedAnnot: null, selection: null });
}

// ---------- ricerca ----------

let searchTimer: number | undefined;
export function setSearchQuery(q: string) {
  st().patch({ searchQuery: q });
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => runSearch(q), 250);
}

export function runSearch(q: string) {
  const doc = currentDoc();
  if (!doc || !q.trim()) { st().patch({ hits: [], hitIndex: 0 }); return; }
  const hits = doc.search(q);
  st().patch({ hits, hitIndex: 0, sidebar: true, sidebarMode: "search" });
  if (hits[0]) showHit(0);
}

export function showHit(i: number) {
  const { hits } = st();
  if (!hits.length) return;
  const idx = ((i % hits.length) + hits.length) % hits.length;
  st().patch({ hitIndex: idx });
  const h = hits[idx];
  const xs = h.quads.flatMap((q) => [q[0], q[2], q[4], q[6]]), ys = h.quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  viewerApi.reveal(h.page, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
}

/** Stampa: disegno le pagine come immagini in un contenitore visibile solo in stampa. */
export async function printDoc() {
  const doc = currentDoc();
  if (!doc) return;
  st().patch({ busy: "Preparo la stampa…" });
  await new Promise((r) => setTimeout(r, 30));
  const root = document.createElement("div");
  root.id = "print-root";
  try {
    for (let i = 0; i < doc.pageCount; i++) {
      const img = doc.render(i, 150 / 72);
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.putImageData(img, 0, 0);
      const el = document.createElement("img");
      el.src = c.toDataURL("image/jpeg", 0.92);
      root.appendChild(el);
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    document.body.appendChild(root);
    document.body.classList.add("printing");
    await new Promise((r) => setTimeout(r, 200));
    await platform.printPage();
  } finally {
    document.body.classList.remove("printing");
    root.remove();
    st().patch({ busy: null });
  }
}

// ---------- app predefinita per i PDF ----------

/** Imposta Plico come app dei PDF (su Mac subito, su Windows apre le Impostazioni dove sceglierla). */
export async function makeDefaultPdfApp() {
  try {
    await platform.setDefaultPdfApp();
    if (platform.isMac) {
      toast((await platform.isDefaultPdfApp()) ? "Ora i PDF si aprono con Plico" : "Il Mac non ha cambiato l'app: riprova dalle Informazioni del file", 4000);
    } else {
      toast("Nelle Impostazioni scegli Plico per i file .pdf", 6000);
    }
  } catch (e) {
    toast(`Non sono riuscito a cambiare l'app dei PDF: ${(e as Error)?.message ?? e}`, 5000);
  }
}

/** Al primo avvio chiede (una volta sola) se usare Plico per tutti i PDF. */
export async function offerDefaultPdfApp() {
  if (!platform.isTauri) return;
  try {
    if (localStorage.getItem("plico.askedDefault")) return;
    if ((await platform.isDefaultPdfApp()) === true) return;
    localStorage.setItem("plico.askedDefault", "1");
  } catch { return; }
  const ok = await platform.confirmDialog(
    "Vuoi usare Plico per aprire tutti i PDF?\n\nPuoi cambiare idea quando vuoi dalla schermata iniziale.",
    platform.isMac ? "Usa Plico" : "Scegli nelle Impostazioni",
    "Non ora",
  );
  if (ok) await makeDefaultPdfApp();
}

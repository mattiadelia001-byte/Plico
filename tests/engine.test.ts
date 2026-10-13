import fs from "node:fs";
import { FolioDoc, graftPage } from "../src/engine/folioDoc";
import * as A from "../src/engine/annotations";
import * as T from "../src/engine/tools";

// piccoli sostituti delle API del browser usate dal motore
(globalThis as any).ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
(globalThis as any).document = { createElement: () => ({ getContext: () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) }) };

const S = "/private/tmp/claude-501/-Users-mattiadelia/7bc49944-6ef6-4328-ab30-7bc23c5918e9/scratchpad";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
const load = (p: string) => new Uint8Array(fs.readFileSync(p));

const doc = FolioDoc.open(load(S + "/real.pdf"), "real.pdf");
ok(doc.pageCount === 3, "apre il documento (3 pagine)");
ok(doc.size(0)[0] === 595, "dimensioni pagina");
const img = doc.render(0, 2);
ok(img.width === 1190 && img.height === 1684, "rendering a 2x: " + img.width + "x" + img.height);
let nonWhite = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 200) nonWhite++;
ok(nonWhite > 1000, "la pagina contiene testo disegnato");

// rotazione e annulla
doc.rotate([0], 90);
ok(doc.size(0)[0] === 842, "ruota di 90°");
doc.undo();
ok(doc.size(0)[0] === 595, "annulla rotazione");
doc.redo();
ok(doc.size(0)[0] === 842, "ripristina rotazione");
doc.undo();

// elimina / annulla
ok(doc.deletePages([1]) && doc.pageCount === 2, "elimina pagina");
doc.undo();
ok(doc.pageCount === 3, "annulla eliminazione");
ok(!doc.deletePages([0, 1, 2]), "non elimina tutte le pagine");

// pagina vuota
doc.insertBlank(0);
ok(doc.pageCount === 4 && !doc.stext(1).asText().trim(), "inserisce pagina vuota dopo la prima");
doc.undo();

// annotazioni
const style: A.Style = { color: "#ff0000", width: 3, fontSize: 16 };
const hit = doc.search("Capitolo 1")[0];
ok(hit && hit.page === 0, "ricerca: trovato 'Capitolo 1' a pagina 1, snippet: " + JSON.stringify(hit?.snippet));
A.createMarkup(doc, 0, "Highlight", hit.quads, "#ffe000");
const hlAp = () => doc.page(0).getAnnotations().find((x) => x.getType() === "Highlight")!.getObject().get("AP").get("N").readStream().asString();
ok(!/ c\n/.test(hlAp()) && /\bf\b/.test(hlAp()), "l'evidenziazione ha gli estremi squadrati (nessuna curva nel disegno)");
const hlRect = A.listAnnotations(doc, 0).find((x) => x.ref.type === "Highlight")!.ref.bounds;
const fullH = hit.quads[0][5] - hit.quads[0][1];
ok(hlRect[3] - hlRect[1] < fullH * 0.92, "la barra è più bassa del riquadro del carattere (" + (hlRect[3] - hlRect[1]).toFixed(1) + " pt contro " + fullH.toFixed(1) + ")");
const sq = A.createShape(doc, 0, "Square", [100, 300, 220, 380], style);
const ln = A.createLine(doc, 0, [100, 420], [260, 480], true, style);
const ink = A.createInk(doc, 0, [[[300, 300], [340, 340], [380, 300]]], style);
const ft = A.createFreeText(doc, 0, [300, 420], "Ciao Folio", style);
const nt = A.createNote(doc, 0, [450, 120], "Una nota", "#ffcc00");
let list = A.listAnnotations(doc, 0);
ok(list.length === 6, "crea 6 annotazioni (" + list.map((l) => l.ref.type).join(",") + ")");
ok(A.hitTest(doc, 0, [150, 340], 3, false)?.id === sq, "hit-test sul rettangolo");
ok(A.hitTest(doc, 0, [180, 450], 3, false)?.id === ln, "hit-test sulla linea");
ok(A.hitTest(doc, 0, [10, 10], 3, false) === null, "hit-test a vuoto");
ok(A.hitTest(doc, 0, [80, 60], 3, false) === null && A.hitTest(doc, 0, [80, 60], 3, true)?.type === "Highlight", "evidenziazione selezionabile solo se richiesto");

const before = A.listAnnotations(doc, 0).find((l) => l.ref.id === sq)!.ref.bounds;
A.moveAnnotation(doc, 0, sq, 20, 10);
const moved = A.listAnnotations(doc, 0).find((l) => l.ref.id === sq)!.ref.bounds;
ok(Math.abs(moved[0] - before[0] - 20) < 0.5 && Math.abs(moved[1] - before[1] - 10) < 0.5, "sposta rettangolo");
A.moveAnnotation(doc, 0, ink, 15, 15);
A.moveAnnotation(doc, 0, ln, -10, 5);
A.resizeAnnotation(doc, 0, sq, [100, 300, 300, 500]);
ok(A.listAnnotations(doc, 0).find((l) => l.ref.id === sq)!.ref.bounds[2] > 290, "ridimensiona rettangolo");
const inkB = A.listAnnotations(doc, 0).find((l) => l.ref.id === ink)!.ref.bounds;
A.resizeAnnotation(doc, 0, ink, [inkB[0], inkB[1], inkB[0] + (inkB[2] - inkB[0]) * 2, inkB[3]]);
ok(Math.abs(A.listAnnotations(doc, 0).find((l) => l.ref.id === ink)!.ref.bounds[2] - (inkB[0] + (inkB[2] - inkB[0]) * 2)) < 1.5, "ridimensiona disegno");
A.setAnnotationStyle(doc, 0, A.listAnnotations(doc, 0).find((x) => x.ref.type === "Highlight")!.ref.id, { color: "#00cc44" });
ok(!/ c\n/.test(hlAp()) && hlAp().includes("0 0.8 0.26") || !/ c\n/.test(hlAp()), "cambiando colore l'evidenziazione resta squadrata");
A.setAnnotationStyle(doc, 0, sq, { color: "#0000ff", width: 6 });
const st = A.listAnnotations(doc, 0).find((l) => l.ref.id === sq)!.ref;
ok(st.color === "#0000ff" && st.width === 6, "cambia colore e spessore: " + st.color + " " + st.width);
A.setAnnotationText(doc, 0, ft, "Testo modificato\nsu due righe");
ok(A.listAnnotations(doc, 0).find((l) => l.ref.id === ft)!.ref.contents.includes("modificato"), "modifica testo");
A.setAnnotationStyle(doc, 0, ft, { color: "#008800", fontSize: 24 });
const ftr = A.listAnnotations(doc, 0).find((l) => l.ref.id === ft)!.ref;
ok(ftr.fontSize === 24 && ftr.color === "#008800", "stile testo libero: " + ftr.fontSize + " " + ftr.color);
A.deleteAnnotation(doc, 0, nt);
ok(A.listAnnotations(doc, 0).length === 5, "elimina nota");
doc.undo();
ok(A.listAnnotations(doc, 0).length === 6, "annulla eliminazione nota");
const sig: A.Signature = { id: "s", strokes: [[[0, 0.5], [0.3, 0.1], [0.6, 0.9], [1, 0.4]]], aspect: 3 };
A.createSignature(doc, 0, sig, [300, 600], 150, "#000000");
ok(A.listAnnotations(doc, 0).length === 7, "inserisce firma");

// salvataggio e riapertura
const saved = doc.toBytes();
const re = FolioDoc.open(saved, "saved.pdf");
ok(A.listAnnotations(re, 0).length === 7, "le annotazioni sopravvivono al salvataggio e alla riapertura");

// duplicazione e unione mantengono le annotazioni
doc.duplicatePages([0]);
ok(doc.pageCount === 4 && A.listAnnotations(doc, 1).length === 7, "duplica pagina con annotazioni (" + A.listAnnotations(doc, 1).length + ")");
doc.undo();
const merged = FolioDoc.open(await T.merge([{ pdf: re.pdf }, { pdf: FolioDoc.open(load(S + "/real.pdf"), "x").pdf }]), "merged");
ok(merged.pageCount === 6 && A.listAnnotations(merged, 0).length === 7, "unisce due PDF mantenendo le annotazioni");

// inserimento PDF e riordino
const n0 = doc.pageCount;
doc.insertDocument(re.pdf, 3);
ok(doc.pageCount === n0 + 3, "inserisce un PDF in coda");
doc.undo();
ok(doc.pageCount === n0, "annulla inserimento");
const t0 = doc.stext(0).asText().trim().slice(0, 10);
doc.reorder([1, 2, 0]);
ok(doc.stext(2).asText().trim().slice(0, 10) === t0, "riordina le pagine");
doc.undo();
ok(doc.stext(0).asText().trim().slice(0, 10) === t0, "annulla riordino");

// dividi
ok(JSON.stringify(T.parseRanges("1-2, 3", 3)) === "[[0,1],[2]]", "intervalli validi");
ok(T.parseRanges("1-9", 3) === null && T.parseRanges("abc", 3) === null, "intervalli non validi");
ok(T.splitGroups("every", 5, 2, "")!.length === 3, "dividi ogni 2 pagine");
const ex = FolioDoc.open(T.extractPages(doc, [0, 2]), "ex");
ok(ex.pageCount === 2, "estrae pagine");

// compressione
const big = FolioDoc.open(load(S + "/t/sample.pdf"), "sample.pdf");
for (const p of T.PRESETS) {
  const out = await T.compress(big, p);
  const chk = FolioDoc.open(out, "c");
  ok(out.length < 7691882 / 2 && chk.stext(0).asText().includes("Hello"), "compressione '" + p.label + "': " + (out.length / 1024).toFixed(0) + " KB, testo mantenuto");
}

// password
const prot = FolioDoc.open(T.protect(doc, "segreto"), "p");
ok(prot.locked && prot.pageCount === 0, "copia protetta chiede la password");
ok(!prot.unlock("sbagliata") && prot.locked, "password errata rifiutata");
ok(prot.unlock("segreto") && prot.pageCount === 3, "password giusta sblocca");

// metadati
doc.setMeta({ "info:Title": "Titolo di prova", "info:Author": "Mattia" });
ok(FolioDoc.open(doc.toBytes(), "m").getMeta("info:Title") === "Titolo di prova", "metadati salvati");

// immagini
let count = 0;
for await (const r of T.renderImages(doc, [0, 1], "png", 72, "doc")) { count++; ok(r.bytes.length > 500 && r.name.endsWith(".png"), "immagine " + r.name); }
ok(count === 2, "esporta immagini");

// ritaglio: la zona scelta deve coincidere con quella che resta, anche con pagina ruotata o già ritagliata
for (const rot of [0, 90, 180, 270]) {
  const d = FolioDoc.open(load(S + "/real.pdf"), "crop.pdf");
  if (rot) d.rotate([0], rot);
  const full = d.render(0, 1);
  const same = (a: ImageData, b: ImageData, ox: number, oy: number) => {
    let bad = 0;
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++)
      if (Math.abs(a.data[((y + oy) * a.width + x + ox) * 4] - b.data[(y * b.width + x) * 4]) > 40) bad++;
    return bad === 0;
  };
  d.setCropBox(0, [100, 150, 300, 350]);
  const c1 = d.render(0, 1);
  ok(d.size(0)[0] === 200 && d.size(0)[1] === 200 && same(full, c1, 100, 150), `ritaglio nel punto giusto (rotazione ${rot}°)`);
  d.setCropBox(0, [20, 30, 120, 130]);
  ok(d.size(0)[0] === 100 && same(c1, d.render(0, 1), 20, 30), `secondo ritaglio sopra il primo (rotazione ${rot}°)`);
}

// documento nuovo
const blank = FolioDoc.blank();
ok(blank.pageCount === 1 && blank.size(0)[1] === 842, "documento nuovo A4");

console.log(fails === 0 ? "TUTTI I TEST SUPERATI" : fails + " TEST FALLITI");
process.exit(fails ? 1 : 0);

import fs from "node:fs";
const mupdf = await import(new URL("../../node_modules/mupdf/dist/mupdf.js", import.meta.url).href);
import { launch, openPdf, ok, done, shot, PDF, SAMPLE } from "./lib.mjs";

const { browser, page, errors } = await launch();
await openPdf(page);

const pageCount = async () => +(await page.getByTestId("page-count").textContent()).replace(/\D/g, "");
const menu = async (testId, label) => { await page.getByTestId(testId).click(); await page.getByRole("menuitem", { name: label }).click(); await page.waitForTimeout(300); };
const dl = async (action, match = /./) => { const [d] = await Promise.all([page.waitForEvent("download", { predicate: (x) => match.test(x.suggestedFilename()) }), action()]); const p = d.suggestedFilename(); console.log("  (download:", p, ")"); const path = "/tmp/claude-501/dl-" + Date.now() + "-" + p; await d.saveAs(path); return { name: p, path, bytes: new Uint8Array(fs.readFileSync(path)) }; };
const open = (bytes) => mupdf.Document.openDocument(bytes, "application/pdf");

// duplica / elimina / annulla
await page.getByTestId("thumb-0").click();
await menu("menu-pages", /Duplica/);
ok((await pageCount()) === 4, "duplica pagina: 4 pagine");
await page.getByTestId("undo").click(); await page.waitForTimeout(200);
ok((await pageCount()) === 3, "annulla duplicazione: 3 pagine");
await page.getByTestId("thumb-1").click();
await menu("menu-pages", /Elimina pagine/);
ok((await pageCount()) === 2, "elimina pagina: 2 pagine");
await page.getByTestId("undo").click(); await page.waitForTimeout(200);
ok((await pageCount()) === 3, "annulla eliminazione");

// pagina vuota
await page.getByTestId("thumb-0").click();
await menu("menu-pages", /pagina vuota/);
ok((await pageCount()) === 4, "inserisce pagina vuota");
await page.getByTestId("undo").click(); await page.waitForTimeout(200);

// ruota
const before = await page.getByTestId("page-0").boundingBox();
await page.getByTestId("thumb-0").click();
await page.getByTestId("rotate-right").click(); await page.waitForTimeout(400);
const after = await page.getByTestId("page-0").boundingBox();
ok(after.width > after.height * 0.9 || Math.abs(after.width / after.height - before.height / before.width) < 0.05, `ruota: ${Math.round(before.width)}x${Math.round(before.height)} → ${Math.round(after.width)}x${Math.round(after.height)}`);
await page.getByTestId("undo").click(); await page.waitForTimeout(300);

// riordina trascinando la miniatura 1 sotto la 3
await page.getByTestId("thumb-0").dragTo(page.getByTestId("thumb-2"), { targetPosition: { x: 70, y: 170 } });
await page.waitForTimeout(400);
await page.getByTestId("search-input").fill("Capitolo 1");
await page.waitForTimeout(700);
const hitPage = (await page.locator('[data-testid=results] small').first().textContent()).replace(/\D/g, "");
ok(hitPage === "3", "riordino con trascinamento: «Capitolo 1» ora è a pagina " + hitPage);
await page.getByTestId("search-input").press("Escape");
await page.getByTestId("undo").click(); await page.waitForTimeout(300);
await page.getByTestId("search-input").fill(""); await page.waitForTimeout(400);
await page.getByTestId("side-thumbs").click(); await page.waitForTimeout(200);

// selezione multipla + estrai
await page.getByTestId("thumb-0").click();
await page.getByTestId("thumb-1").click({ modifiers: ["Shift"] });
const sel = await page.locator(".thumb.selected").count();
ok(sel === 2, "selezione multipla con Maiusc (" + sel + ")");

// ----- esportazioni -----
const split = await (async () => {
  await page.getByTestId("menu-export").click(); await page.getByRole("menuitem", { name: /Dividi/ }).click();
  const files = [];
  const onDl = async (d) => { const p = "/tmp/claude-501/split-" + d.suggestedFilename(); await d.saveAs(p); files.push(p); };
  page.on("download", onDl);
  await page.getByTestId("split-run").click();
  await page.waitForTimeout(2000);
  page.off("download", onDl);
  return files;
})();
ok(split.length === 3 && open(new Uint8Array(fs.readFileSync(split[0]))).countPages() === 1, "dividi: " + split.length + " file da una pagina");

const imgs = await dl(async () => { await page.getByTestId("menu-export").click(); await page.getByRole("menuitem", { name: /immagini/ }).click(); await page.getByTestId("images-run").click(); }, /pagina 1/);
ok(imgs.name.endsWith(".png") && imgs.bytes.length > 2000, "esporta immagini: " + imgs.name);

const prot = await dl(async () => { await page.getByTestId("menu-export").click(); await page.getByRole("menuitem", { name: /password/ }).click(); await page.getByTestId("pw1").fill("segreto"); await page.getByTestId("pw2").fill("segreto"); await page.getByTestId("protect-run").click(); }, /protetto/);
ok(open(prot.bytes).needsPassword(), "copia con password: chiede la password");

// apro la copia protetta e la sblocco dall'interfaccia
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTitle("Apri", { exact: true }).first().click()]);
await chooser.setFiles(prot.path);
await page.waitForSelector('[data-testid="unlock-input"]');
await page.getByTestId("unlock-input").fill("sbagliata"); await page.getByTestId("unlock-run").click();
ok(await page.getByText("Password errata").count() === 1, "password errata rifiutata");
await page.getByTestId("unlock-input").fill("segreto"); await page.getByTestId("unlock-run").click();
await page.waitForSelector("canvas.page-canvas");
ok((await pageCount()) === 3, "password giusta: documento aperto");
await page.waitForTimeout(300);
await shot(page, "20-unlocked");

// ----- compressione -----
const [ch2] = await Promise.all([page.waitForEvent("filechooser"), page.getByTitle("Apri", { exact: true }).first().click()]);
await ch2.setFiles(SAMPLE);
await page.waitForSelector("canvas.page-canvas"); await page.waitForTimeout(400);
const comp = await dl(async () => { await page.getByTestId("menu-export").click(); await page.getByRole("menuitem", { name: /Riduci/ }).click(); await page.getByText("Massima compressione").click(); await page.getByTestId("compress-run").click(); }, /ridotto/);
const orig = fs.statSync(SAMPLE).size;
ok(comp.bytes.length < orig / 5, `compressione: ${(orig / 1024).toFixed(0)} KB → ${(comp.bytes.length / 1024).toFixed(0)} KB`);
await page.waitForSelector('[data-testid="compress-result"]');
ok(true, "messaggio: " + await page.getByTestId("compress-result").textContent());
await page.keyboard.press("Escape");

// ----- unisci -----
await page.getByTestId("menu-file").click(); await page.getByRole("menuitem", { name: /Unisci/ }).click();
const [ch3] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("merge-add").click()]);
await ch3.setFiles([PDF, PDF]);
await page.waitForSelector('[data-testid="merge-list"] li');
ok((await page.locator('[data-testid="merge-list"] li').count()) === 2, "unisci: due file in elenco");
await shot(page, "21-merge");
await page.getByTestId("merge-run").click();
await page.waitForTimeout(800);
ok((await pageCount()) === 6 && (await page.locator(".tab-name").last().textContent()).includes("PDF unito"), "unisci: nuova scheda con 6 pagine");

// ----- firma -----
await page.getByTestId("toggle-markup").click();
await page.getByTestId("tool-signature").click();
await page.waitForSelector('[data-testid="sig-canvas"]');
const sc = await page.getByTestId("sig-canvas").boundingBox();
await page.mouse.move(sc.x + 40, sc.y + 110); await page.mouse.down();
for (let i = 0; i < 40; i++) await page.mouse.move(sc.x + 40 + i * 8, sc.y + 90 + Math.sin(i / 2.5) * 35);
await page.mouse.up();
await page.getByTestId("sig-save").click();
await page.waitForTimeout(200);
const pb = await page.getByTestId("page-0").boundingBox();
await page.mouse.click(pb.x + pb.width / 2, pb.y + 250);
await page.waitForTimeout(300);
await page.getByTestId("side-annots").click();
ok(await page.locator("[data-testid=annot-list] strong", { hasText: "Disegno" }).count() === 1, "firma inserita come annotazione");
await shot(page, "22-signature");

// ----- ritaglio -----
await page.getByTestId("tool-crop").click();
const pb2 = await page.getByTestId("page-1").boundingBox().catch(() => null);
await page.getByTestId("page-input").fill("1"); await page.getByTestId("page-input").press("Enter"); await page.waitForTimeout(300);
const p0 = await page.getByTestId("page-0").boundingBox();
await page.mouse.move(p0.x + 60, p0.y + 60); await page.mouse.down(); await page.mouse.move(p0.x + 360, p0.y + 400, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(400);
const p0b = await page.getByTestId("page-0").boundingBox();
ok(p0b.width < p0.width * 0.6, `ritaglio: larghezza ${Math.round(p0.width)} → ${Math.round(p0b.width)}`);

// ----- salvataggio -----
await page.getByTestId("tool-select").click();
const saved = await dl(async () => { await page.keyboard.press("Control+s").catch(() => {}); await page.keyboard.press("Meta+s"); }, /unito/);
const sd = open(saved.bytes);
ok(sd.countPages() === 6, "salvataggio: file con 6 pagine (" + saved.name + ")");
ok(sd.asPDF().loadPage(0).getAnnotations().length >= 1, "salvataggio: annotazioni presenti nel file");

// ----- layout e tema scuro -----
await page.getByTestId("menu-zoom").click(); await page.getByRole("menuitem", { name: /Due pagine/ }).click(); await page.waitForTimeout(500);
await shot(page, "23-two-up");
console.log("errori console:", errors.length ? errors : "nessuno");
await browser.close();

const dark = await launch({ dark: true });
await openPdf(dark.page);
await dark.page.getByTestId("toggle-markup").click();
await dark.page.waitForTimeout(300);
await shot(dark.page, "24-dark");
await dark.browser.close();
process.exit(done() || (errors.length ? 1 : 0));

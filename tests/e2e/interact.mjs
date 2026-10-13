import { launch, openPdf, ok, done, shot } from "./lib.mjs";
const { browser, page, errors } = await launch();
await openPdf(page);

// utilità: da punti pagina a pixel schermo
async function pt(pageIndex, x, y) {
  const b = await page.getByTestId(`page-${pageIndex}`).boundingBox();
  const s = b.width / 595;
  return { x: b.x + x * s, y: b.y + y * s, s };
}
const annotCount = () => page.evaluate(() => document.querySelectorAll("[data-testid=annot-list] li").length);
const openAnnotList = async () => { await page.getByTestId("side-annots").click(); await page.waitForTimeout(100); };

// ----- selezione del testo e copia -----
let a = await pt(0, 60, 65), b = await pt(0, 300, 65);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(150);
await shot(page, "10-selection");
const polys = await page.locator("svg.overlay polygon").count();
ok(polys > 0, "selezionando il testo compaiono i riquadri blu (" + polys + ")");
await page.evaluate(() => { (window).__copied = null; window.addEventListener("copy", (e) => { (window).__copied = e.clipboardData.getData("text/plain"); }); });
await page.evaluate(() => document.execCommand("copy"));
await page.waitForTimeout(200);
const clip = await page.evaluate(() => (window).__copied ?? "ERR");
ok(clip.includes("Capitolo"), "copia del testo selezionato: " + JSON.stringify(clip));

// doppio clic = parola
a = await pt(0, 200, 117);
await page.mouse.dblclick(a.x, a.y);
await page.waitForTimeout(150);
ok((await page.locator("svg.overlay polygon").count()) > 0, "doppio clic seleziona una parola");

// ----- ricerca -----
await page.getByTestId("search-input").fill("sezione 2");
await page.waitForTimeout(700);
const count = await page.getByTestId("search-count").textContent();
ok(/\/30/.test(count ?? ""), "ricerca 'sezione 2': " + count);
await page.waitForTimeout(300);
await shot(page, "11-search");
const curPage = await page.getByTestId("page-input").inputValue();
ok(curPage === "2", "la ricerca porta a pagina 2 (pagina " + curPage + ")");
await page.getByTestId("search-input").press("Escape");

// ----- strumenti di annotazione -----
await page.getByTestId("toggle-markup").click();
await page.getByTestId("tool-highlight").click();
await page.evaluate(() => document.querySelector('[data-testid=viewer]').scrollTop = 0);
await page.waitForTimeout(200);
a = await pt(0, 60, 65); b = await pt(0, 200, 65);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(250);
await openAnnotList();
ok((await annotCount()) === 1, "evidenziazione creata con il mouse");
ok(await page.getByTestId("undo").isEnabled(), "annulla è disponibile dopo la modifica");

await page.getByTestId("tool-rect").click();
a = await pt(0, 100, 150); b = await pt(0, 260, 220);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(250);
ok((await annotCount()) === 2, "rettangolo creato");
ok(await page.getByTestId("annot-frame").count() === 1, "il rettangolo appena creato è selezionato");
await shot(page, "12-rect");

// sposta
let c = await pt(0, 180, 185);
await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 120, c.y + 60, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(250);
await shot(page, "13-moved");
// ridimensiona dal pallino
const h = await page.getByTestId("annot-handle").boundingBox();
const hx = h.x + h.width / 2, hy = h.y + h.height / 2;
await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx + 80, hy + 50, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(250);
const h2 = await page.getByTestId("annot-handle").boundingBox();
ok(h2.x - h.x > 60 && h2.y - h.y > 35, `ridimensionato trascinando il pallino (spostamento ${Math.round(h2.x - h.x)}x${Math.round(h2.y - h.y)} px)`);

// annulla in sequenza
await page.getByTestId("undo").click(); await page.getByTestId("undo").click();
await page.waitForTimeout(200);
const h3 = await page.getByTestId("annot-handle").count();
ok((await annotCount()) === 2, "dopo due annulla il rettangolo c'è ancora");
await page.getByTestId("undo").click(); await page.waitForTimeout(200);
ok((await annotCount()) === 1, "terzo annulla elimina il rettangolo");
await page.getByTestId("redo").click(); await page.waitForTimeout(200);
ok((await annotCount()) === 2, "ripristina lo riporta");

// cancella con tasto
await page.getByTestId("tool-select").click();
const c2 = await pt(0, 150, 185);
await page.mouse.click(c2.x, c2.y); await page.waitForTimeout(150);
await page.keyboard.press("Delete"); await page.waitForTimeout(250);
ok((await annotCount()) === 1, "Canc elimina l'annotazione selezionata");

// disegno a mano libera
await page.getByTestId("tool-draw").click();
a = await pt(0, 300, 260);
await page.mouse.move(a.x, a.y); await page.mouse.down();
for (let i = 0; i < 30; i++) await page.mouse.move(a.x + i * 6, a.y + Math.sin(i / 3) * 25);
await page.mouse.up(); await page.waitForTimeout(250);
ok((await annotCount()) === 2, "disegno a mano libera creato");

// freccia
await page.getByTestId("tool-arrow").click();
a = await pt(0, 100, 240); b = await pt(0, 250, 300);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(250);
ok((await annotCount()) === 3, "freccia creata");

// testo con editor in linea
await page.getByTestId("tool-text").click();
a = await pt(0, 300, 200);
await page.mouse.click(a.x, a.y); await page.waitForTimeout(200);
await page.getByTestId("inline-editor").fill("Testo di prova");
await page.getByTestId("inline-editor").press("Control+Enter"); await page.waitForTimeout(300);
ok((await annotCount()) === 4, "testo libero inserito con l'editor in linea");
await shot(page, "14-all-tools");

// note
await page.getByTestId("tool-note").click();
a = await pt(0, 480, 300);
await page.mouse.click(a.x, a.y); await page.waitForTimeout(200);
await page.getByTestId("inline-editor").fill("Una nota"); await page.getByTestId("inline-editor").press("Control+Enter"); await page.waitForTimeout(300);
ok((await annotCount()) === 5, "nota inserita");
const items = await page.locator("[data-testid=annot-list] strong").allTextContents();
console.log("annotazioni:", items.join(", "));

console.log("errori console:", errors.length ? errors : "nessuno");
await browser.close();
process.exit(done() || (errors.length ? 1 : 0));

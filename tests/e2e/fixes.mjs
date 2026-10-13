import { launch, openPdf, ok, done, shot } from "./lib.mjs";
const { browser, page, errors } = await launch();

// ----- 1. il pulsante principale non deve diventare bianco al passaggio del mouse -----
await page.waitForSelector('[data-testid="welcome-open"]');
const btn = page.getByTestId("welcome-open");
const style = () => btn.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color }; });
const parse = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
const before = await style();
await btn.hover(); await page.waitForTimeout(250);
const hov = await style();
await shot(page, "30-hover");
const [r, g, b] = parse(hov.bg);
ok(!(r > 200 && g > 200 && b > 200), `al passaggio il pulsante resta colorato (sfondo ${hov.bg}, testo ${hov.fg})`);
ok(parse(hov.fg).every((v) => v > 240), "la scritta resta bianca e leggibile");

await openPdf(page);
await page.waitForFunction(() => (window).__store);
const pt = async (x, y) => { const bb = await page.getByTestId("page-0").boundingBox(); const s = bb.width / 595; return { x: bb.x + x * s, y: bb.y + y * s }; };
const annots = () => page.evaluate(() => {
  const d = (window).__store.getState().docs[0];
  return d.page(0).getAnnotations().map((a) => ({ type: a.getType(), w: (() => { try { return a.getBorderWidth(); } catch { return -1; } })(), q: a.hasQuadPoints() ? a.getQuadPoints().length : 0 }));
});
await page.getByTestId("toggle-markup").click();
await page.getByTestId("tool-highlight").click();

// ----- 2. evidenziatore: parte anche da punti fuori dalle lettere -----
// dal margine sinistro, nello spazio tra titolo e prima riga, fino a metà della terza riga
let a = await pt(30, 98), c = await pt(300, 165);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(300);
let list = await annots();
ok(list.length === 1 && list[0].type === "Highlight", "trascinando da fuori le lettere l'evidenziazione si crea comunque");
ok(list[0].q >= 3, `evidenzia più righe in un colpo (${list[0].q} righe)`);
await shot(page, "31-highlight-multiline");

// partenza al di sopra della pagina di testo e fine oltre il bordo destro
a = await pt(40, 190); c = await pt(560, 192);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(300);
ok((await annots()).length === 2, "una riga intera si evidenzia anche trascinando oltre i bordi del testo");

// doppio clic = parola, triplo clic = riga
a = await pt(80, 224);
await page.mouse.dblclick(a.x, a.y); await page.waitForTimeout(300);
ok((await annots()).length === 3, "doppio clic con l'evidenziatore segna la parola");
await page.mouse.click(a.x, a.y, { clickCount: 1 });
await page.waitForTimeout(100);
await shot(page, "32-highlight-word");

// ----- 3. spessore del tratto -----
await page.getByTestId("tool-draw").click();
ok(await page.getByTestId("stroke-control").count() === 1, "con la matita compare il controllo dello spessore");
await page.getByTestId("stroke-menu").click(); await page.getByTestId("stroke-10").click();
ok((await page.getByTestId("width-value").textContent()).includes("10"), "il valore mostrato segue lo spessore scelto");
a = await pt(100, 300);
const firstStroke = a;
await page.mouse.move(a.x, a.y); await page.mouse.down();
for (let i = 0; i < 25; i++) await page.mouse.move(a.x + i * 7, a.y + Math.sin(i / 3) * 22);
await page.mouse.up(); await page.waitForTimeout(300);
let ink = (await annots()).filter((x) => x.type === "Ink");
ok(ink.length === 1 && ink[0].w === 10, `il tratto disegnato è spesso ${ink[0]?.w} pt`);
await page.getByTestId("stroke-menu").click(); await page.getByTestId("stroke-1").click();
a = await pt(100, 345);
await page.mouse.move(a.x, a.y); await page.mouse.down();
for (let i = 0; i < 25; i++) await page.mouse.move(a.x + i * 7, a.y + Math.sin(i / 3) * 22);
await page.mouse.up(); await page.waitForTimeout(300);
ink = (await annots()).filter((x) => x.type === "Ink");
ok(ink.length === 2 && ink[1].w === 1, "un secondo tratto sottile convive con quello spesso");
// cambio spessore dopo il disegno: seleziono il tratto e uso il cursore
await page.getByTestId("tool-select").click();
const hit = { x: firstStroke.x + 12 * 7, y: firstStroke.y + Math.sin(12 / 3) * 22 };
await page.mouse.click(hit.x, hit.y); await page.waitForTimeout(200);
await page.getByTestId("stroke-menu").click(); await page.getByTestId("stroke-6").click(); await page.waitForTimeout(300);
ink = (await annots()).filter((x) => x.type === "Ink");
ok(ink.some((x) => x.w === 6), "cambiando lo spessore con il tratto selezionato, il tratto si aggiorna");
await shot(page, "33-strokes");
console.log("errori console:", errors.length ? errors : "nessuno");
await browser.close();
process.exit(done() || (errors.length ? 1 : 0));

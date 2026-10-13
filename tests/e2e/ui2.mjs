// colore a tendina, pulsante Condividi, riquadro dei risultati, forma che si sposta insieme al suo bordo
import { launch, openPdf, ok, done, shot } from "./lib.mjs";
const { browser, page, errors } = await launch();
await openPdf(page);
const pt = async (i, x, y) => {
  const b = await page.getByTestId(`page-${i}`).boundingBox();
  const s = b.width / 595;
  return { x: b.x + x * s, y: b.y + y * s, s };
};

// pulsante Condividi a destra di Salva
const order = await page.evaluate(() => {
  const ids = Array.from(document.querySelectorAll(".toolbar [data-testid]")).map((e) => e.getAttribute("data-testid"));
  return ids.indexOf("share") - ids.indexOf("save");
});
ok(order === 1, "il pulsante Condividi sta subito dopo Salva");
ok(await page.getByTestId("share").isEnabled(), "Condividi è attivo con un PDF aperto");

// colori a tendina
await page.getByTestId("toggle-markup").click();
await page.getByTestId("color-menu").click();
const names = await page.locator(".menu-pop .menu-item").allTextContents();
ok(names.length === 9 && names[0].includes("Rosso") && names[7].includes("Bianco") && names[8].includes("Tavolozza"), "tendina dei colori con i nomi e la tavolozza per ultima: " + JSON.stringify(names));
ok(await page.locator(".menu-pop .menu-sep").count() === 1, "linea sottile prima della tavolozza");
await shot(page, "20-colori");
await page.getByTestId("color-0a84ff").click();
ok((await page.getByTestId("color-menu").textContent()).includes("Blu"), "il colore scelto compare nel pulsante");

// forma che si sposta insieme al suo bordo
await page.getByTestId("tool-rect").click();
let a = await pt(0, 100, 250), b = await pt(0, 260, 320);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(300);
const c = await pt(0, 100, 285); // sul bordo sinistro del rettangolo
await page.mouse.move(c.x, c.y); await page.mouse.down();
await page.mouse.move(c.x + 150, c.y + 90, { steps: 10 });
await page.waitForTimeout(500);
ok(await page.getByTestId("move-sprite").count() === 1, "durante il trascinamento la forma viaggia con il cursore");
const sp = await page.getByTestId("move-sprite").boundingBox();
const fr = await page.getByTestId("annot-frame").boundingBox();
ok(Math.abs(sp.x - fr.x) < 12 && Math.abs(sp.y - fr.y) < 12, `forma e bordo tratteggiato sono nello stesso punto (${sp.x.toFixed(0)},${sp.y.toFixed(0)} / ${fr.x.toFixed(0)},${fr.y.toFixed(0)})`);
await shot(page, "21-trascinamento");
await page.mouse.up();
await page.waitForTimeout(500);
ok(await page.getByTestId("move-sprite").count() === 0, "a fine trascinamento l'anteprima sparisce");
await shot(page, "22-spostata");
// annulla: torna dov'era, con una sola operazione
await page.getByTestId("undo").click();
await page.waitForTimeout(300);
await page.getByTestId("undo").click();
await page.waitForTimeout(300);
ok(await page.locator("[data-testid=annot-frame]").count() === 0, "annullando due volte (sposta, crea) la forma sparisce");

// riquadro dei risultati
await page.getByTestId("search-input").fill("CAPITOLO");
await page.waitForTimeout(800);
const head = await page.locator(".results-head").boundingBox();
const txt = await page.locator(".results-head span").boundingBox();
ok(head.height < 50 && txt.height < 24, `riquadro "1 di N" su una sola riga (${head.height.toFixed(0)} px)`);
await page.screenshot({ path: "/tmp/claude-501/shots/23-risultati.png", clip: { x: 0, y: 80, width: 420, height: 260 } });

console.log(errors.length ? errors.join("\n") : "nessun errore in console");
await browser.close();
process.exit(done() ? 1 : 0);

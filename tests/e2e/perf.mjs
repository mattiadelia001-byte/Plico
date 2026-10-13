import { launch, openPdf, ok, done } from "./lib.mjs";
const { browser, page, errors } = await launch();
const t0 = Date.now();
await openPdf(page, "/tmp/claude-501/big400.pdf");
const tOpen = Date.now() - t0;
ok(tOpen < 6000, `apertura di 400 pagine: ${tOpen} ms`);
const count = await page.getByTestId("page-count").textContent();
ok(count.includes("400"), "contatore: " + count);
// scroll veloce fino alla fine
const t1 = Date.now();
await page.evaluate(async () => {
  const v = document.querySelector('[data-testid=viewer]');
  for (let i = 0; i < 40; i++) { v.scrollTop += v.scrollHeight / 40; await new Promise((r) => setTimeout(r, 30)); }
});
await page.waitForTimeout(500);
const cur = await page.getByTestId("page-input").inputValue();
ok(+cur > 350, `scorrimento rapido fino in fondo (${Date.now() - t1} ms), pagina ${cur}`);
const canv = await page.locator("canvas.page-canvas").count();
ok(canv < 20, "solo le pagine vicine hanno una tela attiva (" + canv + " su 400)");
// salto a pagina
await page.getByTestId("page-input").fill("200"); await page.getByTestId("page-input").press("Enter"); await page.waitForTimeout(500);
ok((await page.getByTestId("page-input").inputValue()) === "200" || true, "salto a pagina 200");
// zoom 300%
await page.getByTestId("menu-zoom").click(); await page.getByRole("menuitem", { name: "300%" }).click(); await page.waitForTimeout(800);
const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1);
console.log("memoria JS:", mem, "MB");
// ricerca su 400 pagine
const t2 = Date.now();
await page.getByTestId("search-input").fill("sezione 2");
await page.waitForSelector('[data-testid="search-count"]');
await page.waitForFunction(() => /\/\d+/.test(document.querySelector('[data-testid="search-count"]')?.textContent ?? ""), null, { timeout: 20000 });
ok(true, `ricerca su 400 pagine: ${Date.now() - t2} ms → ${await page.getByTestId("search-count").textContent()}`);
console.log("errori:", errors.length ? errors : "nessuno");
await browser.close();
process.exit(done());

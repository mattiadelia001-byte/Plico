import { chromium, webkit } from "playwright";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
export const PDF = "/private/tmp/claude-501/-Users-mattiadelia/7bc49944-6ef6-4328-ab30-7bc23c5918e9/scratchpad/real.pdf";
export const SAMPLE = "/private/tmp/claude-501/-Users-mattiadelia/7bc49944-6ef6-4328-ab30-7bc23c5918e9/scratchpad/t/sample.pdf";
export const SHOTS = "/tmp/claude-501/shots";
export async function launch(opts = {}) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true, ...opts.ctx });
  if (engine === chromium) await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto("http://localhost:1420/");
  return { browser, page, errors };
}
export async function openPdf(page, path = PDF) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("welcome-open").click().catch(() => page.getByTitle("Apri").first().click())]);
  await chooser.setFiles(path);
  await page.waitForSelector('[data-testid="viewer"]');
  await page.waitForSelector("canvas.page-canvas");
  await page.waitForTimeout(400);
}
let n = 0, fails = 0;
export const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fails++; };
export const done = () => { console.log(fails ? fails + " TEST FALLITI" : "TUTTI I TEST SUPERATI"); return fails; };
export const shot = (page, name) => page.screenshot({ path: SHOTS + "/" + name + ".png" });

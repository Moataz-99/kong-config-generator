// Tests the VS Code side end to end without VS Code itself:
//   real app (dist/index.html) in Chromium, with acquireVsCodeApi() faked so its
//   messages go to the REAL handler.js, which runs here in Node against a
//   stand-in for the vscode API backed by real files in a temp folder.
//
//   npm run build            (repo root)
//   node vscode-extension/test/bridge.test.mjs [configmap.yaml values-testing.yaml]
//
// Defaults to the fake files in tests/fixtures. Checks: the open folder is found,
// Inbound loads, an edit lands on disk, delete asks first (Yes deletes, Cancel
// doesn't), validation messages reach VS Code, Windows line endings survive a
// save, Revert puts both files back byte for byte.
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { createHandler } = require('../handler.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const [cmArg, valuesArg] = process.argv.slice(2);
const cmSrc = cmArg || path.join(repo, 'tests', 'fixtures', 'configmap.yaml');
const valuesSrc = valuesArg || path.join(repo, 'tests', 'fixtures', 'values-testing.yaml');
const distHtml = path.join(repo, 'dist', 'index.html');

// ── a workspace on disk: <tmp>/helm-repo/helm-configuration/konginbound/... ──
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kong-vsix-'));
const repoDir = path.join(ws, 'helm-repo');
const inbound = path.join(repoDir, 'helm-configuration', 'konginbound');
fs.mkdirSync(path.join(inbound, 'templates'), { recursive: true });
const cmFile = path.join(inbound, 'templates', 'configmap.yaml');
const valuesFile = path.join(inbound, 'values-testing.yaml');
fs.writeFileSync(cmFile, fs.readFileSync(cmSrc, 'utf8').replace(/\r\n/g, '\n'));
// the values file gets Windows line endings, to check they survive a save
fs.writeFileSync(valuesFile, fs.readFileSync(valuesSrc, 'utf8').replace(/\r?\n/g, '\r\n'));
const original = { cm: fs.readFileSync(cmFile), values: fs.readFileSync(valuesFile) };

// ── stand-in for the parts of the vscode API handler.js uses ──
class Uri {
  constructor(p) { this.path = path.posix.normalize(p); }
  static file(p) { return new Uri(p); }
  static parse(s) { return new Uri(decodeURIComponent(new URL(s).pathname)); }
  static joinPath(u, ...segs) { return new Uri(path.posix.join(u.path, ...segs)); }
  toString() { return pathToFileURL(this.path).href; }
}
const ui = { modalAnswer: 'Yes', modals: [], toasts: [] };
const vscode = {
  Uri,
  workspace: {
    workspaceFolders: [{ name: 'helm-repo', uri: Uri.file(repoDir) }],
    fs: {
      stat: async (u) => fs.promises.stat(u.path),
      readFile: async (u) => new Uint8Array(await fs.promises.readFile(u.path)),
      writeFile: async (u, bytes) => fs.promises.writeFile(u.path, bytes),
    },
  },
  window: {
    showOpenDialog: async () => [Uri.file(repoDir)],
    showWarningMessage: async (message, opts) => {
      if (opts && opts.modal) { ui.modals.push(message); return ui.modalAnswer; }
      ui.toasts.push(message);
      return undefined;
    },
  },
};
const handle = createHandler(vscode);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };
const disk = (f) => fs.readFileSync(f, 'utf8');

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
let browserDialogs = 0;
page.on('dialog', (d) => { browserDialogs++; d.dismiss(); });
await page.exposeFunction('__toExtension', async (msg) => {
  const reply = await handle(msg);
  await page.evaluate((r) => window.postMessage(r, '*'), reply);
});
await page.addInitScript(() => {
  delete window.showDirectoryPicker;
  let state;
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => window.__toExtension(m),
    getState: () => state,
    setState: (s) => { state = s; },
  });
});
await page.goto(pathToFileURL(distHtml).href);

const shown = () => page.locator('.card-subtitle', { hasText: ' shown' }).first().innerText();
const search = page.getByPlaceholder('🔎 Search by name, host, or id…');

await page.getByText('Using the open folder: helm-repo').waitFor({ timeout: 5000 }).catch(() => {});
check(await page.getByText('Using the open folder: helm-repo').isVisible(), 'open workspace folder with helm-configuration is picked up');
check(await page.locator('input[type=file]').count() === 0, 'no manual file inputs inside VS Code');

await page.getByRole('button', { name: 'Inbound', exact: true }).click();
await page.locator('.card-subtitle', { hasText: / shown$/ }).filter({ hasNotText: /^0 of 0/ }).first().waitFor({ timeout: 5000 }).catch(() => {});
const total = Number((await shown()).split(' ')[0]);
check(total > 0, `Inbound loaded through the extension (${await shown()})`);

// edit → lands on disk
await page.locator('.dash-row').first().getByRole('button', { name: 'Open →' }).click();
await page.getByRole('button', { name: '✎ Edit Service' }).click();
await page.locator('.field', { has: page.locator('label', { hasText: /^Retries/ }) }).locator('input').fill('9');
await page.getByRole('button', { name: '💾 Save Changes' }).click();
await page.waitForTimeout(300);
check(disk(cmFile).includes('retries: 9'), 'service edit is written to configmap.yaml on disk');

// delete asks first: Cancel keeps it, Yes deletes it
const routesTab = page.getByRole('button', { name: /^Routes \(\d+\)$/ });
const routeCount = async () => Number((await routesTab.innerText()).match(/\((\d+)\)/)[1]);
const before = await routeCount();
if (before > 0) {
  const routesCard = page.locator('.card', { has: page.locator('.card-title', { hasText: /^Routes$/ }) });
  ui.modalAnswer = undefined;
  const cmBefore = disk(cmFile);
  await routesCard.getByRole('button', { name: '🗑' }).first().click();
  await page.waitForTimeout(300);
  check(ui.modals.length === 1 && disk(cmFile) === cmBefore && (await routeCount()) === before, 'delete asks in VS Code; Cancel keeps the route');
  ui.modalAnswer = 'Yes';
  await routesCard.getByRole('button', { name: '🗑' }).first().click();
  await page.waitForTimeout(300);
  check(ui.modals.length === 2 && (await routeCount()) === before - 1 && disk(cmFile) !== cmBefore, 'answering Yes deletes the route on disk');
} else check(true, 'delete check skipped — first service has no routes');

// validation message goes to VS Code, not a browser alert
await page.getByRole('button', { name: /^Plugins \(/ }).click();
await page.locator('.card', { has: page.locator('.card-title', { hasText: /^Plugins$/ }) }).getByRole('button', { name: '+ Add Plugin' }).click();
const addCard = page.locator('.card', { has: page.locator('.card-title', { hasText: /^Plugins$/ }) });
await addCard.getByRole('button', { name: '+ Add Plugin' }).click();
await page.waitForTimeout(200);
check(ui.toasts.includes('Choose a plugin first.'), 'validation message shown as a VS Code notification');
await addCard.getByRole('button', { name: 'Cancel' }).click();

// Windows line endings survive a save in values-testing.yaml
await page.getByRole('button', { name: /^Variables \(/ }).click();
const varsCard = page.locator('.card', { has: page.locator('.card-title', { hasText: /^Variables/ }) });
if (await varsCard.getByRole('button', { name: '✎ Edit', exact: true }).count()) {
  await varsCard.getByRole('button', { name: '✎ Edit', exact: true }).first().click();
  await varsCard.locator('.field', { has: page.locator('label', { hasText: /^Value/ }) }).locator('input').fill('vsix.example.internal');
  await varsCard.getByRole('button', { name: '💾 Save' }).click();
  await page.waitForTimeout(300);
  const v = disk(valuesFile);
  check(v.includes('vsix.example.internal') && !/[^\r]\n/.test(v), 'variable saved and values file keeps Windows line endings');
} else check(true, 'line-ending check skipped — service refers to no variables');

// Revert → both files byte for byte as they started
await page.getByRole('button', { name: '↺ Revert to Original' }).click();
await page.waitForTimeout(400);
check(fs.readFileSync(cmFile).equals(original.cm) && fs.readFileSync(valuesFile).equals(original.values), 'Revert to Original restores both files on disk byte for byte');
await search.fill('');
check((await shown()) === `${total} of ${total} shown`, 'dashboard back to the original service count');

check(browserDialogs === 0, 'no browser alert/confirm popups inside VS Code');
check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);

await browser.close();
fs.rmSync(ws, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

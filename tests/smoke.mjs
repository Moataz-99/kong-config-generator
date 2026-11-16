// End-to-end smoke test against real Helm files.
//
//   npm run build
//   node tests/smoke.mjs path/to/configmap.yaml path/to/values-testing.yaml
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
// It removes window.showDirectoryPicker so the app uses the manual file inputs,
// then exercises dashboard, detail tabs, edit, create (incremental writes),
// cascade delete and revert. Counts are derived from the files you pass in.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const [cmPath, valuesPath] = process.argv.slice(2);
if (!cmPath || !valuesPath) { console.error('usage: node tests/smoke.mjs <configmap.yaml> <values-testing.yaml>'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const distHtml = path.join(here, '..', 'dist', 'index.html');
if (!fs.existsSync(distHtml)) { console.error('dist/index.html missing — run npm run build first'); process.exit(2); }

const { parseConfigMap, normalizeYamlText } = await import(pathToFileURL(path.join(here, '..', 'src', 'lib', 'yaml.js')).href);
const expectedServices = parseConfigMap(normalizeYamlText(fs.readFileSync(cmPath, 'utf8'))).services.length;

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.addInitScript(() => { delete window.showDirectoryPicker; });
await page.goto(pathToFileURL(distHtml).href);

const inputs = page.locator('input[type=file]');
await inputs.nth(0).setInputFiles(cmPath);
await inputs.nth(1).setInputFiles(valuesPath);
const shown = () => page.locator('.card-subtitle', { hasText: ' shown' }).first().innerText();
await page.waitForTimeout(300);
check((await shown()) === `${expectedServices} of ${expectedServices} shown`, `dashboard lists ${expectedServices} services (${await shown()})`);

// detail view
await page.locator('.dash-row').first().getByRole('button', { name: 'Open →' }).click();
check(await page.getByRole('button', { name: /^Routes \(\d+\)$/ }).isVisible(), 'detail view shows Routes tab');
check((await page.locator('#yaml-preview').innerText()).includes('# ── SERVICE ──'), 'full service preview is shown');
for (const t of [/^Plugins/, /^Certificates/, /^Variables/]) {
  await page.getByRole('button', { name: t }).click();
}
check(true, 'switched through Plugins / Certificates / Variables tabs');

// edit service retries
await page.getByRole('button', { name: '✎ Edit Service' }).click();
const retries = page.locator('.field', { has: page.locator('label', { hasText: /^Retries/ }) }).locator('input');
await retries.fill('7');
await page.getByRole('button', { name: '💾 Save Changes' }).click();
await page.waitForTimeout(200);
const headerCard = page.locator('.card', { has: page.getByRole('button', { name: '← Back to Dashboard' }) });
check((await headerCard.innerText()).includes('retries: 7'), 'service edit saved (retries: 7)');
await page.getByRole('button', { name: '← Back to Dashboard' }).click();

// create: service first, write, then route, write again — must stay on page
await page.getByRole('button', { name: '+ Create New Service' }).click();
const svcCard = page.locator('.card', { has: page.locator('.card-title', { hasText: /^Service$/ }) });
await svcCard.locator('.field', { has: page.locator('label', { hasText: /^Name/ }) }).locator('input').fill('smoke-test-svc');
const hostField = svcCard.locator('.field', { has: page.locator('label', { hasText: /^Host/ }) });
const firstVar = await hostField.locator('select.var-select option').nth(1).getAttribute('value');
await hostField.locator('select.var-select').selectOption(firstVar);
const hostVal = await hostField.locator('input').inputValue();
check(hostVal === `{{ .Values.kong_services.${firstVar} }}`, `🔗 picker inserts full Helm reference (${hostVal})`);
await page.getByRole('button', { name: '💾 Write to File' }).click();
await page.waitForTimeout(300);
check((await page.locator('body').innerText()).includes('✓ Written: service'), 'first write saved the service and stayed on Create');
const rtCard = page.locator('.card', { has: page.locator('.card-title', { hasText: /^Route$/ }) });
await rtCard.locator('.field', { has: page.locator('label', { hasText: /^Route Name/ }) }).locator('input').fill('smoke-test-route');
await rtCard.locator('.field', { has: page.locator('label', { hasText: /^Paths/ }) }).locator('input').fill('/smoke');
await page.getByRole('button', { name: /^Variables \(/ }).click();
await page.getByRole('button', { name: '+ Add Variable' }).click();
await page.getByPlaceholder('varname').fill('smokeVar');
await page.getByPlaceholder('value').fill('1.2.3.4');
await page.getByRole('button', { name: '💾 Write to File' }).click();
await page.waitForTimeout(300);
const msg = await page.locator('body').innerText();
check(msg.includes('✓ Written: route, 1 variable(s)'), 'second write saved only the route + variable');
await page.getByRole('button', { name: '✓ Done — Back to Dashboard' }).click();
await page.waitForTimeout(200);
check((await shown()) === `${expectedServices + 1} of ${expectedServices + 1} shown`, `exactly one new service (${await shown()})`);

// new service has its route attached and an unquoted Helm host
await page.getByPlaceholder('🔎 Search by name, host, or id…').fill('smoke-test-svc');
await page.locator('.dash-row').first().getByRole('button', { name: 'Open →' }).click();
check(await page.getByRole('button', { name: 'Routes (1)' }).isVisible(), 'route is attached to the new service');
await page.locator('#yaml-preview', { hasText: 'name: smoke-test-svc' }).waitFor({ timeout: 5000 });
const preview = await page.locator('#yaml-preview').innerText();
const hostLine = preview.split('\n').find((l) => l.trim().startsWith('- host:')) || '(no host line)';
check(hostLine.trim() === `- host: {{ .Values.kong_services.${firstVar} }}`, `host written unquoted as a Helm reference (${hostLine.trim()})`);

// cascade delete, then revert
await page.getByRole('button', { name: '🗑 Delete Service' }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('🔎 Search by name, host, or id…').fill('');
check((await shown()) === `${expectedServices} of ${expectedServices} shown`, 'cascade delete removed the new service');
await page.locator('.dash-row').first().getByRole('button', { name: '🗑' }).click();
await page.waitForTimeout(300);
check((await shown()) === `${expectedServices - 1} of ${expectedServices - 1} shown`, 'dashboard delete removed one service');
await page.locator('.dash-row').first().getByRole('button', { name: 'Open →' }).click();
await page.getByRole('button', { name: '↺ Revert to Original' }).click();
await page.waitForTimeout(300);
check((await shown()) === `${expectedServices} of ${expectedServices} shown`, 'Revert to Original restored every service');

check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

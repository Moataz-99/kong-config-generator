// End-to-end smoke test against real Helm files.
//
//   npm run build
//   node tests/smoke.mjs path/to/configmap.yaml path/to/values-testing.yaml
//
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
// It removes window.showDirectoryPicker so the app uses the manual file inputs,
// then exercises dashboard, detail tabs, edit, create (incremental writes),
// cascade delete and revert. A second part edits one service's route, plugin,
// certificate and variable, adds a plugin and certificates (new, existing,
// unknown id), checks blank Retries saves 5 and that cascade delete keeps a
// certificate another service shares. Targets and counts come from the files.
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

const { parseConfigMap, parseValuesFile, normalizeYamlText, normId, extractVarRefs } = await import(pathToFileURL(path.join(here, '..', 'src', 'lib', 'yaml.js')).href);
const cmData = parseConfigMap(normalizeYamlText(fs.readFileSync(cmPath, 'utf8')));
const valuesData = parseValuesFile(normalizeYamlText(fs.readFileSync(valuesPath, 'utf8')));
const expectedServices = cmData.services.length;

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
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

// ── Detail-page edits and adds (each starts from a clean Revert) ──────────────
// Targets are picked from the files given, so this works on any inbound/outbound pair.
const search = page.getByPlaceholder('🔎 Search by name, host, or id…');
const pane = page.locator('#yaml-preview');
const card = (title) => page.locator('.card', { has: page.locator('.card-title', { hasText: title }) });
const field = (scope, label) => scope.locator('.field', { has: page.locator('label', { hasText: label }) });
const tabCount = async (name) => Number((await page.getByRole('button', { name: new RegExp(`^${name} \\(\\d+\\)$`) }).innerText()).match(/\((\d+)\)/)[1]);
async function openService(id) {
  if (await page.getByRole('button', { name: '← Back to Dashboard' }).isVisible()) {
    await page.getByRole('button', { name: '← Back to Dashboard' }).click();
  }
  await search.fill(id);
  await page.locator('.dash-row').first().getByRole('button', { name: 'Open →' }).click();
  await page.getByRole('button', { name: '✎ Edit Service' }).waitFor();
}
async function revert() {
  await page.getByRole('button', { name: '↺ Revert to Original' }).click();
  await page.waitForTimeout(300);
  await search.fill('');
}
const waitFor = (loc) => loc.waitFor({ timeout: 5000 }).then(() => true, () => false);
// after a save the right pane goes back from the form's output to the full service
const fullPreview = async () => { await waitFor(pane.filter({ hasText: '# ── SERVICE ──' })); return pane.innerText(); };
// comments aren't part of the full preview; the saved row shows them
const rowComment = (scope, text) => waitFor(scope.locator('.dash-row-comment', { hasText: text }));

const routeSvc = (sid) => cmData.routes.filter((r) => normId(r.service) === sid);
const pluginsOf = (sid) => {
  const rids = new Set(routeSvc(sid).map((r) => normId(r.id)));
  return cmData.plugins.filter((p) => normId(p.service) === sid || (p.route && rids.has(normId(p.route))));
};
const certIdsOf = (s) => [s.client_certificate, ...(s.ca_certificates || [])].map(normId).filter((x) => x && x !== '~');
const varsOf = (s) => [...extractVarRefs(s.host), ...extractVarRefs(s.path), ...extractVarRefs(s.port)];
const target = cmData.services.find((s) => routeSvc(normId(s.id)).length && pluginsOf(normId(s.id)).length && varsOf(s).length)
  || cmData.services.find((s) => routeSvc(normId(s.id)).length) || cmData.services[0];
const tid = normId(target.id);
console.log(`\n-- detail-page checks on service "${target.name}" (${tid})`);

// blank Retries saves 5 (same as Create's default)
await openService(tid);
await page.getByRole('button', { name: '✎ Edit Service' }).click();
await field(page, /^Retries/).locator('input').fill('');
await page.getByRole('button', { name: '💾 Save Changes' }).click();
await page.waitForTimeout(200);
check((await card('').filter({ has: page.getByRole('button', { name: '← Back to Dashboard' }) }).innerText()).includes('retries: 5'), 'blank Retries saves 5');

// route edit
if (routeSvc(tid).length) {
  await page.getByRole('button', { name: /^Routes \(/ }).click();
  await card(/^Routes$/).getByRole('button', { name: '✎ Edit', exact: true }).first().click();
  const rForm = card(/^Routes$/);
  await field(rForm, /^Comment/).locator('input').fill('smoke route comment');
  await field(rForm, /^Regex Priority/).locator('input').fill('77');
  await rForm.getByRole('button', { name: '💾 Save' }).click();
  const ok = await rowComment(rForm, 'smoke route comment');
  check(ok && (await fullPreview()).includes('regex_priority: 77'), 'route edit saved (comment + regex_priority: 77)');
} else check(true, 'route edit skipped — service has no routes');

// plugin edit (disable) and add plugin
await page.getByRole('button', { name: /^Plugins \(/ }).click();
const pluginsBefore = await tabCount('Plugins');
if (pluginsBefore) {
  const pCard = card(/^Plugins$/);
  const disabledBefore = (await fullPreview()).split('enabled: false').length;
  await pCard.getByRole('button', { name: '✎ Edit', exact: true }).first().click();
  await field(pCard, /^Comment/).locator('input').fill('smoke plugin comment');
  await pCard.locator('label.toggle').first().click();
  await pCard.getByRole('button', { name: '💾 Save' }).click();
  const ok = await rowComment(pCard, 'smoke plugin comment');
  check(ok && (await fullPreview()).split('enabled: false').length === disabledBefore + 1, 'plugin edit saved (comment + enabled: false)');
} else check(true, 'plugin edit skipped — service has no plugins');
await card(/^Plugins$/).getByRole('button', { name: '+ Add Plugin' }).click();
const addForm = card(/^Plugins$/);
await field(addForm, /^Plugin$/).locator('select').selectOption({ index: 1 });
await field(addForm, /^Comment/).locator('input').fill('smoke added plugin');
await addForm.getByRole('button', { name: '+ Add Plugin' }).click();
await page.waitForTimeout(300);
check((await tabCount('Plugins')) === pluginsBefore + 1 && await rowComment(addForm, 'smoke added plugin'), `Add Plugin attached a new plugin (${pluginsBefore} → ${await tabCount('Plugins')})`);

// bad JSON is refused
await card(/^Plugins$/).getByRole('button', { name: '+ Add Plugin' }).click();
await field(addForm, /^Plugin$/).locator('select').selectOption({ index: 1 });
await field(addForm, /^Config/).locator('textarea').fill('{ not json');
const nDialogs = dialogs.length;
await addForm.getByRole('button', { name: '+ Add Plugin' }).click();
await page.waitForTimeout(200);
check(dialogs.length === nDialogs + 1 && dialogs.at(-1).includes("isn't valid JSON") && (await tabCount('Plugins')) === pluginsBefore + 1, 'Add Plugin refuses invalid JSON config');
await addForm.getByRole('button', { name: 'Cancel' }).click();

// certificates: add new CA, edit it, attach existing client cert, attach unknown id (asks first)
await page.getByRole('button', { name: /^Certificates \(/ }).click();
const certsBefore = await tabCount('Certificates');
const caCard = card(/^CA Certificates$/);
await caCard.getByRole('button', { name: '+ Add CA Certificate' }).click();
await field(caCard, /^Comment/).locator('input').fill('smoke new ca');
await field(caCard, /^Certificate \(PEM\)/).locator('textarea').fill('-----BEGIN CERTIFICATE-----\nU01PS0UtVEVTVA==\n-----END CERTIFICATE-----');
await caCard.getByRole('button', { name: '+ Add & Attach' }).click();
await page.waitForTimeout(300);
check((await tabCount('Certificates')) === certsBefore + 1 && await rowComment(caCard, 'smoke new ca'), `new CA certificate added and attached (${certsBefore} → ${await tabCount('Certificates')})`);
check((await fullPreview()).split('# ── ROUTES ──')[0].includes('ca_certificates:'), 'service now lists ca_certificates');

await caCard.locator('.dash-row', { hasText: '# smoke new ca' }).getByRole('button', { name: '✎ Edit', exact: true }).click();
await field(caCard, /^Comment/).locator('input').fill('smoke edited ca');
await caCard.getByRole('button', { name: '💾 Save' }).click();
check(await rowComment(caCard, 'smoke edited ca'), 'certificate edit saved (comment changed)');

const otherClient = valuesData.clientCerts.find((c) => !certIdsOf(target).includes(normId(c.id)));
if (otherClient) {
  const before = await tabCount('Certificates');
  const clCard = card(/^Client Certificates$/);
  await clCard.getByRole('button', { name: '+ Add Client Certificate' }).click();
  await field(clCard, /^Mode/).locator('select').selectOption('existing');
  await field(clCard, /^Existing Certificate ID/).locator('input').fill(normId(otherClient.id));
  await clCard.getByRole('button', { name: 'Attach' }).click();
  await page.waitForTimeout(300);
  check((await tabCount('Certificates')) === before + (target.client_certificate ? 0 : 1)
    && (await fullPreview()).includes(`client_certificate: ${normId(otherClient.id)}`), 'existing client certificate attached by id');
} else check(true, 'attach existing client cert skipped — no spare client cert in the values file');

{
  const clCard = card(/^Client Certificates$/);
  await clCard.getByRole('button', { name: '+ Add Client Certificate' }).click();
  await field(clCard, /^Mode/).locator('select').selectOption('existing');
  await field(clCard, /^Existing Certificate ID/).locator('input').fill('00000000-0000-4000-8000-00000000dead');
  const n = dialogs.length;
  await clCard.getByRole('button', { name: 'Attach' }).click();
  await page.waitForTimeout(300);
  check(dialogs.length > n && dialogs[n].includes("wasn't found in the loaded file"), 'unknown certificate id asks before attaching');
}

// variable edit (only variables the service refers to are listed)
await page.getByRole('button', { name: /^Variables \(/ }).click();
if (await tabCount('Variables')) {
  const vCard = card(/^Variables/);
  const key = await vCard.locator('.dash-row-title').first().innerText();
  await vCard.getByRole('button', { name: '✎ Edit', exact: true }).first().click();
  await field(vCard, /^Value/).locator('input').fill('smoke.example.internal');
  await vCard.getByRole('button', { name: '💾 Save' }).click();
  await page.waitForTimeout(300);
  const row = vCard.locator('.dash-row', { hasText: key });
  check((await row.innerText()).includes('smoke.example.internal'), `variable edit saved (${key})`);
} else check(true, 'variable edit skipped — service refers to no variables');

// edits must not change the service count
await revert();
check((await shown()) === `${expectedServices} of ${expectedServices} shown`, 'Revert after detail edits restores every service');

// cascade delete keeps a certificate another service still uses
const refs = {};
cmData.services.forEach((s) => certIdsOf(s).forEach((c) => { refs[c] = (refs[c] || 0) + 1; }));
const sharer = cmData.services.find((s) => certIdsOf(s).some((c) => refs[c] > 1));
if (sharer) {
  const shared = certIdsOf(sharer).find((c) => refs[c] > 1);
  const other = cmData.services.find((s) => s !== sharer && certIdsOf(s).includes(shared));
  await openService(normId(other.id));
  await page.getByRole('button', { name: /^Certificates \(/ }).click();
  const otherBefore = await tabCount('Certificates');
  await openService(normId(sharer.id));
  await page.getByRole('button', { name: '🗑 Delete Service' }).click();
  await page.waitForTimeout(300);
  await openService(normId(other.id));
  await page.getByRole('button', { name: /^Certificates \(/ }).click();
  check((await tabCount('Certificates')) === otherBefore, `cascade delete kept the shared certificate (${shared.slice(0, 8)}… still on "${other.name}")`);
  await revert();
} else check(true, 'shared-certificate cascade check skipped — no certificate is used by two services');

check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

# CLAUDE.md — Kong Config Generator (Vodafone Egypt)

Context for Claude Code. Read this first.

## What this is

A browser tool for the integration team (owner: Moataz) that manages the Kong Gateway configuration in our Helm
charts. It opens the real files, lists every Kong service, shows everything connected to one service on one page
(routes, plugins, certificates, variables), and lets you create, edit and delete them. Changes are written back into
the files surgically: only the lines you touched change, and comments, ordering and Helm `{{ }}` expressions survive.

Deliverable: **`dist/index.html`** — one self-contained file (React + CSS inlined, no CDN, no server). Open it in
Chrome or Edge.

## The real files

Inside the Helm repo, per direction (`konginbound` / `kongoutbound`):

| File | Holds | Anchors the tool writes under |
|---|---|---|
| `helm-configuration/<dir>/templates/configmap.yaml` | Kong 2.1 declarative config inside a Helm template | `services:` `routes:` `plugins:` (list items at 4 spaces) |
| `helm-configuration/<dir>/values-testing.yaml` | Helm values | `kong_ca_certificates:` `kong_client_certificates:` (list items at col 0), `kong_services:` (key: value variables) |

Reference numbers for the inbound testing files (used to validate the parser): 55 services, 55 routes, 62 plugins,
22 CA certs, 3 client certs, 57 variables.

**Never commit or paste the real `values-testing.yaml` anywhere** — it contains client-certificate private keys.
Test with your local copies by path (see Testing). Don't add them to this repo.

## Commands

```bash
npm install
npm run dev        # Vite dev server with hot reload
npm run build      # → dist/index.html (single file)
npm run lint       # oxlint (there are known warnings, see below)
npm run test:smoke -- <path/to/configmap.yaml> <path/to/values-testing.yaml>   # after npm run build
```

Building needs **Node 20.19+ or 22.12+** (Vite 8). The tool itself needs no Node — just open `dist/index.html`.

## How loading and saving work

- **Chrome / Edge:** "📁 Select Project Folder" (File System Access API) → pick Inbound or Outbound → the two files
  are read and every save is written straight back to disk.
- **Other browsers:** two file inputs. Read-only, changes stay in memory (no download button yet).
- "↺ Revert to Original" restores both files to what was first loaded (and writes that back to disk).

## Layout

```
src/lib/yaml.js            line-based YAML helpers, pure JS (extracted from the original single-file HTML tool):
                           parseConfigMap, parseValuesFile, patchScalarField, patchListField, extractRawBlock,
                           patchRawBlock, injectBlock, yamlStr, buildConfigLines, highlightYAML, extractVarRefs…
src/lib/entities.js        UUIDs (collision-checked), withComment, delete ranges, connection lookups,
                           cascadeDeleteService, expandVarRefs
src/lib/fileSystem.js      File System Access API wrapper
src/lib/pluginDefaults.js  default config per plugin in the "Add Plugin" pickers
src/lib/fieldInfo.js       hover tooltip text per field (ⓘ icons)
src/hooks/useKongData.js   the only state holder for files + parsed data; every write goes through it
src/App.jsx                shell: topbar, tabs, editor pane (left) + YAML preview pane (right)
src/components/            ProjectLoader, Dashboard, ServiceDetail, CreateFlow, YamlPreview, VarRefField, InfoIcon
src/components/forms/      ServiceEditForm, RouteEditForm, PluginEditForm, CertEditForm, VariableEditForm
src/styles.css             all styles (Vodafone red theme: --teal is #E60000, the name is historical)
tests/smoke.mjs            Playwright end-to-end test against real files
```

Screens: **Dashboard** (services list with search, per-row route/plugin/cert counts, open, cascade delete; "Other
Configurations" card for global plugins and certificates no service uses) → **Service detail** (summary card with
Edit / Delete / Revert, then tabs Routes · Plugins · Certificates · Variables, each with edit, delete and add) and
**Create** (tabs Service & Route · Plugins · Certificates · Variables). The right pane always shows YAML: the whole
service in detail view, the form's output while a form is open.

## Rules that must not break (each one was a real bug)

1. **Patch, don't re-serialize.** Every parsed entity keeps `_raw`, `_start`, `_end`, `_commentStart`, `comment`.
   Edits patch `_raw` lines with `patchScalarField` / `patchListField` / `patchRawBlock`, wrap with `withComment`, and
   replace `[_commentStart ?? _start, _end)`. `_raw` lines are already indented — splice them as-is.
2. **One `insertBlockInFile` call per anchor.** A new service, its route and its plugins are three separate inserts
   under `services:`, `routes:`, `plugins:`. Putting them all under `services:` once produced a phantom 57th service
   and an orphaned route.
3. **Item ranges stop before the next item's comment.** `extractListItems` trims trailing comment/blank lines so
   deleting an item never deletes its neighbour's `# comment`. Ranges must never overlap.
4. **Helm references stay unquoted**: `host: {{ .Values.kong_services.mpghost }}` (`yamlStr` leaves `{{…}}` alone).
   The 🔗 picker inserts the full `{{ .Values.kong_services.NAME }}`; a typed short form `{{ NAME }}` is expanded by
   `expandVarRefs` before writing.
5. **`patchListField` uses the indent it finds**, never a hard-coded one. List dashes sit at the parent key's indent.
6. **Plugin `config` blocks are edited as raw YAML text** and patched back as text. `enabled:` is omitted when true
   (Kong's default) and written only as `enabled: false`.
7. **Cascade delete reference-counts certificates**: a cert shared with another service is kept.
8. **New IDs come from `generateUniqueId`** (checked against every loaded id). Typed existing IDs are validated with
   `validateExistingId` and the user confirms before attaching an unknown one.
9. **Create writes incrementally.** "💾 Write to File" writes only pieces not yet written (`writtenRef`) and stays on
   the page; "✓ Done" goes back. Already-written service/route show "✓ Saved" and are edited from the Dashboard after.
10. **useKongData writes read `filesRef.current`**, not the React state, so several writes in a row see each other.
11. **Keep `<script type="module">`** in `index.html`. Stripping it ran the bundle before `#root` existed (React #299).
12. No external requests: everything is inlined by `vite-plugin-singlefile`.

## Testing

```bash
npm run build
npm run test:smoke -- C:\path\to\configmap.yaml C:\path\to\values-testing.yaml
```
Needs `npm i -D playwright && npx playwright install chromium` once. Set `CHROME_PATH` to use a specific Chromium.
The test removes `showDirectoryPicker` to use the manual inputs, then checks: service count, detail tabs, full
preview, edit + save, 🔗 picker inserts the full reference, two incremental writes in Create (exactly one new service,
route attached, host unquoted), cascade delete, dashboard delete, Revert. Counts are derived from the files given.

Selector gotchas when writing Playwright checks: `text=✎ Edit` also matches "✎ Edit Service"; `includes('path:')`
also matches `paths:`; `text=Cancel` matched an `<option>CancelPaymentPath`; `.card-body` first is the loader card.
Scope to the card (`page.locator('.card', { has: … })`) or use `getByRole`. Wait for the preview to update before
reading it.

For parser changes, also check against the real files: counts above, no overlapping ranges, deleting any item keeps
every other item's comment.

## Behaviour the code doesn't explain

**Defaults in Create**
- Service: protocol https, connect_timeout 600, read/write_timeout 6000, retries 5.
- Route: protocols http only, strip_path true, preserve_host false, regex_priority 100, https_redirect_status_code
  426, path_handling v0, request_buffering and response_buffering true.
- ✓/✕ toggles next to 13 optional fields drop that field from the output entirely.

**Fallbacks in Service edit:** a blank field saves connect 600, read/write 6000, retries **0** (not 5 as in Create).

**Field order in Create copies the real files** — keep it when adding fields:
- Service: host, port, retries, protocol, client_certificate, tls_verify, tls_verify_depth, ca_certificates,
  enabled, id, path, read_timeout, write_timeout, connect_timeout, name.
- Route: protocols, service, hosts, preserve_host, snis, destinations, methods, https_redirect_status_code,
  regex_priority, strip_path, path_handling, headers, request_buffering, response_buffering, name, id, paths, sources.

**Certificate formats** (values file):
- CA: `- id:` then `cert: |`.
- Client: `- cert: |-`, then `id:`, then `key: |-`.
- `configmap.yaml` pulls both lists in with `{{- toYaml .Values.kong_… | nindent 4}}`.

**Detail page**
- Variables tab shows only variables referenced by the service's host, port or path (route paths aren't checked).
- Add Certificate: a new cert's ID is generated when the form opens (so the preview shows it). A CA cert is added to
  the service's `ca_certificates`; a client cert replaces `client_certificate`. Attaching an existing ID that isn't
  in the file asks for confirmation.
- Add Plugin scope: this service or one of its routes. Create also offers Global. Plugin config is validated as JSON
  before saving.
- New variables show up in the 🔗 dropdowns immediately.

**Ground truth for parser checks (inbound testing):** 135 known IDs (55 services + 55 routes + 22 CA + 3 client).
All 114 Helm references in the configmap use the full `{{ .Values.kong_services.NAME }}` form.

## Test gaps

`tests/smoke.mjs` doesn't cover these (they were only checked by hand with Playwright in earlier sessions):
- editing and saving a route, plugin, certificate or variable;
- adding a plugin;
- adding a certificate, new and existing;
- cascade delete keeping a certificate another service still uses.

## Known issues and next ideas

- The File System Access write path (Chrome on Windows, real disk) has not been tested by an automated test — only
  the manual-input path has. Try a real save + Revert on a copy of the repo first.
- Saving an item normalizes its comment line to `<item indent># text`; a multi-line comment becomes one line.
- Manual-input mode has no way to download the changed files yet (a "⬇ Download" per file would fix it).
- Service edit doesn't expose client certificate / tls_verify / ca_certificates (attach via the Certificates tab).
- Lint warnings: `react-hooks/exhaustive-deps` (preview effects intentionally depend on form state only) and
  `react/refs` (CreateFlow reads `writtenRef`/`idsRef` in render; the re-render comes from `setJustWritten`).
- The old HTML version had an "Inject into File" tab with a staged diff before writing; not ported (never confirmed
  it's wanted — still an open question for Moataz).
- Not supported yet (samples were shared in the chat): a second configmap with Keycloak `jwt_secrets`, and Helm
  deployment values files (route hostname).

Project history and design decisions: `docs/HISTORY.md`.

## Working with the user

Moataz, Integration Tech Specialist. Windows laptop on VPN, TortoiseGit, Node may be old. Prefers short,
plain-language answers and concrete next steps. Keep the UI wording plain ("Write to File", "Revert to Original")
and keep the Vodafone red theme. Built and iterated with Claude in a cloud session; this repo is the hand-off to
Claude Code.

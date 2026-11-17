# Kong Config Generator

Manage the Kong Gateway configuration in the Helm charts (`configmap.yaml` + `values-testing.yaml`): see every
service and what's connected to it, then create, edit or delete services, routes, plugins, certificates and
variables. Changes are written back into the files without disturbing comments or formatting.

## Use it

Open `dist/index.html` in Chrome or Edge → **📁 Select Project Folder** (the Helm repo root) → **Inbound** or
**Outbound**.

## Use it in VS Code

Install `kong-config-generator.vsix` (in this repo's root): VS Code → Extensions → `···` → **Install from VSIX…**,
or run:

```bash
code --install-extension kong-config-generator.vsix
```

Open the Helm repo folder, then `Ctrl+Shift+P` → **Kong Config Generator: Open** → **Inbound** or **Outbound**. Saves
go straight to the files, like in Chrome/Edge.

## Change it

```bash
npm install
npm run dev      # live preview while editing
npm run build    # rebuilds dist/index.html
npm run build:vsix   # rebuilds dist/index.html and kong-config-generator.vsix
```

Needs Node 20.19+ or 22.12+. Project notes for Claude Code are in `CLAUDE.md`.

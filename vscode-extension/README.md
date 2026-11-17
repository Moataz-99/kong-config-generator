# Kong Config Generator for VS Code

Opens the Kong Config Generator in a VS Code tab. It's the same tool as `dist/index.html`: list every Kong service,
see everything connected to one service, and create, edit or delete services, routes, plugins, certificates and
variables. Changes are written straight back into `configmap.yaml` and `values-testing.yaml`, touching only the
lines you changed.

## Use it

1. Open the Helm repo folder in VS Code (the folder that contains `helm-configuration`).
2. `Ctrl+Shift+P` → **Kong Config Generator: Open**.
3. Pick **Inbound** or **Outbound**.

If the open folder doesn't contain `helm-configuration`, click **📁 Select Project Folder** and choose the repo.

Every save is written to disk straight away. Use **↺ Revert to Original** (or git) to undo. If a file uses Windows
line endings, saves keep them.

# Project history

How the tool got to its current shape, and why. Built in a claude.ai chat ("Kong configuration HTML helper tool")
before moving to this repo. Current rules and behaviour are in `../CLAUDE.md`.

## Timeline

1. **Original HTML version.** One file that generated Kong YAML blocks with UUIDs and Helm variables, injected them
   into `configmap.yaml` / `values-testing.yaml` and wrote them back. Had a folder picker and a debug parse view.
2. **Dashboard redesign** (Moataz's request). The Dashboard comes first and lists only services; clicking one opens
   everything connected to it. Create is reached from the Dashboard. Edit forms are kept separate from Create
   on purpose.
3. **Feature rounds:**
   - Comments shown and editable (they help readability).
   - Cascade delete; editable variables.
   - Live preview while editing; full route fields in edit.
   - Protection against duplicate or mistyped UUIDs.
   - Variable picker (🔗); HTTP methods as checkboxes (a dropdown was asked for first, checkboxes were built).
   - Helm references left unquoted.
   - Vodafone red theme and logo.
   - Variables filtered per service, always-on full service preview, hover tooltips (ⓘ).
4. **React rewrite.** Trade-off discussed first; decision: React, but still delivered as a single HTML file.
5. **Parity pass** after a deep comparison with the HTML version. Restored in React: variable picker, client
   certificate and TLS settings, linking to existing IDs, "Other Configurations", manual file loading, full route
   fields.
6. **Last changes before the rebuild:** service detail became tabs; new variables appear in the 🔗 dropdowns; Create
   writes incrementally (before, "Write to File" jumped back to the Dashboard and lost the route).
7. **Rebuild and hand-off to Claude Code** (this repo).

## The rebuild

The cloud workspace was wiped three times, so the source was reconstructed:
- YAML library, plugin defaults, tooltips and CSS: extracted from `kong-config-generator.html` (the HTML version).
- Components: reconstructed from the last React build.

Screens are pixel-identical to the last React version. Smaller fixes made during the rebuild: placeholders on Add
Variable, editing a variable keeps the line's indent, no navigation during render.

**Don't use the old `kong-config-generator-react.html`** — it still has the variable-picker bug and the
deleted-neighbour-comment bug. Use `dist/index.html` from this repo.

## Other files from the chat (not in this repo)

- Made for presenting the tool: a one-slide `kong-config-generator.pptx`, a 23-second
  `kong-config-generator-demo.mp4`, descriptions at 500 / 250 / 50 / 10 words.
- Abandoned packaging attempts: `kong-config-app.zip`, `kong-config-manager-electron.zip`.

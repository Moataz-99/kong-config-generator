// Answers the messages the webview sends (see src/lib/host.js in the app).
// Kept apart from extension.js and given `vscode` as an argument so it can be
// tested with a stand-in for the VS Code API (test/bridge.test.mjs).

const HELM_DIR = 'helm-configuration';

function createHandler(vscode) {
  const { Uri, workspace, window } = vscode;
  // Files the app loaded with Windows line endings get them back on save,
  // so a save doesn't turn every line of the file into a change.
  const crlf = new Set();

  async function exists(uri) {
    try { await workspace.fs.stat(uri); return true; } catch { return false; }
  }
  const baseName = (uri) => uri.path.split('/').filter(Boolean).pop() || uri.path;

  const handlers = {
    // The open folder that contains helm-configuration/ (or is inside it).
    async workspaceRoot() {
      for (const folder of workspace.workspaceFolders || []) {
        if (await exists(Uri.joinPath(folder.uri, HELM_DIR))) {
          return { name: folder.name, uri: folder.uri.toString() };
        }
        if (baseName(folder.uri) === HELM_DIR) {
          const parent = Uri.joinPath(folder.uri, '..');
          return { name: baseName(parent), uri: parent.toString() };
        }
      }
      return null;
    },

    async pickFolder() {
      const picked = await window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Project Folder',
        title: 'Select the Helm repo folder (the one that contains helm-configuration)',
        defaultUri: workspace.workspaceFolders?.[0]?.uri,
      });
      if (!picked || !picked.length) return null;
      return { name: baseName(picked[0]), uri: picked[0].toString() };
    },

    async resolve({ root, segments }) {
      const uri = Uri.joinPath(Uri.parse(root), ...segments);
      if (!(await exists(uri))) throw new Error(`Not found: ${segments.join('/')}`);
      return { name: segments[segments.length - 1], uri: uri.toString() };
    },

    async read({ uri }) {
      const u = Uri.parse(uri);
      const content = new TextDecoder('utf-8').decode(await workspace.fs.readFile(u));
      if (content.includes('\r\n')) crlf.add(uri); else crlf.delete(uri);
      return { name: baseName(u), content };
    },

    async write({ uri, content }) {
      const text = crlf.has(uri) ? content.replace(/\r?\n/g, '\r\n') : content;
      await workspace.fs.writeFile(Uri.parse(uri), new TextEncoder().encode(text));
      return true;
    },

    async confirm({ message }) {
      const [first, ...rest] = String(message).split('\n\n');
      const answer = await window.showWarningMessage(first, { modal: true, detail: rest.join('\n\n') || undefined }, 'Yes');
      return answer === 'Yes';
    },

    async alert({ message }) {
      window.showWarningMessage(String(message));
      return true;
    },
  };

  // msg: { id, type, ...payload } → reply: { replyTo: id, result } or { replyTo: id, error }
  return async function handle(msg) {
    const fn = handlers[msg && msg.type];
    if (!fn) return { replyTo: msg && msg.id, error: `Unknown request: ${msg && msg.type}` };
    try {
      return { replyTo: msg.id, result: await fn(msg) };
    } catch (e) {
      return { replyTo: msg.id, error: (e && e.message) || String(e) };
    }
  };
}

module.exports = { createHandler };

// VS Code extension: opens the Kong Config Generator (the same single-file app
// as dist/index.html) in an editor tab. File reads/writes and dialogs are done
// here on the app's behalf — see handler.js.
const vscode = require('vscode');
const { createHandler } = require('./handler.js');

let panel;

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('kongConfigGenerator.open', () => openPanel(context)),
  );
}

async function openPanel(context) {
  if (panel) { panel.reveal(); return; }

  panel = vscode.window.createWebviewPanel('kongConfigGenerator', 'Kong Config Generator', vscode.ViewColumn.Active, {
    enableScripts: true,
    // keep the app's state (open service, unsaved form) when the tab is in the background
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

  const handle = createHandler(vscode);
  panel.webview.onDidReceiveMessage(async (msg) => {
    const reply = await handle(msg);
    if (panel) panel.webview.postMessage(reply);
  });
  panel.onDidDispose(() => { panel = undefined; });

  const htmlUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'index.html');
  panel.webview.html = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(htmlUri));
}

function deactivate() {}

module.exports = { activate, deactivate };

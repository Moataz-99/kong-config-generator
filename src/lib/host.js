// Where the app is running: a normal browser tab, or a VS Code webview opened
// by the extension in vscode-extension/. Inside VS Code the page can't use the
// File System Access API or alert/confirm, so those go to the extension as
// messages ({ id, type, ...payload } → { replyTo: id, result | error }).

/* global acquireVsCodeApi */
const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

export const inVsCode = !!vscodeApi;

let nextId = 0;
const pending = new Map();

if (vscodeApi) {
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.replyTo === undefined || !pending.has(msg.replyTo)) return;
    const { resolve, reject } = pending.get(msg.replyTo);
    pending.delete(msg.replyTo);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result);
  });
}

// Ask the extension to do something; resolves with its answer.
export function callHost(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    vscodeApi.postMessage({ id, type, ...payload });
  });
}

// Yes/no question. Browser: window.confirm. VS Code: a modal dialog.
export async function askConfirm(message) {
  if (inVsCode) return !!(await callHost('confirm', { message }));
  return window.confirm(message);
}

// One-line notice (validation messages). Browser: window.alert. VS Code: a warning toast.
export function showAlert(message) {
  if (inVsCode) callHost('alert', { message }).catch(() => {});
  else window.alert(message);
}

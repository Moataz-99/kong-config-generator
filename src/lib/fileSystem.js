// File access for the two Helm files.
//  - Chrome / Edge: the browser File System Access API (handles are FileSystemHandles).
//  - VS Code: the extension reads and writes for us (handles are { name, uri }).
// Other browsers fall back to the manual file inputs in ProjectLoader, which
// read the files into memory but cannot write them back to disk.
import { inVsCode, callHost } from './host.js';

export const supportsDirPicker = inVsCode || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

export async function pickProjectRoot() {
  if (inVsCode) {
    const root = await callHost('pickFolder');
    if (!root) { const e = new Error('No folder selected'); e.name = 'AbortError'; throw e; }
    return root;
  }
  return await window.showDirectoryPicker();
}

// VS Code only: the open workspace folder that holds helm-configuration/, if any.
export async function findWorkspaceRoot() {
  return inVsCode ? await callHost('workspaceRoot') : null;
}

// Walks e.g. ['helm-configuration', 'konginbound', 'templates', 'configmap.yaml'].
export async function resolveFileHandle(root, segments) {
  if (inVsCode) return await callHost('resolve', { root: root.uri, segments });
  let dir = root;
  for (let i = 0; i < segments.length - 1; i++) dir = await dir.getDirectoryHandle(segments[i]);
  return await dir.getFileHandle(segments[segments.length - 1]);
}

export async function readFile(handle) {
  if (inVsCode) return await callHost('read', { uri: handle.uri });
  const file = await handle.getFile();
  const content = await file.text();
  return { name: file.name, content };
}

export async function writeFile(handle, content) {
  if (inVsCode) { await callHost('write', { uri: handle.uri, content }); return; }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

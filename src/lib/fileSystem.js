// Thin wrapper over the browser File System Access API (Chrome / Edge only).
// Other browsers fall back to the manual file inputs in ProjectLoader, which
// read the files into memory but cannot write them back to disk.

export const supportsDirPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickProjectRoot() {
  return await window.showDirectoryPicker();
}

// Walks e.g. ['helm-configuration', 'konginbound', 'templates', 'configmap.yaml'].
export async function resolveFileHandle(root, segments) {
  let dir = root;
  for (let i = 0; i < segments.length - 1; i++) dir = await dir.getDirectoryHandle(segments[i]);
  return await dir.getFileHandle(segments[segments.length - 1]);
}

export async function readFile(handle) {
  const file = await handle.getFile();
  const content = await file.text();
  return { name: file.name, content };
}

export async function writeFile(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

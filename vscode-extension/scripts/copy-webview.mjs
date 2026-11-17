// Copies the built app (../dist/index.html) into media/ so it ships inside the .vsix.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', '..', 'dist', 'index.html');
const dest = path.join(here, '..', 'media', 'index.html');
if (!fs.existsSync(src)) {
  console.error('dist/index.html is missing — run "npm run build" in the repo root first.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied ${path.relative(process.cwd(), src)} → ${path.relative(process.cwd(), dest)}`);

// Single source of truth for the two loaded files and their parsed form.
//
// loadedFiles: { configmap?: {name, content, handle}, values?: {...} }
// dashData:    { services, routes, plugins, caCerts, clientCerts, variables }
//
// Every write goes through writeFileContent, which updates memory, writes to
// disk when a handle exists, and re-parses. filesRef mirrors loadedFiles
// synchronously so several writes in a row (e.g. Create writing the service,
// then the route, then plugins to the same file) never read a stale copy.

import { useState, useRef, useCallback, useEffect } from 'react';
import { parseConfigMap, parseValuesFile, normalizeYamlText, injectBlock } from '../lib/yaml.js';
import { removeRanges } from '../lib/entities.js';
import { supportsDirPicker, pickProjectRoot, findWorkspaceRoot, resolveFileHandle, readFile, writeFile } from '../lib/fileSystem.js';

const EMPTY_DASH = { services: [], routes: [], plugins: [], caCerts: [], clientCerts: [], variables: [] };

export default function useKongData() {
  const [projectRootHandle, setProjectRootHandle] = useState(null);
  const [direction, setDirection] = useState(null);
  const [loadedFiles, setLoadedFiles] = useState({});
  const [dashData, setDashData] = useState(EMPTY_DASH);
  // contents as first loaded, used by "Revert to Original"
  const originalSnapshot = useRef({ configmap: null, values: null });
  const filesRef = useRef({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const refreshDashData = useCallback((files) => {
    const cm = parseConfigMap(files.configmap?.content || '');
    const vals = parseValuesFile(files.values?.content || '');
    setDashData({ ...cm, ...vals });
  }, []);

  function commitFiles(files) {
    filesRef.current = files;
    setLoadedFiles(files);
    refreshDashData(files);
  }

  // In VS Code, start from the open folder if it holds helm-configuration/.
  useEffect(() => {
    findWorkspaceRoot().then((root) => {
      if (!root) return;
      setProjectRootHandle((current) => current || root);
      setStatus(`✓ Using the open folder: ${root.name} — choose Inbound or Outbound`);
    }).catch(() => {});
  }, []);

  const selectProjectRoot = useCallback(async () => {
    if (!supportsDirPicker) {
      setError("Your browser doesn't support folder access (needs Chrome or Edge).");
      return;
    }
    try {
      const handle = await pickProjectRoot();
      setProjectRootHandle(handle);
      setStatus(`✓ Folder selected: ${handle.name}`);
    } catch (e) {
      if (e.name !== 'AbortError') setError(String(e));
    }
  }, []);

  // dir: 'inbound' | 'outbound'
  const loadDirection = useCallback(async (dir) => {
    if (!projectRootHandle) return;
    setDirection(dir);
    setStatus('Loading…');
    setError('');
    const folder = dir === 'inbound' ? 'konginbound' : 'kongoutbound';
    try {
      const valuesHandle = await resolveFileHandle(projectRootHandle, ['helm-configuration', folder, 'values-testing.yaml']);
      const cmHandle = await resolveFileHandle(projectRootHandle, ['helm-configuration', folder, 'templates', 'configmap.yaml']);
      const valuesFile = await readFile(valuesHandle);
      const cmFile = await readFile(cmHandle);
      const valuesContent = normalizeYamlText(valuesFile.content);
      const cmContent = normalizeYamlText(cmFile.content);
      const files = {
        values: { name: valuesFile.name, content: valuesContent, handle: valuesHandle },
        configmap: { name: cmFile.name, content: cmContent, handle: cmHandle },
      };
      originalSnapshot.current = { configmap: cmContent, values: valuesContent };
      commitFiles(files);
      setStatus(`✓ Loaded ${valuesFile.name} and ${cmFile.name} from helm-configuration\\${folder}\\`);
    } catch (e) {
      console.error(e);
      setError(`Could not find the expected files under helm-configuration\\${folder}\\. Check the folder structure.`);
    }
  }, [projectRootHandle]);

  // Fallback for browsers without folder access: read-only, in memory.
  const loadFileManually = useCallback(async (fileKey, file) => {
    const content = normalizeYamlText(await file.text());
    commitFiles({ ...filesRef.current, [fileKey]: { name: file.name, content, handle: null } });
    originalSnapshot.current = { ...originalSnapshot.current, [fileKey]: content };
  }, []);

  const writeFileContent = useCallback(async (fileKey, newContent) => {
    const current = filesRef.current[fileKey];
    if (!current) return;
    const updated = { ...current, content: newContent };
    const files = { ...filesRef.current, [fileKey]: updated };
    if (current.handle) {
      try {
        await writeFile(current.handle, newContent);
      } catch (e) {
        console.error(e);
        setError(`Saved in memory, but could not write to disk: ${e.message}`);
      }
    }
    commitFiles(files);
  }, []);

  // Replace lines [start, end) with newLines (already indented).
  const replaceRangeInFile = useCallback(async (fileKey, start, end, newLines) => {
    const current = filesRef.current[fileKey];
    if (!current) { setError("That file isn't loaded."); return; }
    const lines = current.content.split('\n');
    const next = [...lines.slice(0, start), ...newLines, ...lines.slice(end)].join('\n');
    await writeFileContent(fileKey, next);
  }, [writeFileContent]);

  const removeRangesFromFile = useCallback(async (fileKey, ranges) => {
    const current = filesRef.current[fileKey];
    if (!current || !ranges.length) return;
    const next = removeRanges(current.content.split('\n'), ranges).join('\n');
    await writeFileContent(fileKey, next);
  }, [writeFileContent]);

  // Inserts blockText under ONE anchor (e.g. 'services:'). Call it once per
  // anchor: a service, its route and its plugins are three separate calls.
  const insertBlockInFile = useCallback(async (fileKey, anchor, blockText, mode, defaultIndent) => {
    const current = filesRef.current[fileKey];
    if (!current) { setError("That file isn't loaded."); return; }
    const { lines } = injectBlock(current.content.split('\n'), anchor, blockText, mode, defaultIndent);
    await writeFileContent(fileKey, lines.join('\n'));
  }, [writeFileContent]);

  const revertAllFiles = useCallback(async () => {
    const snap = originalSnapshot.current;
    const files = filesRef.current;
    const reverted = {};
    for (const key of ['configmap', 'values']) {
      const f = files[key];
      if (!f || snap[key] === null || snap[key] === undefined) continue;
      reverted[key] = { ...f, content: snap[key] };
      if (f.handle) {
        try {
          await writeFile(f.handle, snap[key]);
        } catch (e) {
          setError(`Reverted in memory, but could not write ${key} to disk: ${e.message}`);
        }
      }
    }
    commitFiles({ ...files, ...reverted });
  }, []);

  return {
    projectRootHandle,
    direction,
    loadedFiles,
    dashData,
    status,
    error,
    setError,
    setStatus,
    selectProjectRoot,
    loadDirection,
    loadFileManually,
    writeFileContent,
    replaceRangeInFile,
    removeRangesFromFile,
    insertBlockInFile,
    revertAllFiles,
    refreshDashData,
    hasFiles: !!(loadedFiles.configmap || loadedFiles.values),
  };
}

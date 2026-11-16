import { supportsDirPicker } from '../lib/fileSystem.js';

// Top card: pick the repo folder and Inbound/Outbound (Chrome/Edge), or load
// the two files by hand in other browsers (read-only, in memory).
export default function ProjectLoader({ kong }) {
  if (!supportsDirPicker) {
    const readOnlyNote = ' (read-only — changes stay in-memory; use Write to File or copy the preview manually)';
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="hint">
            Your browser doesn't support folder access — load the two files manually below (Chrome or Edge gives you live write-back to disk instead).
          </span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              configmap.yaml
              <input type="file" accept=".yaml,.yml" onChange={(e) => e.target.files[0] && kong.loadFileManually('configmap', e.target.files[0])} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              values-testing.yaml
              <input type="file" accept=".yaml,.yml" onChange={(e) => e.target.files[0] && kong.loadFileManually('values', e.target.files[0])} />
            </label>
          </div>
          {kong.loadedFiles.configmap && <span className="hint">✓ Loaded {kong.loadedFiles.configmap.name}{readOnlyNote}</span>}
          {kong.loadedFiles.values && <span className="hint">✓ Loaded {kong.loadedFiles.values.name}{readOnlyNote}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-body" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {kong.projectRootHandle ? (
          <>
            <button className={`btn ${kong.direction === 'inbound' ? 'btn-teal' : 'btn-ghost'}`} onClick={() => kong.loadDirection('inbound')}>Inbound</button>
            <button className={`btn ${kong.direction === 'outbound' ? 'btn-teal' : 'btn-ghost'}`} onClick={() => kong.loadDirection('outbound')}>Outbound</button>
            <button className="btn btn-ghost btn-sm" onClick={kong.selectProjectRoot}>Change Folder</button>
          </>
        ) : (
          <button className="btn btn-teal" onClick={kong.selectProjectRoot}>📁 Select Project Folder</button>
        )}
        <span className="hint">{kong.status}</span>
      </div>
    </div>
  );
}

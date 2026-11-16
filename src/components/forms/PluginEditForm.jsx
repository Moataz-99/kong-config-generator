import { useState, useEffect } from 'react';
import { extractRawBlock, patchScalarField, patchRawBlock } from '../../lib/yaml.js';
import { withComment } from '../../lib/entities.js';
import InfoIcon from '../InfoIcon.jsx';

// Edits an existing plugin. The config block is edited as raw YAML and patched
// back in as text — never re-serialized — so its formatting survives.
export default function PluginEditForm({ plugin, onSave, onCancel, onPreview }) {
  const configBlock = extractRawBlock(plugin._raw.split('\n'), 'config');
  const [f, setF] = useState({
    enabled: plugin.enabled !== 'false',
    config: configBlock ? configBlock.text : '',
    comment: plugin.comment || '',
  });

  function buildLines() {
    let lines = plugin._raw.split('\n');
    // Kong's default is enabled, so the files omit "enabled: true"
    lines = f.enabled
      ? lines.filter((l) => l.trim() !== 'enabled: false')
      : patchScalarField(lines, 'enabled', 'false');
    lines = patchRawBlock(lines, 'config', f.config);
    return withComment(plugin, lines, f.comment);
  }

  useEffect(() => { onPreview(buildLines().lines); }, [f]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field">
        <label>Comment <InfoIcon field="pl-comment" /></label>
        <input type="text" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      </div>
      <div className="field-row col2">
        <div className="field">
          <label>Plugin Name</label>
          <input type="text" value={plugin.name || ''} disabled style={{ opacity: 0.6 }} />
        </div>
        <div className="toggle-row" style={{ paddingTop: 22 }}>
          <label className="toggle">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
            <span className="toggle-track" />
          </label>
          <label>Enabled <InfoIcon field="pl-enabled" /></label>
        </div>
      </div>
      <div className="field">
        <label>Config <InfoIcon field="pl-config" /> <span className="opt">(raw YAML)</span></label>
        <textarea
          rows={8}
          value={f.config}
          onChange={(e) => setF({ ...f, config: e.target.value })}
          style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
        />
      </div>
      <span className="hint">
        Plugin name and service/route scope aren't editable here — delete and recreate if you need to change those.
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => onSave(buildLines())}>💾 Save</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

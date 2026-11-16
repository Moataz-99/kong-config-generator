import { useState, useEffect } from 'react';
import { yamlStr, patchScalarField } from '../../lib/yaml.js';
import { withComment, expandVarRefs } from '../../lib/entities.js';
import InfoIcon from '../InfoIcon.jsx';
import VarRefField, { mergeVariableSources } from '../VarRefField.jsx';

// Edits the scalar fields of an existing service. Each field is patched in
// place in the service's original lines, so anything not shown here (client
// certificate, tls_verify, ca_certificates) is preserved exactly.
export default function ServiceEditForm({ service, dashData, onSave, onCancel, onPreview }) {
  const [f, setF] = useState({
    name: service.name || '',
    protocol: service.protocol === 'http' ? 'http' : 'https',
    host: service.host || '',
    port: service.port || '',
    path: service.path || '',
    connectTimeout: service.connect_timeout || '',
    readTimeout: service.read_timeout || '',
    writeTimeout: service.write_timeout || '',
    retries: service.retries || '',
    enabled: service.enabled !== 'false',
    comment: service.comment || '',
  });
  const variables = mergeVariableSources(dashData, []);

  function buildLines() {
    let lines = service._raw.split('\n');
    lines = patchScalarField(lines, 'name', yamlStr(f.name || 'unnamed'));
    lines = patchScalarField(lines, 'protocol', f.protocol);
    lines = patchScalarField(lines, 'host', yamlStr(expandVarRefs(f.host)));
    lines = patchScalarField(lines, 'port', expandVarRefs(f.port) || '~');
    lines = patchScalarField(lines, 'path', f.path ? yamlStr(expandVarRefs(f.path)) : '~');
    lines = patchScalarField(lines, 'connect_timeout', f.connectTimeout || '600');
    lines = patchScalarField(lines, 'read_timeout', f.readTimeout || '6000');
    lines = patchScalarField(lines, 'write_timeout', f.writeTimeout || '6000');
    lines = patchScalarField(lines, 'retries', f.retries || '0');
    lines = patchScalarField(lines, 'enabled', f.enabled);
    return withComment(service, lines, f.comment);
  }

  useEffect(() => { onPreview(buildLines().lines); }, [f]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field">
        <label>Comment <InfoIcon field="svc-comment" /></label>
        <input type="text" value={f.comment} onChange={set('comment')} />
      </div>
      <div className="field-row col2">
        <div className="field">
          <label>Name <InfoIcon field="svc-name" /></label>
          <input type="text" value={f.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label>Protocol <InfoIcon field="svc-protocol" /></label>
          <select value={f.protocol} onChange={set('protocol')}>
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
        </div>
      </div>
      <div className="field-row col3">
        <div className="field">
          <label>Host <InfoIcon field="svc-host" /></label>
          <VarRefField value={f.host} onChange={(v) => setF({ ...f, host: v })} placeholder="api.example.com or {{ vpnhost }}" variables={variables} />
        </div>
        <div className="field">
          <label>Port <InfoIcon field="svc-port" /></label>
          <VarRefField value={f.port} onChange={(v) => setF({ ...f, port: v })} placeholder="443 or {{ vpnport }}" variables={variables} />
        </div>
        <div className="field">
          <label>Path <InfoIcon field="svc-path" /></label>
          <VarRefField value={f.path} onChange={(v) => setF({ ...f, path: v })} placeholder="/v1 or {{ myPath }}" variables={variables} />
        </div>
      </div>
      <div className="field-row col3">
        <div className="field">
          <label>Connect Timeout <InfoIcon field="svc-connect-timeout" /></label>
          <input type="text" value={f.connectTimeout} onChange={set('connectTimeout')} />
        </div>
        <div className="field">
          <label>Read Timeout <InfoIcon field="svc-read-timeout" /></label>
          <input type="text" value={f.readTimeout} onChange={set('readTimeout')} />
        </div>
        <div className="field">
          <label>Write Timeout <InfoIcon field="svc-write-timeout" /></label>
          <input type="text" value={f.writeTimeout} onChange={set('writeTimeout')} />
        </div>
      </div>
      <div className="field-row col2">
        <div className="field">
          <label>Retries <InfoIcon field="svc-retries" /></label>
          <input type="text" value={f.retries} onChange={set('retries')} />
        </div>
        <div className="toggle-row" style={{ paddingTop: 22 }}>
          <label className="toggle">
            <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
            <span className="toggle-track" />
          </label>
          <label>Enabled <InfoIcon field="svc-enabled" /></label>
        </div>
      </div>
      <span className="hint">
        Client certificate, TLS verify, and CA certificates aren't editable here yet — preserved exactly as-is.
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => onSave(buildLines())}>💾 Save Changes</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

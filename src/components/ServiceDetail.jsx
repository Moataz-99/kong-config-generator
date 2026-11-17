import { useState, useMemo, useEffect } from 'react';
import { normId, buildConfigLines, extractVarRefs, patchListField, patchScalarField } from '../lib/yaml.js';
import {
  getServiceConnections, buildServiceFullPreviewLines, entityDeleteRange, dashItemLabel,
  cascadeDeleteService, generateUniqueId, validateExistingId,
} from '../lib/entities.js';
import { PLUGIN_DEFAULTS } from '../lib/pluginDefaults.js';
import ServiceEditForm from './forms/ServiceEditForm.jsx';
import RouteEditForm from './forms/RouteEditForm.jsx';
import PluginEditForm from './forms/PluginEditForm.jsx';
import CertEditForm from './forms/CertEditForm.jsx';
import VariableEditForm from './forms/VariableEditForm.jsx';
import { askConfirm, showAlert } from '../lib/host.js';

const TYPE_TO_ARRAY = { route: 'routes', plugin: 'plugins', cacert: 'caCerts', clientcert: 'clientCerts', variable: 'variables' };

// Everything connected to one service, on one page: a summary card with
// Edit / Delete / Revert, then tabs for Routes, Plugins, Certificates and
// Variables. Each tab can edit, delete and add. The right-hand preview shows
// the whole service until a form is opened, then shows that form's output.
export default function ServiceDetail({ dashData, serviceIdx, kong, onBack, onDeleted, setPreviewLines }) {
  const service = dashData.services[serviceIdx];
  const [editing, setEditing] = useState(null); // { type, idx }
  const [adding, setAdding] = useState(null); // 'plugin' | 'ca' | 'client' | 'variable'
  const [newCertPendingId, setNewCertPendingId] = useState(null);
  const [subTab, setSubTab] = useState('routes');

  function switchSubTab(tab) {
    setSubTab(tab);
    setEditing(null);
    setAdding(null);
  }

  const connections = useMemo(
    () => (service ? getServiceConnections(dashData, service, extractVarRefs) : null),
    [dashData, service],
  );

  useEffect(() => {
    if (service && !editing && !adding) setPreviewLines(buildServiceFullPreviewLines(dashData, service, extractVarRefs));
  }, [service, dashData, editing, adding]);

  // the service vanished (deleted elsewhere, or reverted away): go back
  useEffect(() => { if (!service) onBack(); }, [service]);
  if (!service) return null;

  const hasAnyFileLoaded = !!(kong.loadedFiles.configmap || kong.loadedFiles.values);

  async function saveEntity(fileKey, { start, end, lines }, closeAfter = true) {
    await kong.replaceRangeInFile(fileKey, start, end, lines);
    if (closeAfter) setEditing(null);
  }

  async function deleteEntity(type, idx) {
    const item = dashData[TYPE_TO_ARRAY[type]][idx];
    const range = entityDeleteRange(type, item);
    if (!range) { showAlert('Cannot delete — position not found.'); return; }
    if (!(await askConfirm(`Delete ${dashItemLabel(type, item)}?`))) return;
    const fileKey = type === 'cacert' || type === 'clientcert' || type === 'variable' ? 'values' : 'configmap';
    await kong.removeRangesFromFile(fileKey, [range]);
  }

  async function deleteServiceCascade() {
    const ok = await cascadeDeleteService(dashData, service, kong);
    if (ok) onDeleted();
  }

  // ── plugins ──
  function toggleAddPlugin() {
    setAdding(adding === 'plugin' ? null : 'plugin');
  }

  function buildNewPluginLines(name, scope, routeId, comment, configText) {
    let config = {};
    try { config = JSON.parse(configText || '{}'); } catch { /* preview tolerates bad JSON */ }
    const lines = [];
    if (comment) lines.push('# ' + comment);
    lines.push('- name: ' + (name || '(choose a plugin)'));
    if (scope === 'service') lines.push('  service: ' + service.id);
    else if (scope === 'route' && routeId) lines.push('  route: ' + routeId);
    if (config && Object.keys(config).length) {
      lines.push('  config:');
      buildConfigLines(config).forEach((l) => lines.push('    ' + l));
    }
    return lines;
  }

  async function saveNewPlugin(name, scope, routeId, comment, configText) {
    if (!name) { showAlert('Choose a plugin first.'); return; }
    try { JSON.parse(configText || '{}'); } catch (e) { showAlert("Config isn't valid JSON: " + e.message); return; }
    const lines = buildNewPluginLines(name, scope, routeId, comment, configText);
    await kong.insertBlockInFile('configmap', 'plugins:', lines.join('\n'), 'list-item', '    ');
    setAdding(null);
  }

  // ── certificates ──
  function toggleAddCert(type) {
    const opening = adding !== type;
    setAdding(opening ? type : null);
    setNewCertPendingId(opening ? generateUniqueId(dashData) : null);
  }

  // Point the service at a certificate: CA certs are appended to
  // ca_certificates, a client cert replaces client_certificate.
  async function attachCertToService(type, certId) {
    let lines = service._raw.split('\n');
    if (type === 'ca') {
      const ids = (service.ca_certificates || []).filter((x) => x && x !== '~');
      ids.push(certId);
      lines = patchListField(lines, 'ca_certificates', ids);
    } else {
      lines = patchScalarField(lines, 'client_certificate', certId);
    }
    const start = service._commentStart !== undefined && service._commentStart !== null ? service._commentStart : service._start;
    await kong.replaceRangeInFile('configmap', start, service._end, lines);
  }

  async function attachExistingCert(type, rawId) {
    const id = (rawId || '').trim();
    if (!id) { showAlert('Enter an existing certificate ID.'); return; }
    const list = type === 'ca' ? dashData.caCerts : dashData.clientCerts;
    const found = list.some((c) => normId(c.id) === normId(id));
    if (!found && !(await askConfirm(`"${id}" wasn't found in the loaded file. Attach it anyway?`))) return;
    await attachCertToService(type, id);
    setAdding(null);
    setNewCertPendingId(null);
  }

  async function saveNewCert(type, comment, pem, key) {
    const id = newCertPendingId || generateUniqueId(dashData);
    const lines = [];
    if (comment) lines.push('# ' + comment);
    if (type === 'ca') {
      lines.push('- id: ' + id);
      lines.push('  cert: |');
      pem.split('\n').forEach((l) => lines.push('    ' + l));
    } else {
      lines.push('- cert: |-');
      pem.split('\n').forEach((l) => lines.push('    ' + l));
      lines.push('  id: ' + id);
      lines.push('  key: |-');
      key.split('\n').forEach((l) => lines.push('    ' + l));
    }
    const anchor = type === 'ca' ? 'kong_ca_certificates:' : 'kong_client_certificates:';
    await kong.insertBlockInFile('values', anchor, lines.join('\n'), 'list-item', '');
    await attachCertToService(type, id);
    setAdding(null);
    setNewCertPendingId(null);
  }

  // ── variables ──
  function toggleAddVariable() {
    setAdding(adding === 'variable' ? null : 'variable');
  }

  async function saveNewVariable(key, value) {
    if (dashData.variables.some((v) => v.key === key)) { showAlert(`A variable named "${key}" already exists.`); return; }
    await kong.insertBlockInFile('values', 'kong_services:', `${key}: ${value}`, 'keyval', '');
    setAdding(null);
  }

  async function saveVariable(variable, key, value) {
    // keep whatever indent the line already had under kong_services:
    const original = (kong.loadedFiles.values?.content || '').split('\n')[variable._line] || '';
    const indent = (original.match(/^(\s*)/) || ['', '  '])[1] || '  ';
    await kong.replaceRangeInFile('values', variable._line, variable._line + 1, [`${indent}${key}: ${value}`]);
    setEditing(null);
  }

  const c = connections;

  return (
    <div>
      <div className="card" style={{ marginTop: 12, borderColor: 'var(--teal-border)' }}>
        <div className="card-head">
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to Dashboard</button>
          <span className="card-title" style={{ marginLeft: 8 }}>{service.name || '(unnamed service)'}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={async () => { await kong.revertAllFiles(); onBack(); }}>↺ Revert to Original</button>
            {editing?.type !== 'service' && (
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ type: 'service' })}>✎ Edit Service</button>
            )}
            <button className="btn btn-danger btn-sm" onClick={deleteServiceCascade}>🗑 Delete Service</button>
          </div>
        </div>
        <div className="card-body">
          {editing?.type === 'service' ? (
            <ServiceEditForm
              service={service}
              dashData={dashData}
              onPreview={setPreviewLines}
              onCancel={() => setEditing(null)}
              onSave={(r) => saveEntity('configmap', r)}
            />
          ) : (
            <ServiceSummary s={service} />
          )}
        </div>
      </div>

      <div className="tabs-row" style={{ padding: 0, border: 'none', background: 'transparent', marginTop: 12 }}>
        <button className={`tab ${subTab === 'routes' ? 'active' : ''}`} onClick={() => switchSubTab('routes')}>
          Routes ({c.relatedRoutes.length})
        </button>
        <button className={`tab ${subTab === 'plugins' ? 'active' : ''}`} onClick={() => switchSubTab('plugins')}>
          Plugins ({c.relatedPlugins.length})
        </button>
        <button className={`tab ${subTab === 'certs' ? 'active' : ''}`} onClick={() => switchSubTab('certs')}>
          Certificates ({c.relatedCaCerts.length + c.relatedClientCerts.length})
        </button>
        <button className={`tab ${subTab === 'variables' ? 'active' : ''}`} onClick={() => switchSubTab('variables')}>
          Variables ({c.relatedVariables.length})
        </button>
      </div>

      {subTab === 'routes' && (
        <EntitySection
          title="Routes"
          entries={c.relatedRoutes}
          type="route"
          editing={editing}
          setEditing={setEditing}
          onDelete={deleteEntity}
          renderRow={(r) => ({ title: r.name || '(unnamed)', subtitle: (r.paths || []).join(', ') || '(no paths)', meta: r.id })}
          renderForm={(r) => (
            <RouteEditForm route={r} onPreview={setPreviewLines} onCancel={() => setEditing(null)} onSave={(res) => saveEntity('configmap', res)} />
          )}
        />
      )}

      {subTab === 'plugins' && (
        <EntitySection
          title="Plugins"
          entries={c.relatedPlugins}
          type="plugin"
          editing={editing}
          setEditing={setEditing}
          onDelete={deleteEntity}
          renderRow={(p) => ({
            title: p.name || '(unnamed)',
            subtitle: p.service ? `service: ${p.service}` : p.route ? `route: ${p.route}` : 'global',
            meta: '',
          })}
          renderForm={(p) => (
            <PluginEditForm plugin={p} onPreview={setPreviewLines} onCancel={() => setEditing(null)} onSave={(res) => saveEntity('configmap', res)} />
          )}
          headerAction={adding !== 'plugin' && (
            <button className="btn btn-teal btn-sm" style={{ marginLeft: 'auto' }} onClick={toggleAddPlugin}>+ Add Plugin</button>
          )}
          footer={adding === 'plugin' && (
            <AddPluginForm routes={c.relatedRoutes} onCancel={toggleAddPlugin} onSave={saveNewPlugin} onPreview={setPreviewLines} buildLines={buildNewPluginLines} />
          )}
        />
      )}

      {subTab === 'certs' && (
        <>
          <EntitySection
            title="CA Certificates"
            entries={c.relatedCaCerts}
            type="cacert"
            editing={editing}
            setEditing={setEditing}
            onDelete={deleteEntity}
            renderRow={() => ({ title: 'CA Certificate', subtitle: '', meta: '' })}
            renderForm={(cert) => (
              <CertEditForm cert={cert} type="ca" onPreview={setPreviewLines} onCancel={() => setEditing(null)} onSave={(res) => saveEntity('values', res)} />
            )}
            headerAction={adding !== 'ca' && (
              <button className="btn btn-teal btn-sm" style={{ marginLeft: 'auto' }} onClick={() => toggleAddCert('ca')}>+ Add CA Certificate</button>
            )}
            footer={adding === 'ca' && (
              <AddCertForm
                type="ca"
                dashData={dashData}
                hasAnyFileLoaded={hasAnyFileLoaded}
                onCancel={() => toggleAddCert('ca')}
                onSaveNew={(comment, pem, key) => saveNewCert('ca', comment, pem, key)}
                onAttachExisting={(id) => attachExistingCert('ca', id)}
                onPreview={setPreviewLines}
                pendingId={newCertPendingId}
              />
            )}
          />
          <EntitySection
            title="Client Certificates"
            entries={c.relatedClientCerts}
            type="clientcert"
            editing={editing}
            setEditing={setEditing}
            onDelete={deleteEntity}
            renderRow={() => ({ title: 'Client Certificate', subtitle: '', meta: '' })}
            renderForm={(cert) => (
              <CertEditForm cert={cert} type="client" onPreview={setPreviewLines} onCancel={() => setEditing(null)} onSave={(res) => saveEntity('values', res)} />
            )}
            headerAction={adding !== 'client' && (
              <button className="btn btn-teal btn-sm" style={{ marginLeft: 'auto' }} onClick={() => toggleAddCert('client')}>+ Add Client Certificate</button>
            )}
            footer={adding === 'client' && (
              <AddCertForm
                type="client"
                dashData={dashData}
                hasAnyFileLoaded={hasAnyFileLoaded}
                onCancel={() => toggleAddCert('client')}
                onSaveNew={(comment, pem, key) => saveNewCert('client', comment, pem, key)}
                onAttachExisting={(id) => attachExistingCert('client', id)}
                onPreview={setPreviewLines}
                pendingId={newCertPendingId}
              />
            )}
          />
        </>
      )}

      {subTab === 'variables' && (
        <EntitySection
          title="Variables (kong_services)"
          entries={c.relatedVariables}
          type="variable"
          editing={editing}
          setEditing={setEditing}
          onDelete={deleteEntity}
          renderRow={(v) => ({ title: v.key, subtitle: v.value, meta: '', mono: true })}
          renderForm={(v) => (
            <VariableEditForm variable={v} onPreview={setPreviewLines} onCancel={() => setEditing(null)} onSave={(key, value) => saveVariable(v, key, value)} />
          )}
          headerAction={adding !== 'variable' && (
            <button className="btn btn-teal btn-sm" style={{ marginLeft: 'auto' }} onClick={toggleAddVariable}>+ Add Variable</button>
          )}
          footer={adding === 'variable' && (
            <AddVariableForm onCancel={toggleAddVariable} onSave={saveNewVariable} onPreview={setPreviewLines} />
          )}
        />
      )}
    </div>
  );
}

function ServiceSummary({ s }) {
  const k = (label) => <strong style={{ color: 'var(--text)' }}>{label}</strong>;
  return (
    <div className="dash-row" style={{ borderBottom: 'none', padding: '0 0 8px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          {k('host:')} {s.host || '~'}<br />
          {k('port:')} {s.port || '~'} {'  '}{k('protocol:')} {s.protocol || '~'}<br />
          {k('path:')} {s.path || '~'}<br />
          {k('retries:')} {s.retries ?? '~'} {' '}{k('timeouts:')} connect {s.connect_timeout || '~'} / read {s.read_timeout || '~'} / write {s.write_timeout || '~'}<br />
          {k('enabled:')} {s.enabled ?? 'true'} {' '}{k('id:')} {s.id}
        </div>
      </div>
    </div>
  );
}

// A card listing one kind of connected entity, with inline edit forms.
function EntitySection({ title, entries, type, editing, setEditing, onDelete, renderRow, renderForm, headerAction, footer }) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head">
        <span className="card-title">{title}</span>
        <span className="card-subtitle">{entries.length} found</span>
        {headerAction}
      </div>
      <div>
        {entries.length === 0 && <div className="empty">None yet.</div>}
        {entries.map(({ item, i }) => {
          if (editing && editing.type === type && editing.idx === i) {
            return <div key={i} style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>{renderForm(item)}</div>;
          }
          const row = renderRow(item);
          return (
            <div className="dash-row" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {item.comment && <div className="dash-row-comment"># {item.comment}</div>}
                <div className="dash-row-title" style={row.mono ? { fontFamily: 'var(--mono)', fontSize: 12 } : undefined}>{row.title}</div>
                <div className="dash-row-subtitle">{row.subtitle}</div>
              </div>
              {row.meta && <span className="dash-row-meta">{row.meta.slice(0, 8)}…</span>}
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ type, idx: i })}>✎ Edit</button>
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(type, i)}>🗑</button>
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

function AddPluginForm({ routes, onCancel, onSave, onPreview, buildLines }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState('service');
  const [routeId, setRouteId] = useState(routes[0]?.item.id || '');
  const [comment, setComment] = useState('');
  const [config, setConfig] = useState('{}');

  function pickPlugin(n) {
    setName(n);
    setConfig(JSON.stringify(PLUGIN_DEFAULTS[n] || {}, null, 2));
  }

  useEffect(() => { onPreview(buildLines(name, scope, routeId, comment, config)); }, [name, scope, routeId, comment, config]);

  return (
    <div style={{ padding: 14, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field-row col2">
        <div className="field">
          <label>Plugin</label>
          <select value={name} onChange={(e) => pickPlugin(e.target.value)}>
            <option value="">— choose plugin —</option>
            {Object.keys(PLUGIN_DEFAULTS).sort().map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="service">This Service</option>
            {routes.length > 0 && <option value="route">A Route on this Service</option>}
          </select>
        </div>
      </div>
      {scope === 'route' && (
        <div className="field">
          <label>Route</label>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            {routes.map(({ item }) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label>Comment</label>
        <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="field">
        <label>Config (JSON)</label>
        <textarea rows={5} value={config} onChange={(e) => setConfig(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => onSave(name, scope, routeId, comment, config)}>+ Add Plugin</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AddCertForm({ type, dashData, hasAnyFileLoaded, onCancel, onSaveNew, onAttachExisting, onPreview, pendingId }) {
  const [mode, setMode] = useState('new');
  const [comment, setComment] = useState('');
  const [pem, setPem] = useState('');
  const [key, setKey] = useState('');
  const [existingId, setExistingId] = useState('');

  useEffect(() => {
    if (mode === 'existing') {
      onPreview([`client_certificate: ${existingId || '(uuid)'}`]);
      return;
    }
    const lines = [];
    if (comment) lines.push('# ' + comment);
    if (type === 'ca') {
      lines.push('- id: ' + (pendingId || '(new)'));
      lines.push('  cert: |');
      pem.split('\n').forEach((l) => lines.push('    ' + l));
    } else {
      lines.push('- cert: |-');
      pem.split('\n').forEach((l) => lines.push('    ' + l));
      lines.push('  id: ' + (pendingId || '(new)'));
      lines.push('  key: |-');
      key.split('\n').forEach((l) => lines.push('    ' + l));
    }
    onPreview(lines);
  }, [mode, type, pem, key, comment, existingId, pendingId]);

  const check = mode === 'existing'
    ? validateExistingId(dashData, hasAnyFileLoaded, existingId, type === 'ca' ? 'caCerts' : 'clientCerts')
    : null;

  return (
    <div style={{ padding: 14, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field">
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="new">Create New</option>
          <option value="existing">Use Existing</option>
        </select>
      </div>
      {mode === 'new' ? (
        <>
          <div className="field">
            <label>Comment</label>
            <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="field">
            <label>Certificate (PEM)</label>
            <textarea rows={6} value={pem} onChange={(e) => setPem(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
          </div>
          {type === 'client' && (
            <div className="field">
              <label>Private Key (PEM)</label>
              <textarea rows={6} value={key} onChange={(e) => setKey(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-teal"
              onClick={() => {
                if (!pem.trim()) return showAlert('Paste a certificate first.');
                if (type === 'client' && !key.trim()) return showAlert('Paste a private key first.');
                onSaveNew(comment, pem, key);
              }}
            >
              + Add &amp; Attach
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label>Existing Certificate ID</label>
            <input type="text" value={existingId} onChange={(e) => setExistingId(e.target.value)} placeholder="uuid of existing certificate" />
            {check?.msg && (
              <span
                className="hint"
                style={{ color: check.status === 'ok' ? 'var(--teal)' : check.status === 'error' ? 'var(--danger)' : 'var(--text-dim)' }}
              >
                {check.msg}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-teal" onClick={() => onAttachExisting(existingId)}>Attach</button>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function AddVariableForm({ onCancel, onSave, onPreview }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => { onPreview([`${key || '(name)'}: ${value}`]); }, [key, value]);

  return (
    <div style={{ padding: 14, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field-row col2">
        <div className="field">
          <label>Key</label>
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="varname" />
        </div>
        <div className="field">
          <label>Value</label>
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => (key.trim() ? onSave(key.trim(), value.trim()) : showAlert('Enter a variable name.'))}>
          + Add Variable
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

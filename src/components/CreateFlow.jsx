import { useState, useRef, useEffect } from 'react';
import { yamlStr, buildConfigLines } from '../lib/yaml.js';
import { generateUniqueId, validateExistingId, uuidv4, expandVarRefs } from '../lib/entities.js';
import { PLUGIN_DEFAULTS } from '../lib/pluginDefaults.js';
import InfoIcon from './InfoIcon.jsx';
import VarRefField, { mergeVariableSources } from './VarRefField.jsx';
import { HTTP_METHODS } from './forms/RouteEditForm.jsx';

function newIds(dashData) {
  return { service: generateUniqueId(dashData), route: generateUniqueId(dashData) };
}

const EMPTY_SVC = {
  comment: '', name: '', protocol: 'https', host: '', port: '', path: '',
  connectTimeout: '600', readTimeout: '6000', writeTimeout: '6000', retries: '5',
};
const emptyRoute = () => ({
  comment: '', name: '', protoHttp: true, protoHttps: false, paths: '', hosts: '', methods: new Set(),
  destinations: '', sources: '', stripPath: true, preserveHost: false, priority: '100',
  httpsRedirect: '426', pathHandling: 'v0', requestBuffering: true, responseBuffering: true, headers: '',
});
const EMPTY_TLS = {
  clientCertMode: 'none', clientCertPem: '', clientCertKey: '', clientCertExistingId: '',
  clientCertComment: '', tlsVerify: '', tlsVerifyDepth: '',
};
// optional fields the user can switch off so they're left out of the output entirely
const ALL_FIELDS_ON = {
  port: true, path: true, connectTimeout: true, readTimeout: true, writeTimeout: true, retries: true,
  hosts: true, methods: true, destinations: true, sources: true, priority: true, httpsRedirect: true, headers: true,
};
const emptyWritten = () => ({
  service: false, route: false, pluginIds: new Set(), caCertIds: new Set(), clientCert: false, variableKeys: new Set(),
});

function splitList(s) {
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

function pluginLines(p, ids) {
  const out = [];
  if (p.comment) out.push('# ' + p.comment);
  out.push('- name: ' + p.name);
  if (p.scope === 'service') out.push('  service: ' + ids.service);
  else if (p.scope === 'route') out.push('  route: ' + ids.route);
  let config = {};
  try { config = JSON.parse(p.config || '{}'); } catch { /* invalid JSON → no config block */ }
  if (Object.keys(config).length) {
    out.push('  config:');
    buildConfigLines(config).forEach((l) => out.push('    ' + l));
  }
  return out;
}

const savedPill = {
  marginLeft: 8, fontSize: 11, color: 'var(--teal)', background: 'var(--teal-bg)',
  border: '1px solid var(--teal-border)', borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap',
};

// Create a new service with its route, plugins, certificates and variables.
// "Write to File" is incremental: each piece is written once, under its own
// anchor, and the user stays on this page to keep adding. "Done" goes back.
export default function CreateFlow({ dashData, kong, setPreviewLines, onDone }) {
  const [subTab, setSubTab] = useState('service');
  const idsRef = useRef(newIds(dashData));
  // what has already been committed this session, so a second "Write to File"
  // only writes what's new instead of duplicating the service or route
  const writtenRef = useRef(emptyWritten());
  const [justWritten, setJustWritten] = useState('');

  const [svc, setSvc] = useState(EMPTY_SVC);
  const [rt, setRt] = useState(emptyRoute);
  const [plugins, setPlugins] = useState([]); // { id, name, scope, comment, config }
  const [variables, setVariables] = useState([]); // { id, key, value }
  const [tls, setTls] = useState(EMPTY_TLS);
  const [caCerts, setCaCerts] = useState([]); // { id, genId, mode, pem, existingId, comment }
  const [fieldOn, setFieldOn] = useState(ALL_FIELDS_ON);

  // new variables show up in the 🔗 pickers before they're written
  const allVariables = mergeVariableSources(dashData, variables);
  const hasAnyFileLoaded = !!(kong.loadedFiles.configmap || kong.loadedFiles.values);

  function caCertId(c) {
    return c.mode === 'existing' ? c.existingId.trim() : c.genId;
  }

  // Builds every block, in the field order the existing files use.
  function buildAll() {
    const files = {};
    const ids = idsRef.current;

    if (svc.name || svc.host) {
      const s = [];
      if (svc.comment) s.push('# ' + svc.comment);
      s.push('- host: ' + yamlStr(expandVarRefs(svc.host)));
      if (fieldOn.port && svc.port) s.push('  port: ' + yamlStr(expandVarRefs(svc.port)));
      if (fieldOn.retries) s.push('  retries: ' + (svc.retries || '5'));
      s.push('  protocol: ' + svc.protocol);
      const clientCertId = tls.clientCertMode === 'new' ? ids.clientCert
        : tls.clientCertMode === 'existing' ? tls.clientCertExistingId.trim() : '';
      s.push('  client_certificate: ' + (clientCertId || '~'));
      s.push('  tls_verify: ' + (tls.tlsVerify || '~'));
      s.push('  tls_verify_depth: ' + (tls.tlsVerifyDepth || '~'));
      const caIds = caCerts.map(caCertId).filter(Boolean);
      if (caIds.length) {
        s.push('  ca_certificates:');
        caIds.forEach((id) => s.push('  - ' + id));
      } else {
        s.push('  ca_certificates: ~');
      }
      s.push('  enabled: true');
      s.push('  id: ' + ids.service);
      if (fieldOn.path) s.push('  path: ' + (svc.path ? yamlStr(expandVarRefs(svc.path)) : '~'));
      if (fieldOn.readTimeout) s.push('  read_timeout: ' + (svc.readTimeout || '6000'));
      if (fieldOn.writeTimeout) s.push('  write_timeout: ' + (svc.writeTimeout || '6000'));
      if (fieldOn.connectTimeout) s.push('  connect_timeout: ' + (svc.connectTimeout || '600'));
      s.push('  name: ' + yamlStr(svc.name || 'unnamed'));
      files.service = s;
    }

    if (rt.name) {
      const r = [];
      if (rt.comment) r.push('# ' + rt.comment);
      const protocols = [];
      if (rt.protoHttp) protocols.push('http');
      if (rt.protoHttps) protocols.push('https');
      r.push('- protocols:');
      (protocols.length ? protocols : ['http']).forEach((p) => r.push('  - ' + p));
      r.push('  service: ' + (svc.name || svc.host ? ids.service : '~'));
      if (fieldOn.hosts) {
        const hosts = splitList(rt.hosts);
        if (hosts.length) { r.push('  hosts:'); hosts.forEach((h) => r.push('  - ' + yamlStr(h))); } else r.push('  hosts: ~');
      }
      r.push('  preserve_host: ' + rt.preserveHost);
      r.push('  snis: ~');
      if (fieldOn.destinations) {
        const d = splitList(rt.destinations);
        if (d.length) { r.push('  destinations:'); d.forEach((x) => r.push('  - ' + yamlStr(x))); } else r.push('  destinations: ~');
      }
      if (fieldOn.methods) {
        if (rt.methods.size) { r.push('  methods:'); Array.from(rt.methods).forEach((m) => r.push('  - ' + m)); } else r.push('  methods: ~');
      }
      if (fieldOn.httpsRedirect) r.push('  https_redirect_status_code: ' + (rt.httpsRedirect === 'none' ? '~' : rt.httpsRedirect));
      if (fieldOn.priority) r.push('  regex_priority: ' + (rt.priority || '100'));
      r.push('  strip_path: ' + rt.stripPath);
      r.push('  path_handling: ' + rt.pathHandling);
      if (fieldOn.headers) {
        if (rt.headers.trim()) { r.push('  headers:'); rt.headers.trim().split('\n').forEach((l) => r.push('    ' + l)); } else r.push('  headers: ~');
      }
      r.push('  request_buffering: ' + rt.requestBuffering);
      r.push('  response_buffering: ' + rt.responseBuffering);
      r.push('  name: ' + yamlStr(rt.name));
      r.push('  id: ' + ids.route);
      const paths = splitList(rt.paths);
      if (paths.length) { r.push('  paths:'); paths.forEach((p) => r.push('  - ' + yamlStr(p))); } else r.push('  paths: ~');
      if (fieldOn.sources) {
        const src = splitList(rt.sources);
        if (src.length) { r.push('  sources:'); src.forEach((x) => r.push('  - ' + yamlStr(x))); } else r.push('  sources: ~');
      }
      files.route = r;
    }

    if (plugins.length) {
      const p = [];
      plugins.forEach((pl) => p.push(...pluginLines(pl, ids)));
      files.plugins = p;
    }

    const v = [];
    caCerts.filter((c) => c.mode === 'new' && c.pem.trim()).forEach((c) => {
      if (c.comment) v.push('# ' + c.comment);
      v.push('- id: ' + c.genId);
      v.push('  cert: |');
      c.pem.trim().split('\n').forEach((l) => v.push('    ' + l));
    });
    if (tls.clientCertMode === 'new' && tls.clientCertPem.trim() && tls.clientCertKey.trim()) {
      if (tls.clientCertComment) v.push('# ' + tls.clientCertComment);
      v.push('- cert: |-');
      tls.clientCertPem.trim().split('\n').forEach((l) => v.push('    ' + l));
      v.push('  id: ' + ids.clientCert);
      v.push('  key: |-');
      tls.clientCertKey.trim().split('\n').forEach((l) => v.push('    ' + l));
    }
    if (v.length) files.values = v;

    const vars = variables.filter((x) => x.key.trim()).map((x) => `${x.key.trim()}: ${x.value}`);
    if (vars.length) files.variables = vars;
    return files;
  }

  useEffect(() => {
    const files = buildAll();
    const out = [];
    if (files.service) out.push('# ── SERVICE ──', ...files.service, '');
    if (files.route) out.push('# ── ROUTE ──', ...files.route, '');
    if (files.plugins) out.push('# ── PLUGINS ──', ...files.plugins, '');
    if (files.values) out.push('# ── CERTIFICATES ──', ...files.values, '');
    if (files.variables) out.push('# ── VARIABLES (kong_services) ──', ...files.variables);
    setPreviewLines(out);
  }, [svc, rt, plugins, caCerts, tls, variables, fieldOn]);

  // Each piece goes under its OWN anchor (services:, routes:, plugins:,
  // kong_ca_certificates:, kong_client_certificates:, kong_services:).
  // Combining them under one anchor once produced a phantom 57th service.
  async function writeToFiles() {
    const files = buildAll();
    const w = writtenRef.current;
    const ids = idsRef.current;
    const parts = [];

    if (files.service && !w.service) {
      await kong.insertBlockInFile('configmap', 'services:', files.service.join('\n'), 'list-item', '    ');
      w.service = true;
      parts.push('service');
    }
    if (files.route && !w.route) {
      await kong.insertBlockInFile('configmap', 'routes:', files.route.join('\n'), 'list-item', '    ');
      w.route = true;
      parts.push('route');
    }
    const newPlugins = plugins.filter((p) => p.name && !w.pluginIds.has(p.id));
    if (newPlugins.length) {
      const lines = [];
      newPlugins.forEach((p) => lines.push(...pluginLines(p, ids)));
      await kong.insertBlockInFile('configmap', 'plugins:', lines.join('\n'), 'list-item', '    ');
      newPlugins.forEach((p) => w.pluginIds.add(p.id));
      parts.push(`${newPlugins.length} plugin(s)`);
    }
    const newCa = caCerts.filter((c) => c.mode === 'new' && c.pem.trim() && !w.caCertIds.has(c.id));
    for (const c of newCa) {
      const lines = [];
      if (c.comment) lines.push('# ' + c.comment);
      lines.push('- id: ' + c.genId, '  cert: |', ...c.pem.trim().split('\n').map((l) => '    ' + l));
      await kong.insertBlockInFile('values', 'kong_ca_certificates:', lines.join('\n'), 'list-item', '');
      w.caCertIds.add(c.id);
    }
    if (newCa.length) parts.push(`${newCa.length} CA cert(s)`);
    if (tls.clientCertMode === 'new' && tls.clientCertPem.trim() && tls.clientCertKey.trim() && !w.clientCert) {
      const lines = [];
      if (tls.clientCertComment) lines.push('# ' + tls.clientCertComment);
      lines.push(
        '- cert: |-', ...tls.clientCertPem.trim().split('\n').map((l) => '    ' + l),
        '  id: ' + ids.clientCert,
        '  key: |-', ...tls.clientCertKey.trim().split('\n').map((l) => '    ' + l),
      );
      await kong.insertBlockInFile('values', 'kong_client_certificates:', lines.join('\n'), 'list-item', '');
      w.clientCert = true;
      parts.push('client cert');
    }
    const newVars = variables.filter((x) => x.key.trim() && !w.variableKeys.has(x.key.trim()));
    for (const x of newVars) {
      await kong.insertBlockInFile('values', 'kong_services:', `${x.key.trim()}: ${x.value}`, 'keyval', '');
      w.variableKeys.add(x.key.trim());
    }
    if (newVars.length) parts.push(`${newVars.length} variable(s)`);

    setJustWritten(parts.length
      ? `✓ Written: ${parts.join(', ')}. Keep adding more, or click "Done" when finished.`
      : 'Nothing new to write — everything filled in has already been saved.');
  }

  function finishAndClose() {
    resetForm();
    onDone();
  }

  function resetForm() {
    idsRef.current = newIds(dashData);
    setSvc(EMPTY_SVC);
    setRt(emptyRoute());
    setPlugins([]);
    setCaCerts([]);
    setVariables([]);
    setTls(EMPTY_TLS);
    setFieldOn(ALL_FIELDS_ON);
    writtenRef.current = emptyWritten();
    setJustWritten('');
  }

  const setS = (k) => (e) => setSvc({ ...svc, [k]: e.target.value });
  const setR = (k) => (e) => setRt({ ...rt, [k]: e.target.value });
  const setRChecked = (k) => (e) => setRt({ ...rt, [k]: e.target.checked });

  function setClientCertMode(mode) {
    if (mode === 'new' && !idsRef.current.clientCert) idsRef.current.clientCert = generateUniqueId(dashData);
    setTls({ ...tls, clientCertMode: mode });
  }
  function addCaCert() {
    setCaCerts([...caCerts, { id: uuidv4(), genId: generateUniqueId(dashData), mode: 'new', pem: '', existingId: '', comment: '' }]);
  }
  function updateCaCert(id, patch) {
    setCaCerts(caCerts.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeCaCert(id) {
    setCaCerts(caCerts.filter((c) => c.id !== id));
  }
  function updatePlugin(id, patch) {
    setPlugins(plugins.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function updateVariable(id, patch) {
    setVariables(variables.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  const toggle = (key) => <FieldToggle fieldKey={key} fieldOn={fieldOn} setFieldOn={setFieldOn} />;
  const certCount = caCerts.length + (tls.clientCertMode === 'none' ? 0 : 1);

  return (
    <div>
      <div className="tabs-row" style={{ padding: 0, border: 'none', background: 'transparent' }}>
        {['service', 'plugins', 'certs', 'vars'].map((t) => (
          <button key={t} className={`tab ${subTab === t ? 'active' : ''}`} onClick={() => setSubTab(t)}>
            {t === 'service' ? 'Service & Route'
              : t === 'plugins' ? `Plugins (${plugins.length})`
                : t === 'certs' ? `Certificates (${certCount})`
                  : `Variables (${variables.length})`}
          </button>
        ))}
      </div>

      {subTab === 'service' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title">Service</span>
              {writtenRef.current.service && (
                <span style={savedPill} title="Already written — edit this service from the Dashboard afterward">✓ Saved</span>
              )}
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>Comment <InfoIcon field="svc-comment" /></label>
                <input value={svc.comment} onChange={setS('comment')} />
              </div>
              <div className="field-row col2">
                <div className="field">
                  <label>Name <span className="req">*</span> <InfoIcon field="svc-name" /></label>
                  <input value={svc.name} onChange={setS('name')} />
                </div>
                <div className="field">
                  <label>Protocol <InfoIcon field="svc-protocol" /></label>
                  <select value={svc.protocol} onChange={setS('protocol')}>
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </div>
              </div>
              <div className="field-row col3">
                <div className="field">
                  <label>Host <span className="req">*</span> <InfoIcon field="svc-host" /></label>
                  <VarRefField value={svc.host} onChange={(v) => setSvc({ ...svc, host: v })} placeholder="api.example.com or {{ vpnhost }}" variables={allVariables} />
                </div>
                <div className="field">
                  <label>Port <InfoIcon field="svc-port" /> {toggle('port')}</label>
                  <VarRefField value={svc.port} onChange={(v) => setSvc({ ...svc, port: v })} placeholder="443 or {{ vpnport }}" variables={allVariables} />
                </div>
                <div className="field">
                  <label>Path <InfoIcon field="svc-path" /> {toggle('path')}</label>
                  <VarRefField value={svc.path} onChange={(v) => setSvc({ ...svc, path: v })} placeholder="/v1 or {{ myPath }}" variables={allVariables} />
                </div>
              </div>
              <div className="field-row col3">
                <div className="field">
                  <label>Connect Timeout <InfoIcon field="svc-connect-timeout" /> {toggle('connectTimeout')}</label>
                  <input value={svc.connectTimeout} onChange={setS('connectTimeout')} />
                </div>
                <div className="field">
                  <label>Read Timeout <InfoIcon field="svc-read-timeout" /> {toggle('readTimeout')}</label>
                  <input value={svc.readTimeout} onChange={setS('readTimeout')} />
                </div>
                <div className="field">
                  <label>Write Timeout <InfoIcon field="svc-write-timeout" /> {toggle('writeTimeout')}</label>
                  <input value={svc.writeTimeout} onChange={setS('writeTimeout')} />
                </div>
              </div>
              <div className="field">
                <label>Retries <InfoIcon field="svc-retries" /> {toggle('retries')}</label>
                <input value={svc.retries} onChange={setS('retries')} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Route</span>
              {writtenRef.current.route && (
                <span style={savedPill} title="Already written — edit this route from the Dashboard afterward">✓ Saved</span>
              )}
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>Comment <InfoIcon field="rt-comment" /></label>
                <input value={rt.comment} onChange={setR('comment')} />
              </div>
              <div className="field">
                <label>Route Name <span className="req">*</span> <InfoIcon field="rt-name" /></label>
                <input value={rt.name} onChange={setR('name')} />
              </div>
              <div className="field">
                <label>Protocols <InfoIcon field="rt-protocols" /></label>
                <div style={{ display: 'flex', gap: 14 }}>
                  <label className="method-check"><input type="checkbox" checked={rt.protoHttp} onChange={setRChecked('protoHttp')} /> http</label>
                  <label className="method-check"><input type="checkbox" checked={rt.protoHttps} onChange={setRChecked('protoHttps')} /> https</label>
                </div>
              </div>
              <div className="field">
                <label>Paths <InfoIcon field="rt-paths" /> <span className="opt">(comma separated)</span></label>
                <input value={rt.paths} onChange={setR('paths')} />
              </div>
              <div className="field">
                <label>Hosts <InfoIcon field="rt-hosts" /> {toggle('hosts')} <span className="opt">(comma separated)</span></label>
                <input value={rt.hosts} onChange={setR('hosts')} />
              </div>
              <div className="field">
                <label>Methods <InfoIcon field="rt-methods" /> {toggle('methods')}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {HTTP_METHODS.map((m) => (
                    <label className="method-check" key={m}>
                      <input
                        type="checkbox"
                        checked={rt.methods.has(m)}
                        onChange={() => {
                          const next = new Set(rt.methods);
                          if (next.has(m)) next.delete(m); else next.add(m);
                          setRt({ ...rt, methods: next });
                        }}
                      /> {m}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field-row col2">
                <div className="field">
                  <label>Destinations <InfoIcon field="rt-destinations" /> {toggle('destinations')} <span className="opt">(ip:port)</span></label>
                  <input value={rt.destinations} onChange={setR('destinations')} />
                </div>
                <div className="field">
                  <label>Sources <InfoIcon field="rt-sources" /> {toggle('sources')} <span className="opt">(ip:port)</span></label>
                  <input value={rt.sources} onChange={setR('sources')} />
                </div>
              </div>
              <div className="field-row col3">
                <div className="field">
                  <label>Strip Path <InfoIcon field="rt-strip-path" /></label>
                  <select value={String(rt.stripPath)} onChange={(e) => setRt({ ...rt, stripPath: e.target.value === 'true' })}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>
                <div className="field">
                  <label>Preserve Host <InfoIcon field="rt-preserve-host" /></label>
                  <select value={String(rt.preserveHost)} onChange={(e) => setRt({ ...rt, preserveHost: e.target.value === 'true' })}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>
                <div className="field">
                  <label>Regex Priority <InfoIcon field="rt-priority" /> {toggle('priority')}</label>
                  <input value={rt.priority} onChange={setR('priority')} />
                </div>
              </div>
              <div className="field-row col2">
                <div className="field">
                  <label>HTTPS Redirect <InfoIcon field="rt-https-redirect" /> {toggle('httpsRedirect')}</label>
                  <select value={rt.httpsRedirect} onChange={setR('httpsRedirect')}>
                    <option value="none">none</option>
                    <option value="301">301</option>
                    <option value="302">302</option>
                    <option value="426">426 (Upgrade)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Path Handling <InfoIcon field="rt-path-handling" /></label>
                  <select value={rt.pathHandling} onChange={setR('pathHandling')}>
                    <option value="v0">v0</option>
                    <option value="v1">v1</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Request/Response Buffering <InfoIcon field="rt-buffering" /></label>
                <div style={{ display: 'flex', gap: 14 }}>
                  <label className="method-check"><input type="checkbox" checked={rt.requestBuffering} onChange={setRChecked('requestBuffering')} /> request</label>
                  <label className="method-check"><input type="checkbox" checked={rt.responseBuffering} onChange={setRChecked('responseBuffering')} /> response</label>
                </div>
              </div>
              <div className="field">
                <label>Headers <InfoIcon field="rt-headers" /> {toggle('headers')} <span className="opt">(raw YAML)</span></label>
                <textarea rows={3} value={rt.headers} onChange={setR('headers')} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'plugins' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head"><span className="card-title">Plugins</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PluginAdder
              onAdd={(name) => setPlugins([...plugins, {
                id: uuidv4(), name, scope: 'none', comment: '', config: JSON.stringify(PLUGIN_DEFAULTS[name] || {}, null, 2),
              }])}
            />
            {plugins.map((p) => (
              <div className="card plugin-item" style={{ marginTop: 0 }} key={p.id}>
                <div className="plugin-head">
                  <span className="plugin-name">{p.name}</span>
                  <select value={p.scope} onChange={(e) => updatePlugin(p.id, { scope: e.target.value })} style={{ marginLeft: 10, width: 'auto' }}>
                    <option value="none">Global</option>
                    <option value="service">This Service</option>
                    <option value="route">This Route</option>
                  </select>
                  <button className="btn btn-danger btn-sm plugin-remove" onClick={() => setPlugins(plugins.filter((x) => x.id !== p.id))}>✕ Remove</button>
                </div>
                <div className="plugin-body" style={{ display: 'block' }}>
                  <div className="field">
                    <label>Comment</label>
                    <input value={p.comment} onChange={(e) => updatePlugin(p.id, { comment: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Config (JSON)</label>
                    <textarea rows={5} value={p.config} onChange={(e) => updatePlugin(p.id, { config: e.target.value })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'certs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <div className="card">
            <div className="card-head"><span className="card-title">Client Certificate (mTLS)</span></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>Mode</label>
                <select value={tls.clientCertMode} onChange={(e) => setClientCertMode(e.target.value)}>
                  <option value="none">None</option>
                  <option value="new">Create New</option>
                  <option value="existing">Use Existing</option>
                </select>
              </div>
              {tls.clientCertMode === 'new' && (
                <>
                  <div className="field">
                    <label>Comment</label>
                    <input value={tls.clientCertComment} onChange={(e) => setTls({ ...tls, clientCertComment: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Certificate (PEM) <InfoIcon field="cert-pem" /></label>
                    <textarea rows={4} value={tls.clientCertPem} onChange={(e) => setTls({ ...tls, clientCertPem: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                  </div>
                  <div className="field">
                    <label>Private Key (PEM) <InfoIcon field="cert-key" /></label>
                    <textarea rows={4} value={tls.clientCertKey} onChange={(e) => setTls({ ...tls, clientCertKey: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                  </div>
                  <span className="hint">Added to kong_client_certificates: automatically, id: {idsRef.current.clientCert}</span>
                </>
              )}
              {tls.clientCertMode === 'existing' && (
                <ExistingIdField
                  value={tls.clientCertExistingId}
                  onChange={(v) => setTls({ ...tls, clientCertExistingId: v })}
                  dashData={dashData}
                  listName="clientCerts"
                  hasAnyFileLoaded={hasAnyFileLoaded}
                />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><span className="card-title">TLS Verification</span></div>
            <div className="card-body">
              <div className="field-row col2">
                <div className="field">
                  <label>TLS Verify <InfoIcon field="svc-tls-verify" /></label>
                  <select value={tls.tlsVerify} onChange={(e) => setTls({ ...tls, tlsVerify: e.target.value })}>
                    <option value="">~ (not set)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>
                <div className="field">
                  <label>TLS Verify Depth <InfoIcon field="svc-tls-verify-depth" /></label>
                  <input value={tls.tlsVerifyDepth} onChange={(e) => setTls({ ...tls, tlsVerifyDepth: e.target.value })} placeholder="e.g. 1" />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">CA Certificates</span>
              <span className="card-subtitle">{caCerts.length} added</span>
              <button className="btn btn-teal btn-sm" style={{ marginLeft: 'auto' }} onClick={addCaCert}>+ Add CA Certificate</button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {caCerts.length === 0 && <div className="empty">None added — service's ca_certificates will be ~.</div>}
              {caCerts.map((c) => (
                <div className="card" style={{ marginTop: 0 }} key={c.id}>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="field">
                      <label>Mode</label>
                      <select value={c.mode} onChange={(e) => updateCaCert(c.id, { mode: e.target.value })}>
                        <option value="new">Create New</option>
                        <option value="existing">Use Existing</option>
                      </select>
                    </div>
                    {c.mode === 'new' ? (
                      <>
                        <div className="field">
                          <label>Comment</label>
                          <input value={c.comment} onChange={(e) => updateCaCert(c.id, { comment: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Certificate (PEM)</label>
                          <textarea rows={5} value={c.pem} onChange={(e) => updateCaCert(c.id, { pem: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
                        </div>
                        <span className="hint">id: {c.genId}</span>
                      </>
                    ) : (
                      <ExistingIdField
                        value={c.existingId}
                        onChange={(v) => updateCaCert(c.id, { existingId: v })}
                        dashData={dashData}
                        listName="caCerts"
                        hasAnyFileLoaded={hasAnyFileLoaded}
                      />
                    )}
                    <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => removeCaCert(c.id)}>✕ Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === 'vars' && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head">
            <span className="card-title">Variables (kong_services)</span>
            <button
              className="btn btn-teal btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => setVariables([...variables, { id: uuidv4(), key: '', value: '' }])}
            >
              + Add Variable
            </button>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {variables.length === 0 && (
              <div className="empty">No variables yet. Add one, then pick it from the 🔗 menu next to Host / Port / Path.</div>
            )}
            {variables.map((x) => (
              <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
                <input placeholder="varname" value={x.key} onChange={(e) => updateVariable(x.id, { key: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
                <input placeholder="value" value={x.value} onChange={(e) => updateVariable(x.id, { value: e.target.value })} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
                <button className="btn btn-danger btn-sm" onClick={() => setVariables(variables.filter((y) => y.id !== x.id))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {justWritten && (
          <div className="card" style={{ marginBottom: 10, borderColor: 'var(--teal-border)' }}>
            <div className="card-body" style={{ padding: '10px 14px' }}>
              <span className="hint" style={{ color: 'var(--teal)' }}>{justWritten}</span>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-teal" onClick={writeToFiles}>💾 Write to File</button>
          <button className="btn btn-ghost" onClick={finishAndClose}>✓ Done — Back to Dashboard</button>
          <button className="btn btn-ghost" onClick={resetForm}>↺ Reset</button>
          <span className="hint" style={{ marginLeft: 4 }}>
            Write to File only saves what's new since last time — switch tabs and keep adding, then write again whenever you're ready.
          </span>
        </div>
      </div>
    </div>
  );
}

// ✓ / ✕ switch next to an optional field's label: ✕ drops the field from the output.
function FieldToggle({ fieldKey, fieldOn, setFieldOn }) {
  const on = fieldOn[fieldKey];
  return (
    <button
      type="button"
      className={`field-toggle${on ? '' : ' field-off'}`}
      onClick={() => setFieldOn({ ...fieldOn, [fieldKey]: !on })}
      title={on ? 'Included in output — click to exclude this field entirely' : 'Excluded from output — click to include it'}
    >
      {on ? '✓' : '✕'}
    </button>
  );
}

function ExistingIdField({ value, onChange, dashData, listName, hasAnyFileLoaded }) {
  const check = validateExistingId(dashData, hasAnyFileLoaded, value, listName);
  return (
    <div className="field">
      <label>Existing Certificate ID <InfoIcon field="cert-existing-id" /></label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="uuid of existing certificate" />
      {check.msg && (
        <span
          className="hint"
          style={{ color: check.status === 'ok' ? 'var(--teal)' : check.status === 'error' ? 'var(--danger)' : 'var(--text-dim)' }}
        >
          {check.msg}
        </span>
      )}
    </div>
  );
}

function PluginAdder({ onAdd }) {
  const [choice, setChoice] = useState('');
  return (
    <div className="field-row col2">
      <select value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">— choose a plugin —</option>
        {Object.keys(PLUGIN_DEFAULTS).sort().map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button className="btn btn-teal" onClick={() => { if (choice) { onAdd(choice); setChoice(''); } }}>+ Add Plugin</button>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { yamlStr, patchScalarField, patchListField, extractRawBlock, patchRawBlock } from '../../lib/yaml.js';
import { withComment } from '../../lib/entities.js';
import InfoIcon from '../InfoIcon.jsx';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'];

function splitList(s) {
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

// Full route editor — the same fields the Create flow offers.
export default function RouteEditForm({ route, onSave, onCancel, onPreview }) {
  const headersBlock = extractRawBlock(route._raw.split('\n'), 'headers');
  const [f, setF] = useState({
    name: route.name || '',
    protoHttp: (route.protocols || []).includes('http'),
    protoHttps: (route.protocols || []).includes('https'),
    paths: (route.paths || []).join(', '),
    hosts: (route.hosts || []).filter((x) => x !== '~').join(', '),
    methods: new Set((route.methods || []).filter((x) => x !== '~')),
    destinations: (route.destinations || []).filter((x) => x !== '~').join(', '),
    sources: (route.sources || []).filter((x) => x !== '~').join(', '),
    stripPath: route.strip_path !== 'false',
    preserveHost: route.preserve_host !== 'false',
    priority: route.regex_priority || '100',
    httpsRedirect: route.https_redirect_status_code || 'none',
    pathHandling: route.path_handling === 'v1' ? 'v1' : 'v0',
    requestBuffering: route.request_buffering !== 'false',
    responseBuffering: route.response_buffering !== 'false',
    headers: headersBlock ? headersBlock.text : '',
    comment: route.comment || '',
  });

  function buildLines() {
    let lines = route._raw.split('\n');
    lines = patchScalarField(lines, 'name', yamlStr(f.name || 'unnamed'));
    const protocols = [];
    if (f.protoHttp) protocols.push('http');
    if (f.protoHttps) protocols.push('https');
    lines = patchListField(lines, 'protocols', protocols.length ? protocols : ['http']);
    lines = patchListField(lines, 'paths', splitList(f.paths).map(yamlStr));
    lines = patchListField(lines, 'hosts', splitList(f.hosts).map(yamlStr));
    lines = patchListField(lines, 'methods', Array.from(f.methods));
    lines = patchListField(lines, 'destinations', splitList(f.destinations).map(yamlStr));
    lines = patchListField(lines, 'sources', splitList(f.sources).map(yamlStr));
    lines = patchScalarField(lines, 'strip_path', f.stripPath);
    lines = patchScalarField(lines, 'preserve_host', f.preserveHost);
    lines = patchScalarField(lines, 'regex_priority', f.priority || '100');
    lines = patchScalarField(lines, 'https_redirect_status_code', f.httpsRedirect === 'none' ? '~' : f.httpsRedirect);
    lines = patchScalarField(lines, 'path_handling', f.pathHandling);
    lines = patchScalarField(lines, 'request_buffering', f.requestBuffering);
    lines = patchScalarField(lines, 'response_buffering', f.responseBuffering);
    lines = f.headers.trim() ? patchRawBlock(lines, 'headers', f.headers) : patchScalarField(lines, 'headers', '~');
    return withComment(route, lines, f.comment);
  }

  useEffect(() => { onPreview(buildLines().lines); }, [f]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setChecked = (k) => (e) => setF({ ...f, [k]: e.target.checked });
  function toggleMethod(m) {
    const next = new Set(f.methods);
    if (next.has(m)) next.delete(m); else next.add(m);
    setF({ ...f, methods: next });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field">
        <label>Comment <InfoIcon field="rt-comment" /></label>
        <input type="text" value={f.comment} onChange={set('comment')} />
      </div>
      <div className="field">
        <label>Name <InfoIcon field="rt-name" /></label>
        <input type="text" value={f.name} onChange={set('name')} />
      </div>
      <div className="field">
        <label>Protocols <InfoIcon field="rt-protocols" /></label>
        <div style={{ display: 'flex', gap: 14, paddingTop: 4 }}>
          <label className="method-check"><input type="checkbox" checked={f.protoHttp} onChange={setChecked('protoHttp')} /> http</label>
          <label className="method-check"><input type="checkbox" checked={f.protoHttps} onChange={setChecked('protoHttps')} /> https</label>
        </div>
      </div>
      <div className="field">
        <label>Paths <InfoIcon field="rt-paths" /> <span className="opt">(comma separated)</span></label>
        <input type="text" value={f.paths} onChange={set('paths')} />
      </div>
      <div className="field">
        <label>Hosts <InfoIcon field="rt-hosts" /> <span className="opt">(comma separated)</span></label>
        <input type="text" value={f.hosts} onChange={set('hosts')} />
      </div>
      <div className="field">
        <label>Methods <InfoIcon field="rt-methods" /></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          {HTTP_METHODS.map((m) => (
            <label className="method-check" key={m}>
              <input type="checkbox" checked={f.methods.has(m)} onChange={() => toggleMethod(m)} /> {m}
            </label>
          ))}
        </div>
      </div>
      <div className="field-row col2">
        <div className="field">
          <label>Destinations <InfoIcon field="rt-destinations" /></label>
          <input type="text" value={f.destinations} onChange={set('destinations')} />
        </div>
        <div className="field">
          <label>Sources <InfoIcon field="rt-sources" /></label>
          <input type="text" value={f.sources} onChange={set('sources')} />
        </div>
      </div>
      <div className="field-row col3">
        <div className="field">
          <label>Strip Path <InfoIcon field="rt-strip-path" /></label>
          <select value={String(f.stripPath)} onChange={(e) => setF({ ...f, stripPath: e.target.value === 'true' })}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div className="field">
          <label>Preserve Host <InfoIcon field="rt-preserve-host" /></label>
          <select value={String(f.preserveHost)} onChange={(e) => setF({ ...f, preserveHost: e.target.value === 'true' })}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div className="field">
          <label>Regex Priority <InfoIcon field="rt-priority" /></label>
          <input type="text" value={f.priority} onChange={set('priority')} />
        </div>
      </div>
      <div className="field-row col2">
        <div className="field">
          <label>HTTPS Redirect <InfoIcon field="rt-https-redirect" /></label>
          <select value={f.httpsRedirect} onChange={set('httpsRedirect')}>
            <option value="none">none</option>
            <option value="301">301</option>
            <option value="302">302</option>
            <option value="426">426 (Upgrade)</option>
          </select>
        </div>
        <div className="field">
          <label>Path Handling <InfoIcon field="rt-path-handling" /></label>
          <select value={f.pathHandling} onChange={set('pathHandling')}>
            <option value="v0">v0</option>
            <option value="v1">v1</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Request/Response Buffering <InfoIcon field="rt-buffering" /></label>
        <div style={{ display: 'flex', gap: 14, paddingTop: 4 }}>
          <label className="method-check"><input type="checkbox" checked={f.requestBuffering} onChange={setChecked('requestBuffering')} /> request</label>
          <label className="method-check"><input type="checkbox" checked={f.responseBuffering} onChange={setChecked('responseBuffering')} /> response</label>
        </div>
      </div>
      <div className="field">
        <label>Headers <InfoIcon field="rt-headers" /> <span className="opt">(raw YAML)</span></label>
        <textarea rows={3} value={f.headers} onChange={set('headers')} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => onSave(buildLines())}>💾 Save</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

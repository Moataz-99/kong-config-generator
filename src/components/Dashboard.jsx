import { useState, useMemo } from 'react';
import { normId } from '../lib/yaml.js';
import { computeServiceConnectionCounts, entityDeleteRange, dashItemLabel } from '../lib/entities.js';
import PluginEditForm from './forms/PluginEditForm.jsx';
import CertEditForm from './forms/CertEditForm.jsx';
import { askConfirm } from '../lib/host.js';

// First screen: every service with its connection counts, plus an "Other
// Configurations" card for global plugins and certificates no service uses.
export default function Dashboard({ dashData, kong, onOpenService, onDeleteService, onCreateNew, setPreviewLines }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // { type, idx }

  const counts = useMemo(() => computeServiceConnectionCounts(dashData), [dashData]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return dashData.services
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => !q || `${item.name || ''} ${item.host || ''} ${item.id || ''}`.toLowerCase().includes(q));
  }, [dashData.services, query]);

  const { globalPlugins, unlinkedCa, unlinkedClient } = useMemo(() => {
    const referenced = new Set();
    dashData.services.forEach((s) => {
      if (s.client_certificate && normId(s.client_certificate) !== '~') referenced.add(normId(s.client_certificate));
      (s.ca_certificates || []).forEach((id) => { if (id && normId(id) !== '~') referenced.add(normId(id)); });
    });
    return {
      globalPlugins: dashData.plugins.map((item, i) => ({ item, i })).filter((e) => !e.item.service && !e.item.route),
      unlinkedCa: dashData.caCerts.map((item, i) => ({ item, i })).filter((e) => !referenced.has(normId(e.item.id))),
      unlinkedClient: dashData.clientCerts.map((item, i) => ({ item, i })).filter((e) => !referenced.has(normId(e.item.id))),
    };
  }, [dashData]);

  async function deleteOther(type, idx) {
    const arrayName = { plugin: 'plugins', cacert: 'caCerts', clientcert: 'clientCerts' }[type];
    const item = dashData[arrayName][idx];
    const range = entityDeleteRange(type, item);
    if (!range || !(await askConfirm(`Delete ${dashItemLabel(type, item)}?`))) return;
    const fileKey = type === 'plugin' ? 'configmap' : 'values';
    await kong.removeRangesFromFile(fileKey, [range]);
  }

  const hasOther = globalPlugins.length || unlinkedCa.length || unlinkedClient.length;

  return (
    <div id="tab-dashboard" className="panel-section active">
      <div className="card">
        <div className="card-head">
          <span className="card-title">Services</span>
          <span className="card-subtitle">{filtered.length} of {dashData.services.length} shown</span>
          <button className="btn btn-teal btn-sm" style={{ marginLeft: 'auto' }} onClick={onCreateNew}>+ Create New Service</button>
        </div>
        <div className="card-body" style={{ paddingBottom: 8 }}>
          <input type="text" placeholder="🔎 Search by name, host, or id…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div>
          {filtered.length === 0 && <div className="empty">No services match your search.</div>}
          {filtered.map(({ item: s, i }) => {
            const c = counts[normId(s.id)] || { routes: 0, plugins: 0, certs: 0 };
            return (
              <div className="dash-row" key={s.id || i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {s.comment && <div className="dash-row-comment"># {s.comment}</div>}
                  <div className="dash-row-title">{s.name || '(unnamed)'}</div>
                  <div className="dash-row-subtitle">
                    {s.protocol}://{s.host || '?'}{s.port ? `:${s.port}` : ''}
                    {'  ·  🔗 '}{c.routes} route(s), {c.plugins} plugin(s), {c.certs} cert(s)
                  </div>
                </div>
                <span className="dash-row-meta">{(s.id || '').slice(0, 8)}…</span>
                <button className="btn btn-teal btn-sm" onClick={() => onOpenService(i)}>Open →</button>
                <button className="btn btn-danger btn-sm" onClick={() => onDeleteService(i)}>🗑</button>
              </div>
            );
          })}
        </div>
      </div>

      {hasOther > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-head">
            <span className="card-title">Other Configurations</span>
            <span className="card-subtitle">not tied to any service — global plugins &amp; unreferenced certificates</span>
          </div>
          <div>
            {globalPlugins.map(({ item, i }) => (
              <OtherRow
                key={'p' + i}
                item={item}
                title={item.name || '(unnamed plugin)'}
                subtitle="global plugin"
                isEditing={editing?.type === 'plugin' && editing.idx === i}
                onEdit={() => setEditing({ type: 'plugin', idx: i })}
                onDelete={() => deleteOther('plugin', i)}
                editForm={
                  <PluginEditForm
                    plugin={item}
                    onPreview={setPreviewLines}
                    onCancel={() => setEditing(null)}
                    onSave={async ({ start, end, lines }) => {
                      await kong.replaceRangeInFile('configmap', start, end, lines);
                      setEditing(null);
                    }}
                  />
                }
              />
            ))}
            {unlinkedCa.map(({ item, i }) => (
              <OtherRow
                key={'ca' + i}
                item={item}
                title="CA Certificate"
                subtitle={(item.id || '').slice(0, 8) + '… — not referenced by any service'}
                isEditing={editing?.type === 'cacert' && editing.idx === i}
                onEdit={() => setEditing({ type: 'cacert', idx: i })}
                onDelete={() => deleteOther('cacert', i)}
                editForm={
                  <CertEditForm
                    cert={item}
                    type="ca"
                    onPreview={setPreviewLines}
                    onCancel={() => setEditing(null)}
                    onSave={async ({ start, end, lines }) => {
                      await kong.replaceRangeInFile('values', start, end, lines);
                      setEditing(null);
                    }}
                  />
                }
              />
            ))}
            {unlinkedClient.map(({ item, i }) => (
              <OtherRow
                key={'cl' + i}
                item={item}
                title="Client Certificate"
                subtitle={(item.id || '').slice(0, 8) + '… — not referenced by any service'}
                isEditing={editing?.type === 'clientcert' && editing.idx === i}
                onEdit={() => setEditing({ type: 'clientcert', idx: i })}
                onDelete={() => deleteOther('clientcert', i)}
                editForm={
                  <CertEditForm
                    cert={item}
                    type="client"
                    onPreview={setPreviewLines}
                    onCancel={() => setEditing(null)}
                    onSave={async ({ start, end, lines }) => {
                      await kong.replaceRangeInFile('values', start, end, lines);
                      setEditing(null);
                    }}
                  />
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OtherRow({ item, title, subtitle, isEditing, onEdit, onDelete, editForm }) {
  if (isEditing) {
    return <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>{editForm}</div>;
  }
  return (
    <div className="dash-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        {item.comment && <div className="dash-row-comment"># {item.comment}</div>}
        <div className="dash-row-title">{title}</div>
        <div className="dash-row-subtitle">{subtitle}</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onEdit}>✎ Edit</button>
      <button className="btn btn-danger btn-sm" onClick={onDelete}>🗑</button>
    </div>
  );
}

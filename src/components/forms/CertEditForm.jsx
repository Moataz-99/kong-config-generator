import { useState, useEffect } from 'react';
import { extractRawBlock, patchRawBlock } from '../../lib/yaml.js';
import { withComment } from '../../lib/entities.js';
import InfoIcon from '../InfoIcon.jsx';

// type: 'ca' | 'client'. Client certificates also carry a private key.
export default function CertEditForm({ cert, type, onSave, onCancel, onPreview }) {
  const rawLines = cert._raw.split('\n');
  const certBlock = extractRawBlock(rawLines, 'cert');
  const keyBlock = type === 'client' ? extractRawBlock(rawLines, 'key') : null;
  const [f, setF] = useState({
    comment: cert.comment || '',
    cert: certBlock ? certBlock.text : '',
    key: keyBlock ? keyBlock.text : '',
  });

  function buildLines() {
    let lines = cert._raw.split('\n');
    lines = patchRawBlock(lines, 'cert', f.cert);
    if (type === 'client') lines = patchRawBlock(lines, 'key', f.key);
    return withComment(cert, lines, f.comment);
  }

  useEffect(() => { onPreview(buildLines().lines); }, [f]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field">
        <label>Comment <InfoIcon field="cert-comment" /></label>
        <input type="text" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      </div>
      <div className="field">
        <label>Certificate ID</label>
        <input type="text" value={cert.id || ''} disabled style={{ opacity: 0.6 }} />
      </div>
      <div className="field">
        <label>Certificate (PEM) <InfoIcon field="cert-pem" /></label>
        <textarea
          rows={type === 'client' ? 6 : 8}
          value={f.cert}
          onChange={(e) => setF({ ...f, cert: e.target.value })}
          style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
        />
      </div>
      {type === 'client' && (
        <div className="field">
          <label>Private Key (PEM) <InfoIcon field="cert-key" /></label>
          <textarea
            rows={6}
            value={f.key}
            onChange={(e) => setF({ ...f, key: e.target.value })}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => onSave(buildLines())}>💾 Save</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

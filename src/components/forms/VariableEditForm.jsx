import { useState, useEffect } from 'react';
import InfoIcon from '../InfoIcon.jsx';

// One "key: value" line under kong_services: in the values file.
export default function VariableEditForm({ variable, onSave, onCancel, onPreview }) {
  const [key, setKey] = useState(variable.key || '');
  const [value, setValue] = useState(variable.value || '');

  useEffect(() => { onPreview([`${key || variable.key}: ${value}`]); }, [key, value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="field-row col2">
        <div className="field">
          <label>Key <InfoIcon field="var-key" /></label>
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <div className="field">
          <label>Value <InfoIcon field="var-value" /></label>
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-teal" onClick={() => onSave(key.trim() || variable.key, value.trim())}>💾 Save</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

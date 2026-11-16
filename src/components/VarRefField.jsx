import { useMemo } from 'react';

// { key: value } of every variable available to pick: the ones in the values
// file plus any not-yet-written ones from the Create flow.
export function mergeVariableSources(dashData, localVars) {
  const map = {};
  (dashData.variables || []).forEach((v) => { if (v.key) map[v.key] = v.value; });
  (localVars || []).forEach((v) => { if (v.key) map[v.key] = v.value; });
  return map;
}

// A text input with a 🔗 picker that inserts a Helm variable reference. The
// field holds the declaration ({{ .Values.kong_services.x }}), and the hint
// underneath shows the variable's current value.
export default function VarRefField({ value, onChange, placeholder, variables }) {
  const varNames = useMemo(() => Object.keys(variables).sort(), [variables]);

  const hint = useMemo(() => {
    const m = (value || '').trim().match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (!m) return null;
    const name = m[1].replace(/^\.Values\.kong_services\./, '');
    if (name in variables) return { ok: true, text: `→ ${name} = ${variables[name]}` };
    return { ok: false, text: `→ variable "${name}" isn't defined yet` };
  }, [value, variables]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1 }} />
        <select
          className="var-select"
          value=""
          onChange={(e) => { if (e.target.value) onChange(`{{ .Values.kong_services.${e.target.value} }}`); }}
          title="Insert an existing variable"
        >
          <option value="">🔗</option>
          {varNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {hint && (
        <span className="hint" style={{ color: hint.ok ? 'var(--teal)' : 'var(--warning)' }}>{hint.text}</span>
      )}
    </div>
  );
}

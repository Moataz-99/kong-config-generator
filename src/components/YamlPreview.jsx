import { highlightYAML } from '../lib/yaml.js';

// Right-hand pane: syntax-highlighted YAML for whatever is being viewed or edited.
export default function YamlPreview({ lines, label }) {
  if (!lines || !lines.length) {
    return (
      <div className="preview-body" id="yaml-preview">
        <div style={{ padding: 16, color: 'var(--text-dim)', fontStyle: 'italic', whiteSpace: 'pre' }}>
          {'# Fill in the form to generate\n# copiable Kong config blocks here.'}
        </div>
      </div>
    );
  }
  const text = lines.join('\n');
  return (
    <div className="preview-body" id="yaml-preview">
      <div className="yaml-section">
        <div className="yaml-section-head">
          <span className="yaml-section-name">{label || 'Preview'}</span>
          <span className="yaml-section-meta">{lines.length} lines</span>
        </div>
        {/* highlightYAML escapes the text before adding its spans */}
        <div className="yaml-section-body" dangerouslySetInnerHTML={{ __html: highlightYAML(text) }} />
      </div>
    </div>
  );
}

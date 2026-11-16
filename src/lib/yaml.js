// Pure YAML helpers for Kong declarative config inside Helm templates.
// Extracted from the original single-file HTML tool; no React, no DOM.
// Line-based on purpose: we patch existing text surgically instead of
// re-serializing, so comments, ordering and Helm {{ }} expressions survive.

function yamlStr(v) {
  if (v === null || v === undefined || v === '') return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // a value that's entirely a Helm expression (e.g. {{ .Values.kong_services.x }})
    // is always written unquoted, matching how every existing entry in these files
    // does it — quoting would work but silently drift from the file's own style
    if (/^\{\{[\s\S]*\}\}$/.test(v.trim())) return v;
    if (/[:#\[\]{}&*?,|<>=!%@`\n]/.test(v) || v.includes("'")) return JSON.stringify(v);
    return v;
  }
  return String(v);
}

function buildConfigLines(obj, depth) {
  depth = depth || 0;
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(k + ':');
      v.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          const sub = buildConfigLines(item);
          lines.push('  - ' + sub[0]);
          sub.slice(1).forEach(l => lines.push('  ' + l));
        } else {
          lines.push('  - ' + yamlStr(item));
        }
      });
    } else if (typeof v === 'object') {
      const sub = buildConfigLines(v);
      if (sub.length) {
        lines.push(k + ':');
        sub.forEach(l => lines.push('  ' + l));
      }
    } else {
      lines.push(k + ': ' + yamlStr(v));
    }
  }
  return lines;
}

function highlightYAML(yaml) {
  return yaml
    .split('\n')
    .map(line => {
      if (/^#/.test(line.trim())) return '<span class="yaml-comment">' + esc(line) + '</span>';
      if (/^(services|routes|plugins|certificates|snis|upstreams|targets|healthchecks)/.test(line.trim())) {
        return '<span class="yaml-head">' + esc(line) + '</span>';
      }
      let result = line.replace(/^(\s*)([\w_]+)(:)(\s*)(.*)$/, (_, sp, key, col, sp2, val) => {
        const commentSplit = val.match(/^(.*?)(\s+#.*)$/);
        let mainVal = val, comment = '';
        if (commentSplit) { mainVal = commentSplit[1]; comment = commentSplit[2]; }
        let v = '';
        if (/^(true|false)$/.test(mainVal)) v = '<span class="yaml-bool">' + esc(mainVal) + '</span>';
        else if (/^null$/.test(mainVal)) v = '<span class="yaml-null">null</span>';
        else if (/^\d+(\.\d+)?$/.test(mainVal)) v = '<span class="yaml-num">' + esc(mainVal) + '</span>';
        else v = '<span class="yaml-str">' + esc(mainVal) + '</span>';
        return esc(sp) + '<span class="yaml-key">' + esc(key) + esc(col) + '</span>' + esc(sp2) + v + '<span class="yaml-comment">' + esc(comment) + '</span>';
      });
      result = result.replace(/^(\s*)(- )(.*)$/, (_, sp, dash, rest) => {
        return esc(sp) + '<span class="yaml-dash">' + esc(dash) + '</span>' + esc(rest);
      });
      return result;
    })
    .join('\n');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderSections() {
  const preview = document.getElementById('yaml-preview');
  const names = BLOCK_ORDER.filter(f => blockMap[f]);
  if (!names.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = names.map(name => {
    const content = blockMap[name];
    const lineCount = content.split('\n').length;
    return `
      <div class="yaml-section">
        <div class="yaml-section-head">
          <span class="yaml-section-name">${esc(BLOCK_LABEL[name] || name)}</span>
          <span class="yaml-section-meta">${lineCount} lines</span>
          <button class="copy-btn" data-block="${name}" onclick="copyBlock('${name}', this)">⎘ Copy</button>
        </div>
        <div class="yaml-section-body">${highlightYAML(content)}</div>
      </div>
    `;
  }).join('');
}

function normalizeYamlText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '  ');
}

function normId(x) {
  return (x || '').toString().trim().replace(/^["']|["']$/g, '');
}

function extractListItems(content, anchorText) {
  const lines = content.split('\n');
  const anchorIdx = lines.findIndex(l => l.trim() === anchorText);
  if (anchorIdx === -1) return [];
  const anchorIndent = lines[anchorIdx].match(/^(\s*)/)[1];

  // a line at the anchor's own indentation that isn't a list item and isn't a
  // comment must be a *different* top-level key (e.g. "routes:" while scanning
  // "services:") — that marks the end of this section, not something to skip
  function isNewSectionKey(line) {
    const ind = line.match(/^(\s*)/)[1];
    if (ind.length !== anchorIndent.length) return false;
    const t = line.trim();
    if (t === '' || t.startsWith('#') || t.startsWith('- ') || t === '-') return false;
    return true;
  }

  const items = [];
  let i = anchorIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const lineIndent = line.match(/^(\s*)/)[1];
    if (lineIndent.length < anchorIndent.length) break;
    if (isNewSectionKey(line)) break;
    if (lineIndent.length === anchorIndent.length && line.trim().startsWith('- ')) {
      const start = i;
      let j = i + 1;
      while (j < lines.length) {
        const l2 = lines[j];
        if (l2.trim() === '') { j++; continue; }
        const ind2 = l2.match(/^(\s*)/)[1];
        if (ind2.length < anchorIndent.length) break;
        if (isNewSectionKey(l2)) break;
        if (ind2.length === anchorIndent.length && l2.trim().startsWith('- ')) break;
        j++;
      }
      // Comment lines sitting right before the next item (or the next section)
      // belong to THAT item, not this one: stop the range before them, keeping
      // only the blank lines that directly follow this item. Without this,
      // deleting an item also deleted its neighbour's "# comment".
      let end = j;
      while (end > start + 1 && (lines[end - 1].trim() === '' || lines[end - 1].trim().startsWith('#'))) end--;
      while (end < j && lines[end].trim() === '') end++;
      items.push({ startLine: start, endLine: end, text: lines.slice(start, end).join('\n') });
      i = j;
    } else {
      i++; // comment line at anchor indent — skip, doesn't belong to any item
    }
  }

  // attach any directly-preceding comment line(s) to each item — used for display
  // and made editable via a "Comment" field, without disturbing the item's own
  // _start/_end range (which the existing patch functions rely on)
  items.forEach(item => {
    let cStart = item.startLine;
    while (cStart > 0 && lines[cStart - 1].trim().startsWith('#')) cStart--;
    if (cStart < item.startLine) {
      item.commentStartLine = cStart;
      item.comment = lines.slice(cStart, item.startLine).map(l => l.trim().replace(/^#\s?/, '')).join(' ').trim();
    } else {
      item.commentStartLine = null;
      item.comment = '';
    }
  });
  return items;
}

function parseSimpleFields(itemLines) {
  const fields = {};
  if (!itemLines.length) return fields;
  const dashMatch = itemLines[0].match(/^(\s*)-\s?/);
  const baseIndent = dashMatch ? dashMatch[1].length + 2 : 0;
  itemLines.forEach((line, idx) => {
    const content = idx === 0 ? line.replace(/^\s*-\s?/, '') : line;
    const contentIndent = idx === 0 ? baseIndent : line.match(/^(\s*)/)[1].length;
    if (contentIndent !== baseIndent) return;
    const m = content.match(/^\s*([\w_]+):\s*(.*)$/);
    if (m && m[2].trim() !== '') fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return fields;
}

function extractNestedList(itemLines, key) {
  let keyIdx = -1;
  let keyEffectiveIndent = 0;
  for (let idx = 0; idx < itemLines.length; idx++) {
    const line = itemLines[idx];
    const dashMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (dashMatch && dashMatch[2] === key + ':') {
      // key is the item's very first field, combined with the dash (e.g. "- protocols:")
      keyIdx = idx;
      keyEffectiveIndent = dashMatch[1].length + 2;
      break;
    }
    if (line.trim() === key + ':') {
      keyIdx = idx;
      keyEffectiveIndent = line.match(/^(\s*)/)[1].length;
      break;
    }
  }
  if (keyIdx === -1) return [];

  const results = [];
  let i = keyIdx + 1;
  while (i < itemLines.length) {
    const l = itemLines[i];
    if (l.trim() === '') { i++; continue; }
    const ind = l.match(/^(\s*)/)[1].length;
    if (ind < keyEffectiveIndent) break;
    if (ind === keyEffectiveIndent) {
      const m = l.match(/^\s*-\s*(.*)$/);
      if (m) { results.push(m[1].trim().replace(/^["']|["']$/g, '')); i++; continue; }
      break; // same indent but not a dash => a sibling key, list has ended
    }
    i++; // deeper indent — nested sub-content under a list entry, skip
  }
  return results;
}

function parseConfigMap(content) {
  const services = extractListItems(content, 'services:').map(item => {
    const lines = item.text.split('\n');
    const fields = parseSimpleFields(lines);
    fields.ca_certificates = extractNestedList(lines, 'ca_certificates');
    return { ...fields, _start: item.startLine, _end: item.endLine, _raw: item.text, _commentStart: item.commentStartLine, comment: item.comment };
  });
  const routes = extractListItems(content, 'routes:').map(item => {
    const lines = item.text.split('\n');
    const fields = parseSimpleFields(lines);
    fields.protocols = extractNestedList(lines, 'protocols');
    fields.paths = extractNestedList(lines, 'paths');
    fields.hosts = extractNestedList(lines, 'hosts');
    fields.methods = extractNestedList(lines, 'methods');
    fields.destinations = extractNestedList(lines, 'destinations');
    fields.sources = extractNestedList(lines, 'sources');
    return { ...fields, _start: item.startLine, _end: item.endLine, _raw: item.text, _commentStart: item.commentStartLine, comment: item.comment };
  });
  const plugins = extractListItems(content, 'plugins:').map(item => {
    const lines = item.text.split('\n');
    return { ...parseSimpleFields(lines), _start: item.startLine, _end: item.endLine, _raw: item.text, _commentStart: item.commentStartLine, comment: item.comment };
  });
  return { services, routes, plugins };
}

function parseValuesFile(content) {
  const caCerts = extractListItems(content, 'kong_ca_certificates:').map(item => {
    const lines = item.text.split('\n');
    return { ...parseSimpleFields(lines), _start: item.startLine, _end: item.endLine, _raw: item.text, _commentStart: item.commentStartLine, comment: item.comment };
  });
  const clientCerts = extractListItems(content, 'kong_client_certificates:').map(item => {
    const lines = item.text.split('\n');
    return { ...parseSimpleFields(lines), _start: item.startLine, _end: item.endLine, _raw: item.text, _commentStart: item.commentStartLine, comment: item.comment };
  });
  const variables = [];
  const lines = content.split('\n');
  const kIdx = lines.findIndex(l => l.trim() === 'kong_services:');
  if (kIdx !== -1) {
    const anchorIndent = lines[kIdx].match(/^(\s*)/)[1];
    let i = kIdx + 1;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') { i++; continue; }
      const ind = l.match(/^(\s*)/)[1];
      if (ind.length <= anchorIndent.length) break;
      const m = l.match(/^\s*([\w_]+):\s*(.*)$/);
      if (m) variables.push({ key: m[1], value: m[2].trim(), _line: i });
      i++;
    }
  }
  return { caCerts, clientCerts, variables };
}

function findTopLevelKeyLine(rawLines, key) {
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const dashMatch = line.match(/^(\s*)-\s(.*)$/);
    if (i === 0 && dashMatch) {
      const m = dashMatch[2].match(/^([\w_]+):(\s*)(.*)$/);
      if (m && m[1] === key) return { idx: i, indent: dashMatch[1].length + 2, prefix: dashMatch[1] + '- ', value: m[3] };
    }
    const m2 = line.match(/^(\s*)([\w_]+):(\s*)(.*)$/);
    if (m2 && m2[2] === key) return { idx: i, indent: m2[1].length, prefix: m2[1], value: m2[4] !== undefined ? m2[4] : '' };
  }
  return null;
}

function patchScalarField(rawLines, key, newValue) {
  const lines = rawLines.slice();
  const found = findTopLevelKeyLine(lines, key);
  if (found) {
    lines[found.idx] = found.prefix + key + ': ' + newValue;
    return lines;
  }
  // field doesn't exist yet — append it at the same indent as the item's other
  // fields (derived from the first field line, since the dash line itself starts
  // one level shallower)
  const firstFieldLine = rawLines.find((l, i) => i > 0 && l.trim() !== '') || rawLines[0];
  const fieldIndent = firstFieldLine.match(/^(\s*)/)[1] || '  ';
  lines.push(fieldIndent + key + ': ' + newValue);
  return lines;
}

function patchListField(rawLines, key, newItems) {
  const lines = rawLines.slice();
  const found = findTopLevelKeyLine(lines, key);
  if (!found) {
    // field doesn't exist yet — append as a new list (or ~ if empty) at a
    // reasonable 2-space indent, since there's no existing item context to match
    if (!newItems.length) { lines.push('  ' + key + ': ~'); return lines; }
    lines.push('  ' + key + ':');
    newItems.forEach(v => lines.push('  - ' + v));
    return lines;
  }
  // determine the extent of the existing value (scalar OR nested list) to remove
  let end = found.idx + 1;
  if (!found.value || found.value === '') {
    // key had no inline value — it may own a nested list; consume same-indent dashes
    while (end < lines.length) {
      const l = lines[end];
      if (l.trim() === '') { end++; continue; }
      const ind = l.match(/^(\s*)/)[1].length;
      if (ind < found.indent) break;
      if (ind === found.indent && l.trim().startsWith('- ')) { end++; continue; }
      if (ind === found.indent) break; // a sibling key at the same level
      end++; // deeper nested content under a list entry
    }
  }
  const before = lines.slice(0, found.idx);
  const after = lines.slice(end);
  // new items must sit at the SAME indentation as the key itself — this file's
  // convention has list dashes level with their key, not indented further
  const itemIndent = ' '.repeat(found.indent);
  const replacement = !newItems.length
    ? [found.prefix + key + ': ~']
    : [found.prefix + key + ':', ...newItems.map(v => itemIndent + '- ' + v)];
  return [...before, ...replacement, ...after];
}

function extractRawBlock(rawLines, key) {
  const found = findTopLevelKeyLine(rawLines, key);
  if (!found) return null;
  const blockLines = [];
  let i = found.idx + 1;
  while (i < rawLines.length) {
    const l = rawLines[i];
    if (l.trim() === '') { blockLines.push(''); i++; continue; }
    const ind = l.match(/^(\s*)/)[1].length;
    if (ind <= found.indent) break;
    blockLines.push(l.slice(found.indent + 2));
    i++;
  }
  return { startIdx: found.idx, endIdx: i, indent: found.indent, prefix: found.prefix, text: blockLines.join('\n') };
}

function patchRawBlock(rawLines, key, newBlockText) {
  const lines = rawLines.slice();
  const found = extractRawBlock(lines, key);
  const newLines = newBlockText.split('\n').map(l => ' '.repeat(found ? found.indent + 2 : 2) + l);
  if (!found) {
    lines.push(' '.repeat(2) + key + ':');
    return [...lines, ...newLines];
  }
  const keyLine = found.prefix + key + ':';
  const before = lines.slice(0, found.startIdx);
  const after = lines.slice(found.endIdx);
  return [...before, keyLine, ...newLines, ...after];
}

function escAttr(s) { return esc(String(s == null ? '' : s)).replace(/"/g, '&quot;'); }

// short, plain-language descriptions of Kong parameters, shown as hover tooltips
// next to each field label in both Create and Edit forms
const FIELD_INFO = {
  'svc-name': 'A unique name for this service — used to reference it from routes and plugins.',
  'svc-protocol': 'The protocol Kong uses to talk to the upstream (backend) — http or https.',
  'svc-host': 'The hostname or IP of the upstream Kong forwards requests to.',
  'svc-port': 'The port the upstream listens on.',
  'svc-path': 'A path prefix added to every request Kong forwards to the upstream.',
  'svc-connect-timeout': 'Max time (ms) Kong waits to establish a connection to the upstream.',
  'svc-read-timeout': 'Max time (ms) Kong waits for the upstream to respond.',
  'svc-write-timeout': 'Max time (ms) Kong waits to send the request to the upstream.',
  'svc-retries': 'How many times Kong retries connecting to the upstream if it fails.',
  'svc-enabled': 'Whether this service is active. Disabled services return an error to clients.',
  'svc-comment': 'A plain YAML comment shown above this entry — for documentation only, no effect on behavior.',
  'svc-client-cert': "The certificate Kong presents to the upstream when connecting over mTLS.",
  'svc-tls-verify': "Whether Kong verifies the upstream's TLS certificate against trusted CAs.",
  'svc-tls-verify-depth': 'How many certificates deep Kong checks in the chain of trust.',
  'svc-ca-certs': "Trusted CA certificates Kong uses to verify the upstream's certificate.",

  'rt-name': 'A unique name for this route.',
  'rt-protocols': 'Which protocols (http/https) this route accepts incoming traffic on.',
  'rt-paths': 'URL path patterns that must match the request for this route to trigger.',
  'rt-hosts': 'Hostnames (from the Host header) that must match for this route to trigger.',
  'rt-methods': 'HTTP methods this route accepts. Leave all unchecked to accept any method.',
  'rt-destinations': "The original destination IP:port that must match (used for TCP/TLS-level routing).",
  'rt-sources': 'Client IP:port combinations that must match for this route to trigger.',
  'rt-strip-path': 'If true, removes the matched path prefix before forwarding to the upstream.',
  'rt-preserve-host': "If true, forwards the client's original Host header instead of the upstream's hostname.",
  'rt-priority': 'When several routes could match the same request, the higher number wins.',
  'rt-https-redirect': 'Status code Kong replies with to push HTTP clients to HTTPS. "none" disables this.',
  'rt-path-handling': 'How the route path and service path are combined — v0 is the legacy behavior, v1 follows RFC 3986.',
  'rt-buffering': "Whether Kong buffers the full request/response body before proxying it, instead of streaming.",
  'rt-headers': 'Header name/value patterns that must match for this route to trigger. Raw YAML.',
  'rt-comment': 'A plain YAML comment shown above this entry — for documentation only, no effect on behavior.',

  'pl-name': 'The Kong plugin to apply, e.g. rate-limiting, jwt, cors.',
  'pl-scope': "Where this plugin runs — Global (every request), This Service (only its traffic), or a specific Route.",
  'pl-enabled': 'Whether this plugin is active. Disabled plugins are ignored at runtime.',
  'pl-config': "The plugin's own settings, following that plugin's configuration schema.",
  'pl-comment': 'A plain YAML comment shown above this entry — for documentation only, no effect on behavior.',

  'cert-comment': 'A plain YAML comment shown above this entry — for documentation only, no effect on behavior.',
  'cert-pem': 'The public certificate, in PEM format (-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----).',
  'cert-key': 'The private key, in PEM format. Keep this secret — anyone with it can impersonate this certificate.',
  'cert-existing-id': "The UUID of a certificate that already exists in your Values file — links to it instead of creating a new one.",

  'var-key': 'The variable name — reference it elsewhere as {{ name }}.',
  'var-value': 'The actual value substituted in wherever this variable is referenced.',
}

function extractVarRefs(str) {
  if (!str) return [];
  return [...str.matchAll(/\{\{\s*\.Values\.kong_services\.(\w+)\s*\}\}/g)].map(m => m[1]);
}

function injectBlock(fileLines, anchorText, blockContent, mode, defaultIndent, replaceRange) {
  if (!blockContent.trim()) return { lines: fileLines, injectedLines: new Set() };

  const raw = blockContent.trim().split('\n')
    .map(l => mode === 'keyval' ? l.trim() : l)
    .filter(l => mode !== 'keyval' || l.length);

  const anchorIdx = fileLines.findIndex(l => l.trim() === anchorText);
  const anchorIndent = anchorIdx !== -1 ? fileLines[anchorIdx].match(/^(\s*)/)[1] : defaultIndent;
  const prefix = mode === 'keyval' ? anchorIndent + '  ' : anchorIndent;
  const indented = raw.map(l => prefix + l);

  if (replaceRange) {
    // edit mode: replace the exact original lines for this entity in place
    const before = fileLines.slice(0, replaceRange.start);
    const after = fileLines.slice(replaceRange.end);
    const lines = [...before, ...indented, ...after];
    const injectedLines = new Set(Array.from({ length: indented.length }, (_, i) => replaceRange.start + i));
    return { lines, injectedLines };
  }

  if (anchorIdx === -1) {
    // anchor not found in this file — append a fresh section at the end
    const appended = [...fileLines, '', defaultIndent + anchorText, ...indented];
    const insertStart = fileLines.length + 2;
    const injectedLines = new Set(Array.from({ length: indented.length }, (_, i) => insertStart + i));
    return { lines: appended, injectedLines };
  }

  const before = fileLines.slice(0, anchorIdx + 1);
  const after = fileLines.slice(anchorIdx + 1);
  const lines = [...before, ...indented, ...after];
  const injectedLines = new Set(Array.from({ length: indented.length }, (_, i) => anchorIdx + 1 + i));
  return { lines, injectedLines };
}

function highlightYAMLLine(line) {
  const e = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if (/^\s*#/.test(line)) return `<span class="yaml-comment">${e(line)}</span>`;
  if (/^(kong_services|kong_ca_certificates|kong_client_certificates|route|nginx_certs|deployment|plugins|upstreams|targets|services|routes|certificates|ca_certificates|consumers|jwt_secrets):/.test(line.trim())) {
    return `<span class="yaml-head">${e(line)}</span>`;
  }
  let result = line.replace(/^(\s*)([\w_]+)(:)(\s*)(.*)$/, (_, sp, key, col, sp2, val) => {
    const cm = val.match(/^(.*?)(\s+#.*)$/);
    let mainVal = val, comment = '';
    if (cm) { mainVal = cm[1]; comment = cm[2]; }
    let v = /^(true|false)$/.test(mainVal) ? `<span class="yaml-bool">${e(mainVal)}</span>`
           : /^(~|null)$/.test(mainVal)     ? `<span class="yaml-null">${e(mainVal)}</span>`
           : /^\d+(\.\d+)?$/.test(mainVal)  ? `<span class="yaml-num">${e(mainVal)}</span>`
           : `<span class="yaml-str">${e(mainVal)}</span>`;
    return `${e(sp)}<span class="yaml-key">${e(key)}${e(col)}</span>${e(sp2)}${v}<span class="yaml-comment">${e(comment)}</span>`;
  });
  result = result.replace(/^(\s*)(- )(.*)$/, (_, sp, dash, rest) =>
    `${e(sp)}<span class="yaml-dash">${e(dash)}</span>${rest}`);
  return result;
}

export {
  yamlStr,
  buildConfigLines,
  highlightYAML,
  esc,
  normalizeYamlText,
  normId,
  extractListItems,
  parseSimpleFields,
  extractNestedList,
  parseConfigMap,
  parseValuesFile,
  findTopLevelKeyLine,
  patchScalarField,
  patchListField,
  extractRawBlock,
  patchRawBlock,
  escAttr,
  extractVarRefs,
  injectBlock,
  highlightYAMLLine,
};

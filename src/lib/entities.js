// Entity-level helpers that sit on top of the line-based YAML library:
// UUID generation with collision checks, comment handling, delete ranges,
// "what is connected to this service" lookups and the cascade delete.
// Everything here is pure except cascadeDeleteService, which asks for
// confirmation and writes through the useKongData hook.

import { normId } from './yaml.js';
import { askConfirm } from './host.js';

export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Every id that already exists in the loaded files (services, routes, certs).
export function getAllKnownIds(dashData) {
  const known = new Set();
  (dashData.services || []).forEach((s) => { if (s.id) known.add(normId(s.id)); });
  (dashData.routes || []).forEach((r) => { if (r.id) known.add(normId(r.id)); });
  (dashData.caCerts || []).forEach((c) => { if (c.id) known.add(normId(c.id)); });
  (dashData.clientCerts || []).forEach((c) => { if (c.id) known.add(normId(c.id)); });
  return known;
}

// A fresh UUID that is guaranteed not to collide with anything already loaded.
export function generateUniqueId(dashData) {
  const known = getAllKnownIds(dashData);
  let id = uuidv4();
  let guard = 0;
  while (known.has(normId(id)) && guard < 10) {
    id = uuidv4();
    guard++;
  }
  return id;
}

// Used when the user types/pastes an id to link to something that already exists.
export function validateExistingId(dashData, hasAnyFileLoaded, id, listName) {
  const trimmed = normId(id);
  if (!trimmed) return { status: 'empty', msg: '' };
  if (!hasAnyFileLoaded) return { status: 'unknown', msg: 'Load your files to verify this ID exists' };
  const found = (dashData[listName] || []).some((item) => normId(item.id) === trimmed);
  return found
    ? { status: 'ok', msg: '✓ Found in loaded file' }
    : { status: 'error', msg: '✗ Not found in the loaded file — check for typos' };
}

// Wraps patched item lines with the entity's "# comment" line and returns the
// file range to replace. The range starts at the old comment (if any) so the
// comment is replaced, not duplicated. itemLines are already indented.
export function withComment(entity, itemLines, newComment) {
  const hadComment = entity._commentStart !== undefined && entity._commentStart !== null;
  const start = hadComment ? entity._commentStart : entity._start;
  const end = entity._end;
  const trimmed = (newComment || '').trim();
  if (!trimmed) return { start, end, lines: itemLines };
  const itemIndent = entity._raw.match(/^(\s*)/)[1];
  return { start, end, lines: [itemIndent + '# ' + trimmed, ...itemLines] };
}

export function dashItemLabel(type, item) {
  if (type === 'service') return 'service "' + (item.name || item.id || 'unnamed') + '"';
  if (type === 'route') return 'route "' + (item.name || item.id || 'unnamed') + '"';
  if (type === 'plugin') return 'plugin "' + (item.name || 'unnamed') + '"';
  if (type === 'cacert') return 'CA certificate ' + (item.id || '');
  if (type === 'clientcert') return 'client certificate ' + (item.id || '');
  if (type === 'variable') return 'variable "' + (item.key || '') + '"';
  return 'item';
}

// The [start, end) line range an entity occupies, including its comment line.
export function entityDeleteRange(type, item) {
  if (type === 'variable') {
    if (item._line === undefined) return null;
    return { start: item._line, end: item._line + 1 };
  }
  if (item._start === undefined || item._end === undefined) return null;
  const start = item._commentStart !== undefined && item._commentStart !== null ? item._commentStart : item._start;
  return { start, end: item._end };
}

// Removes several [start, end) ranges from a line array in one pass.
// Overlapping ranges are merged so nothing is removed twice.
export function removeRanges(lines, ranges) {
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  });
  const out = [];
  let cursor = 0;
  merged.forEach((r) => {
    out.push(...lines.slice(cursor, r.start));
    cursor = r.end;
  });
  out.push(...lines.slice(cursor));
  return out;
}

// Per-service counts shown on each Dashboard row.
export function computeServiceConnectionCounts(dashData) {
  const counts = {};
  dashData.services.forEach((s) => { counts[normId(s.id)] = { routes: 0, plugins: 0, certs: 0 }; });
  const routeToService = {};
  dashData.routes.forEach((r) => {
    const sid = normId(r.service);
    if (counts[sid]) counts[sid].routes++;
    routeToService[normId(r.id)] = sid;
  });
  dashData.plugins.forEach((p) => {
    if (p.service && counts[normId(p.service)]) counts[normId(p.service)].plugins++;
    else if (p.route) {
      const sid = routeToService[normId(p.route)];
      if (sid && counts[sid]) counts[sid].plugins++;
    }
  });
  dashData.services.forEach((s) => {
    const sid = normId(s.id);
    let n = 0;
    if (s.client_certificate && normId(s.client_certificate) !== '~') n++;
    (s.ca_certificates || []).forEach((id) => { if (id && normId(id) !== '~') n++; });
    counts[sid].certs = n;
  });
  return counts;
}

// Everything attached to one service. Each list is [{ item, i }] where i is
// the item's index in the global dashData array (needed for editing).
export function getServiceConnections(dashData, service, extractVarRefsFn) {
  const sId = normId(service.id);
  const relatedRoutes = dashData.routes
    .map((item, i) => ({ item, i }))
    .filter((e) => normId(e.item.service) === sId);
  const routeIds = new Set(relatedRoutes.map((e) => normId(e.item.id)));
  const relatedPlugins = dashData.plugins
    .map((item, i) => ({ item, i }))
    .filter((e) => normId(e.item.service) === sId || (e.item.route && routeIds.has(normId(e.item.route))));
  const certIds = new Set();
  if (service.client_certificate && normId(service.client_certificate) !== '~') certIds.add(normId(service.client_certificate));
  (service.ca_certificates || []).forEach((id) => { if (id && normId(id) !== '~') certIds.add(normId(id)); });
  const relatedCaCerts = dashData.caCerts
    .map((item, i) => ({ item, i }))
    .filter((e) => certIds.has(normId(e.item.id)));
  const relatedClientCerts = dashData.clientCerts
    .map((item, i) => ({ item, i }))
    .filter((e) => certIds.has(normId(e.item.id)));
  // only the variables this service actually references (host / path / port)
  const usedVarKeys = new Set([
    ...extractVarRefsFn(service.host),
    ...extractVarRefsFn(service.path),
    ...extractVarRefsFn(service.port),
  ]);
  const relatedVariables = dashData.variables
    .map((item, i) => ({ item, i }))
    .filter((e) => usedVarKeys.has(e.item.key));
  return { relatedRoutes, relatedPlugins, relatedCaCerts, relatedClientCerts, relatedVariables, usedVarKeys };
}

// The always-on "full service" preview in the right pane of the detail view.
export function buildServiceFullPreviewLines(dashData, service, extractVarRefsFn) {
  if (!service) return [];
  const { relatedRoutes, relatedPlugins, relatedCaCerts, relatedClientCerts } =
    getServiceConnections(dashData, service, extractVarRefsFn);
  const out = [];
  out.push('# ── SERVICE ──');
  out.push(...service._raw.split('\n'));
  if (relatedRoutes.length) {
    out.push('');
    out.push('# ── ROUTES ──');
    relatedRoutes.forEach(({ item }) => { out.push(...item._raw.split('\n')); out.push(''); });
  }
  if (relatedPlugins.length) {
    out.push('# ── PLUGINS ──');
    relatedPlugins.forEach(({ item }) => { out.push(...item._raw.split('\n')); out.push(''); });
  }
  if (relatedCaCerts.length || relatedClientCerts.length) {
    out.push('# ── CERTIFICATES ──');
    relatedCaCerts.forEach(({ item }) => { out.push(...item._raw.split('\n')); out.push(''); });
    relatedClientCerts.forEach(({ item }) => { out.push(...item._raw.split('\n')); out.push(''); });
  }
  return out;
}

export const DASH_TYPE_TO_ARRAY = {
  service: 'services', route: 'routes', plugin: 'plugins',
  cacert: 'caCerts', clientcert: 'clientCerts', variable: 'variables',
};
export const DASH_TYPE_TO_FILE = {
  service: 'configmap', route: 'configmap', plugin: 'configmap',
  cacert: 'values', clientcert: 'values', variable: 'values',
};

// Deletes a service plus its routes, its plugins (service- and route-scoped)
// and any certificates no OTHER service still references. Returns true if the
// user confirmed and the delete ran.
export async function cascadeDeleteService(dashData, service, kong) {
  const sId = normId(service.id);
  const relatedRoutes = dashData.routes.filter((r) => normId(r.service) === sId);
  const relatedRouteIds = new Set(relatedRoutes.map((r) => normId(r.id)));
  const relatedPlugins = dashData.plugins.filter(
    (p) => normId(p.service) === sId || (p.route && relatedRouteIds.has(normId(p.route))),
  );

  const thisCertIds = new Set();
  if (service.client_certificate && normId(service.client_certificate) !== '~') thisCertIds.add(normId(service.client_certificate));
  (service.ca_certificates || []).forEach((id) => { if (id && normId(id) !== '~') thisCertIds.add(normId(id)); });

  // reference-count certs across every other service: shared certs survive
  const refCount = {};
  dashData.services.forEach((other) => {
    if (normId(other.id) === sId) return;
    if (other.client_certificate && normId(other.client_certificate) !== '~') {
      const k = normId(other.client_certificate);
      refCount[k] = (refCount[k] || 0) + 1;
    }
    (other.ca_certificates || []).forEach((cid) => {
      if (cid && normId(cid) !== '~') refCount[normId(cid)] = (refCount[normId(cid)] || 0) + 1;
    });
  });
  const caToDelete = dashData.caCerts.filter((c) => thisCertIds.has(normId(c.id)) && !refCount[normId(c.id)]);
  const clientToDelete = dashData.clientCerts.filter((c) => thisCertIds.has(normId(c.id)) && !refCount[normId(c.id)]);

  const summary = [
    dashItemLabel('service', service),
    relatedRoutes.length && `${relatedRoutes.length} route(s)`,
    relatedPlugins.length && `${relatedPlugins.length} plugin(s)`,
    caToDelete.length && `${caToDelete.length} CA certificate(s)`,
    clientToDelete.length && `${clientToDelete.length} client certificate(s)`,
  ].filter(Boolean).join(', ');
  if (!(await askConfirm(`Delete ${summary}?\n\nThis cannot be undone (unless you Revert).`))) return false;

  const cmRanges = [
    entityDeleteRange('service', service),
    ...relatedRoutes.map((r) => entityDeleteRange('route', r)),
    ...relatedPlugins.map((p) => entityDeleteRange('plugin', p)),
  ].filter(Boolean);
  if (cmRanges.length) await kong.removeRangesFromFile('configmap', cmRanges);

  const vRanges = [
    ...caToDelete.map((c) => entityDeleteRange('cacert', c)),
    ...clientToDelete.map((c) => entityDeleteRange('clientcert', c)),
  ].filter(Boolean);
  if (vRanges.length) await kong.removeRangesFromFile('values', vRanges);
  return true;
}

// Turns the short form {{ name }} into the Helm reference the files use,
// {{ .Values.kong_services.name }}. Values already in full form are untouched.
export function expandVarRefs(val) {
  if (!val) return val;
  return String(val).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => '{{ .Values.kong_services.' + k + ' }}');
}

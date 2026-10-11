/* Retailer return policies: versioned JSON files in policies/, checked against policies/schema.json, plus store-name matching. */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..', 'policies');

/* A small JSON Schema checker covering the keywords policies/schema.json uses. Returns a list of "path: problem" strings. */
function validate(value, schema, root = schema, at = '$', errors = []) {
  if (schema.$ref) {
    const def = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
    validate(value, def, root, at, errors);
  }
  const isType = (t, v) => t === 'integer' ? Number.isInteger(v) : t === 'array' ? Array.isArray(v) : t === 'null' ? v === null : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === t;
  if (schema.type && ![].concat(schema.type).some(t => isType(t, value))) { errors.push(`${at}: should be ${schema.type}`); return errors; }
  if ('const' in schema && value !== schema.const) errors.push(`${at}: should be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: should be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`);
  if (schema.anyOf && !schema.anyOf.some(s => !validate(value, s, root, at, []).length)) errors.push(`${at}: doesn't match any allowed form`);
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${at}: is too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: doesn't match ${schema.pattern}`);
  }
  if (typeof value === 'number' && 'minimum' in schema && value < schema.minimum) errors.push(`${at}: should be at least ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} entries`);
    if (schema.items) value.forEach((v, i) => validate(v, schema.items, root, `${at}[${i}]`, errors));
  }
  if (isType('object', value)) {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${at}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && schema.properties[k]) validate(v, schema.properties[k], root, `${at}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected ${k}`);
    }
  }
  return errors;
}

/* Every fact must name its source and the day it was checked. Walks the whole policy so nothing slips through. */
function unsourcedFacts(policy) {
  const missing = [];
  const walk = (v, at) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (!v || typeof v !== 'object') return;
    const isFact = 'value' in v || 'returnable' in v || 'effect' in v || 'returnBy' in v && 'season' in v || 'amount' in v || 'steps' in v || 'topic' in v;
    if (isFact && (!/^https:\/\//.test(v.source || '') || !/^\d{4}-\d{2}-\d{2}$/.test(v.checked || ''))) missing.push(at);
    for (const [k, x] of Object.entries(v)) if (k !== 'value') walk(x, `${at}.${k}`);
  };
  walk(policy, '$');
  return missing;
}

/* Loads policies/<id>.json (current) and policies/history/<id>.v<N>.json (past versions). Throws if any file is invalid. */
function loadPolicies(dir = DIR) {
  const schema = JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8'));
  const read = file => {
    const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
    const problems = [...validate(policy, schema), ...unsourcedFacts(policy).map(p => `${p}: needs a source URL and checked date`)];
    if (problems.length) throw new Error(`${path.relative(dir, file)} is invalid:\n  ${problems.join('\n  ')}`);
    return policy;
  };
  const jsonFiles = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json') && f !== 'schema.json').sort().map(f => path.join(d, f)) : [];
  const current = jsonFiles(dir).map(f => {
    const p = read(f);
    if (path.basename(f) !== `${p.id}.json`) throw new Error(`${path.basename(f)} should be named ${p.id}.json`);
    return p;
  });
  const history = jsonFiles(path.join(dir, 'history')).map(f => {
    const p = read(f);
    if (path.basename(f) !== `${p.id}.v${p.version}.json`) throw new Error(`history/${path.basename(f)} should be named ${p.id}.v${p.version}.json`);
    return p;
  });
  for (const old of history) {
    const now = current.find(p => p.id === old.id);
    if (!now) throw new Error(`history/${old.id}.v${old.version}.json has no current ${old.id}.json`);
    if (old.version >= now.version) throw new Error(`${old.id}.json must have a higher version than history/${old.id}.v${old.version}.json`);
  }
  return catalog(current, history);
}

/* Store names as they appear on receipts and card statements: "AMZN Mktp US*2K4AB1C2" → "amzn mktp us". */
function normalizeStoreName(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\*\S*/g, ' ')
    .replace(/&/g, ' and ').replace(/['’]/g, '')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b[a-z]{0,2}-?\d+\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(t => t && !/\d/.test(t)).join(' ');
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/* The existing item fields a policy can fill. "unknown" lists fields the source didn't confirm; dates fall back to the earlier option. */
function itemFields(policy) {
  const f = policy.item, unknown = [];
  const window = Number.isInteger(f.window.value) ? f.window.value : null;
  if (f.window.value === 'unknown') unknown.push('window');
  // Shipment happens after purchase, so counting from purchase is the safer (earlier) deadline.
  const basis = f.basis.value === 'delivery' ? 'delivery' : 'purchase';
  if (f.basis.value === 'unknown') unknown.push('basis');
  for (const k of ['outcome', 'requirement', 'processing']) if (f[k].value === 'unknown') unknown.push(k);
  return {
    window, basis,
    outcome: f.outcome.value,
    requirement: f.requirement.value,
    url: f.url.value,
    conditions: f.conditions.value,
    processing: f.processing.value === 'unknown' ? '' : f.processing.value,
    policySource: `${policy.name} policy · ${SHORT_DATE.format(new Date(policy.checked + 'T00:00:00Z'))}`,
    unknown
  };
}

function catalog(current, history = []) {
  const byId = new Map(current.map(p => [p.id, p]));
  const names = new Map(), prefixes = [];
  for (const p of current) {
    for (const a of p.aliases.names) names.set(normalizeStoreName(a), p.id);
    names.set(normalizeStoreName(p.name), p.id);
    for (const a of p.aliases.prefixes) prefixes.push([normalizeStoreName(a), p.id]);
  }
  prefixes.sort((a, b) => b[0].length - a[0].length);
  return {
    list: () => current,
    get: id => byId.get(id) || null,
    versions: () => [...history, ...current],
    match(name) {
      const n = normalizeStoreName(name);
      if (!n) return null;
      let id = names.get(n), alias = n;
      if (!id) { const hit = prefixes.find(([p]) => n === p || n.startsWith(p + ' ')); if (hit) [alias, id] = hit; }
      return id ? { id, name: byId.get(id).name, alias } : null;
    }
  };
}

const summary = p => {
  const f = itemFields(p);
  return { id: p.id, name: p.name, status: p.status, version: p.version, checked: p.checked, window: f.window, basis: f.basis, outcome: f.outcome, url: f.url, policySource: f.policySource };
};

module.exports = { loadPolicies, validate, unsourcedFacts, normalizeStoreName, itemFields, summary, POLICY_DIR: DIR };

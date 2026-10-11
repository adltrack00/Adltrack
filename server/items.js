/* Item fields ↔ Postgres columns. Fields keep the app's names and values one-to-one; a value that doesn't fit its column's type
   (an empty date, a text price) is kept as-is in `extra`, so nothing the app saved is ever lost. Unknown fields also go to `extra`. */
const FIELDS = [
  ['name', 'name', 'text'],
  ['retailer', 'retailer', 'text'],
  ['price', 'price', 'num'],
  ['category', 'category', 'text'],
  ['channel', 'channel', 'text'],
  ['purchased', 'purchased', 'date'],
  ['delivered', 'delivered', 'date'],
  ['window', 'window_days', 'int'],
  ['basis', 'basis', 'text'],
  ['outcome', 'outcome', 'text'],
  ['requirement', 'requirement', 'text'],
  ['url', 'url', 'text'],
  ['conditions', 'conditions', 'text'],
  ['processing', 'processing', 'text'],
  ['confirmed', 'confirmed', 'bool'],
  ['policySource', 'policy_source', 'text'],
  ['next', 'next', 'text'],
  ['status', 'status', 'text'],
  ['intent', 'intent', 'text'],
  ['received', 'received', 'num'],
  ['returnedOn', 'returned_on', 'date'],
  ['packing', 'packing', 'json'],
  ['taskDone', 'task_done', 'bool'],
  ['snoozeUntil', 'snooze_until', 'date'],
  ['dateSet', 'date_set', 'date'],
  ['demo', 'demo', 'bool'],
  // Room for later sessions; unused by the app today.
  ['retailerId', 'retailer_id', 'text'],
  ['policyChecked', 'policy_checked', 'date'],
  ['conditionAnswers', 'condition_answers', 'json'],
  ['returnMethod', 'return_method', 'text'],
  ['dropoff', 'dropoff', 'json'],
  ['labelFileId', 'label_file_id', 'uuid'],
  ['refundExpectedBy', 'refund_expected_by', 'date']
];
const PG_TYPES = { text: 'text', num: 'numeric', int: 'integer', bool: 'boolean', date: 'date', json: 'jsonb', uuid: 'uuid' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Photos live in file storage; items carry this URL in `photo`.
const FILE_URL = /^\/api\/files\/([0-9a-f-]{36})$/i;

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1000' && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const FITS = {
  text: v => typeof v === 'string',
  num: v => typeof v === 'number' && Number.isFinite(v),
  int: v => Number.isInteger(v) && Math.abs(v) < 2 ** 31,
  bool: v => typeof v === 'boolean',
  date: isDate,
  json: v => v !== null && typeof v === 'object',
  uuid: v => typeof v === 'string' && UUID.test(v)
};

const columnsSql = () => FIELDS.map(([, col, type]) => `${col} ${PG_TYPES[type]}`).join(',\n  ');

/* Item object → { columns: {col: value}, extra }. `id` and `purchaseId` are handled by the caller, and a photo already moved to file storage is removed first. */
function encode(item) {
  const columns = {}, extra = {};
  const known = new Map(FIELDS.map(f => [f[0], f]));
  for (const [key, value] of Object.entries(item)) {
    if (key === 'id' || key === 'purchaseId' || value === undefined) continue;
    const field = known.get(key);
    if (field && FITS[field[2]](value)) columns[field[1]] = value;
    else extra[key] = value;
  }
  for (const [, col] of FIELDS) if (!(col in columns)) columns[col] = null;
  return { columns, extra };
}

/* Database row → item object, the inverse of encode. */
function decode(row) {
  const item = { ...(row.extra || {}), id: row.id, purchaseId: row.purchase_id };
  for (const [key, col, type] of FIELDS) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    item[key] = type === 'num' ? Number(v) : type === 'date' && v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  if (row.photo_file_id) item.photo = fileUrl(row.photo_file_id);
  return item;
}

const JSON_COLUMNS = new Set(FIELDS.filter(f => f[2] === 'json').map(f => f[1]));
const fileUrl = id => `/api/files/${id}`;
const fileIdFromUrl = v => (typeof v === 'string' && FILE_URL.exec(v) || [])[1] || null;

module.exports = { FIELDS, JSON_COLUMNS, columnsSql, encode, decode, fileUrl, fileIdFromUrl, isDate };

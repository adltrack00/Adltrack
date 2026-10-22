const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const core = require('../core.js');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');

/* The + on My Tasks (plus.js): tasks on their days in My Tasks, and tasks and incidents in the daily care report. */
function app(items, day = '2026-10-14') {
  const h = fs.readFileSync('home.js', 'utf8'), r = fs.readFileSync('report.js', 'utf8'), p = fs.readFileSync('plus.js', 'utf8');
  const src = h.slice(h.indexOf('const hmNow='), h.indexOf('function helpNote(')) + r.slice(r.indexOf('const reportTime='), r.indexOf('function reportHTML(')) + p.slice(p.indexOf('const PLUS_PHOTOS='), p.indexOf('/* The + itself'));
  const ctx = { items, C: core, today: () => day, howText: () => '', slotName: () => '', settings: {}, clockText: t => { const [hh, m] = t.split(':').map(Number); return `${hh % 12 || 12}:${String(m).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; } };
  vm.runInNewContext(src.replace(/const (\w+)=/g, 'var $1=') + ';this.todayTasks=todayTasks;this.reportEntries=reportEntries;this.taskOn=taskOn;this.repeatText=repeatText;', ctx);
  return ctx;
}
const plain = x => JSON.parse(JSON.stringify(x));
const at = (d, t) => new Date(`${d}T${t}`).toISOString();
// Wednesday October 14, 2026; next Monday is the 19th.
const task = (extra = {}) => ({ id: 't1', task: true, name: 'Change the dressing', note: 'Left knee', date: '2026-10-19', time: '15:00', repeat: 'once', by: 'George', addedAt: at('2026-10-14', '09:30'), marks: [], ...extra });
const med = { id: 'a', med: true, status: 'deciding', name: 'Lisinopril 10 mg', times: ['08:00', '18:00'], doses: [] };

test('a task for next Monday at 3:00 PM shows in My Tasks that day at its time, and not before', () => {
  const c = app([med, task()]);
  assert.deepEqual(plain(c.todayTasks(undefined, '2026-10-14').map(x => x.title)), ['Lisinopril 10 mg', 'Lisinopril 10 mg']);
  assert.deepEqual(plain(c.todayTasks(undefined, '2026-10-19').map(x => [x.time, x.title, x.key, x.state])), [['08:00', 'Lisinopril 10 mg', 'dose:08:00', ''], ['15:00', 'Change the dressing', 'task', ''], ['18:00', 'Lisinopril 10 mg', 'dose:18:00', '']]);
  assert.deepEqual(c.todayTasks(undefined, '2026-10-26').filter(x => x.key === 'task').length, 0, 'once only');
  assert.equal(c.repeatText(task()), 'Monday, Oct 19 at 3:00 PM');
});

test('a repeating task: every day, chosen days or every week, until its last day', () => {
  const c = app([]);
  const days = (t, from, n) => Array.from({ length: n }, (_, k) => core.shift(from, k)).filter(d => c.taskOn(t, d));
  assert.deepEqual(days(task({ repeat: 'daily', date: '2026-10-14', until: '2026-10-16' }), '2026-10-13', 6), ['2026-10-14', '2026-10-15', '2026-10-16']);
  assert.deepEqual(days(task({ repeat: 'weekly', until: '2027-10-14' }), '2026-10-14', 21), ['2026-10-19', '2026-10-26', '2026-11-02']);
  assert.deepEqual(days(task({ repeat: 'days', date: '2026-10-14', days: [1, 3], until: '2027-10-14' }), '2026-10-14', 8), ['2026-10-14', '2026-10-19', '2026-10-21']);
  assert.equal(c.repeatText(task({ repeat: 'weekly', until: '2027-10-14' })), 'Every Monday at 3:00 PM until Oct 14, 2027');
  assert.equal(c.repeatText(task({ repeat: 'days', days: [3, 1], until: '2027-10-14' })), 'Mon, Wed at 3:00 PM until Oct 14, 2027');
});

test('a task is done with Done or Skip on its day only, and the report shows it with who added it', () => {
  const t = task({ marks: [{ day: '2026-10-19', key: 'task', kind: 'done', at: at('2026-10-19', '15:10'), by: 'Maria', note: 'Healing well.', photos: ['/api/files/k'] }] });
  const c = app([t]);
  assert.equal(c.todayTasks(undefined, '2026-10-19')[0].state, 'done');
  assert.deepEqual(plain(c.reportEntries(undefined, '2026-10-14', [])), [{ title: 'New task: Change the dressing', at: at('2026-10-14', '09:30'), note: 'Left knee', details: ['Monday, Oct 19 at 3:00 PM', 'Added by George'], name: 'Change the dressing', photos: [] }]);
  assert.deepEqual(plain(c.reportEntries(undefined, '2026-10-19', [])), [{ title: 'Change the dressing (3pm task)', at: at('2026-10-19', '15:10'), note: 'Healing well.', details: ['Added by George'], name: 'Change the dressing', photos: ['/api/files/k'] }]);
});

test('an incident shows in the report at the time it happened, numbered in time order with the rest', () => {
  const fall = { id: 'i1', incident: true, kind: 'fall', name: 'Fall', at: at('2026-10-14', '11:20'), note: 'Slipped in the bathroom, no injury.', told: 'Dr. Patel, Ann', photos: ['/api/files/p'], by: 'Maria', addedAt: at('2026-10-14', '11:40') };
  const c = app([{ ...med, doses: [{ at: at('2026-10-14', '08:05'), day: '2026-10-14', slot: '08:00', kind: 'taken' }] }, fall]);
  const e = plain(c.reportEntries(undefined, '2026-10-14', []));
  assert.deepEqual(e.map(x => x.title), ['Lisinopril 10 mg (8am dose)', 'Incident: Fall']);
  assert.deepEqual(e[1], { title: 'Incident: Fall', at: fall.at, note: 'Slipped in the bathroom, no injury.', details: ['Told: Dr. Patel, Ann', 'Reported by Maria'], name: 'Incident: Fall', photos: ['/api/files/p'] });
  assert.equal(c.todayTasks(undefined, '2026-10-14').length, 2, 'an incident is not a task');
});

/* On the server: who may add tasks and report incidents, for the family on screen. */
async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-plus-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const server = http.createServer(createApp({ store, data }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.patient ? { 'X-Patient': call.patient } : {}) };
      const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    return call;
  };
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'password123' })).status, 201); c.id = (await c('GET', '/api/me')).body.team.patient; return c; };
  const join = async (admin, c, name, address, role, perms = {}) => {
    const link = (await admin('POST', '/api/team/members', { name, email: address, role, perms })).body.invite.link;
    assert.equal((await c('POST', '/api/invite/accept', { token: link.split('#t=')[1] })).status, 200);
  };
  return { signUp, join, close: () => new Promise(r => server.close(r)) };
}
const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]).toString('base64');
const incident = (extra = {}) => ({ id: 'inc-1', incident: true, kind: 'fall', name: 'Fall', at: new Date().toISOString(), note: 'Slipped.', by: 'Maria', addedAt: new Date().toISOString(), ...extra });

test('an admin schedules a task for the caregiver; a caregiver adds one only when ticked; a viewer adds nothing', async () => {
  const a = await boot();
  try {
    const george = await a.signUp('George', 'george@example.com'), maria = await a.signUp('Maria', 'maria@example.com'), ann = await a.signUp('Ann', 'ann@example.com');
    await a.join(george, maria, 'Maria', 'maria@example.com', 'caregiver');
    await a.join(george, ann, 'Ann', 'ann@example.com', 'viewer');
    for (const c of [maria, ann]) c.patient = george.id;
    // George (admin) schedules it with a photo; Maria sees it on the shared plan and marks it done.
    const photo = await george('POST', '/api/files/proof', { data: png, for: 'task' });
    assert.equal(photo.status, 201);
    assert.equal((await george('POST', '/api/items', task({ photos: [photo.body.url] }))).status, 201);
    const seen = (await maria('GET', '/api/items')).body.items.find(i => i.id === 't1');
    assert.equal(seen.name, 'Change the dressing');
    const done = { ...seen, marks: [{ day: '2026-10-19', key: 'task', kind: 'done', at: new Date().toISOString(), by: 'Maria' }] };
    assert.equal((await maria('PUT', '/api/items/t1', done)).status, 200);
    // Without "Can add new tasks" Maria can't add or change a task, nor slip a medication in as one.
    let r = await maria('POST', '/api/items', task({ id: 't2' }));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'Ask an admin to let you add tasks.');
    assert.equal((await maria('POST', '/api/files/proof', { data: png, for: 'task' })).status, 403);
    assert.equal((await maria('PUT', '/api/items/t1', { ...done, time: '16:00' })).status, 403);
    // Ticked, she can; a task still can't carry a medication.
    const members = (await george('GET', '/api/team')).body.members;
    await george('PUT', `/api/team/members/${members.find(m => m.name === 'Maria').id}`, { role: 'caregiver', perms: { addTasks: true } });
    assert.equal((await maria('POST', '/api/items', task({ id: 't2', by: 'Maria' }))).status, 201);
    assert.equal((await maria('PUT', '/api/items/t2', task({ id: 't2', by: 'Maria', time: '16:00' }))).status, 200);
    assert.equal((await maria('POST', '/api/items', task({ id: 't3', med: true }))).status, 403);
    assert.equal((await maria('PUT', '/api/items/t2', task({ id: 't2', by: 'Maria', time: '16:00', med: true }))).status, 403);
    // Ann follows along only.
    for (const [method, url, body] of [['POST', '/api/items', task({ id: 't4' })], ['POST', '/api/items', incident()], ['POST', '/api/files/proof', { data: png, for: 'incident' }], ['PUT', '/api/items/t1', { ...done, marks: [] }]]) {
      r = await ann(method, url, body);
      assert.equal(r.status, 403, `${method} ${url}`);
    }
    assert.deepEqual((await george('GET', '/api/items')).body.items.map(i => i.id).sort(), ['t1', 't2']);
  } finally { await a.close(); }
});

test('an incident is reported straight away by a caregiver or an admin, and shows only on that family’s plan', async () => {
  const a = await boot();
  try {
    const grace = await a.signUp('Grace', 'grace@example.com'), ivy = await a.signUp('Ivy', 'ivy@example.com'), maria = await a.signUp('Maria', 'maria@example.com'), lee = await a.signUp('Lee', 'lee@example.com');
    await a.join(grace, maria, 'Maria', 'maria@example.com', 'caregiver');
    await a.join(ivy, maria, 'Maria', 'maria@example.com', 'caregiver');
    // Lee is an admin without My Tasks: still reports incidents and adds tasks.
    await a.join(grace, lee, 'Lee', 'lee@example.com', 'admin');
    lee.patient = grace.id;
    // Maria on Rose's (Grace's) family: an incident with a photo, and it can't come with a mark or a medication.
    maria.patient = grace.id;
    const photo = await maria('POST', '/api/files/proof', { data: png, for: 'incident' });
    assert.equal(photo.status, 201);
    assert.equal((await maria('POST', '/api/items', incident({ photos: [photo.body.url] }))).status, 201);
    assert.equal((await maria('POST', '/api/items', incident({ id: 'inc-2', med: true }))).status, 403);
    assert.equal((await maria('POST', '/api/items', incident({ id: 'inc-3', marks: [{ day: 'x' }] }))).status, 403);
    assert.equal((await lee('POST', '/api/items', incident({ id: 'inc-4', kind: 'refused', name: 'Refused medication', by: 'Lee' }))).status, 201);
    assert.equal((await lee('POST', '/api/files/proof', { data: png, for: 'task' })).status, 201);
    assert.equal((await lee('POST', '/api/items', task({ id: 'lee-task', by: 'Lee' }))).status, 201);
    // On June's (Ivy's) family she adds her own; each family sees only its own.
    maria.patient = ivy.id;
    assert.equal((await maria('POST', '/api/items', incident({ id: 'inc-june', kind: 'other', name: 'Other' }))).status, 201);
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.id), ['inc-june']);
    assert.deepEqual((await ivy('GET', '/api/items')).body.items.map(i => i.id), ['inc-june']);
    maria.patient = grace.id;
    assert.deepEqual((await maria('GET', '/api/items')).body.items.map(i => i.id).sort(), ['inc-1', 'inc-4', 'lee-task']);
    assert.deepEqual((await grace('GET', '/api/items')).body.items.find(i => i.id === 'inc-1').photos, [photo.body.url]);
  } finally { await a.close(); }
});

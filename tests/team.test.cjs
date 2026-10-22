const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { createStorage } = require('../server/storage');
const { createData } = require('../server/data');
const { createEmail } = require('../server/email');
const { createSms, normPhone } = require('../server/sms');
const { permsFor } = require('../server/team');

async function boot({ texts = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adltrack-team-'));
  const store = createStore({ file: path.join(dir, 'store.json') });
  await store.init();
  const data = createData({ store, storage: createStorage({ dir: path.join(dir, 'files') }) });
  const mails = [], sent = [];
  const email = createEmail({ send: async m => { mails.push(m); } });
  const sms = createSms(texts ? { send: async m => { sent.push(m); } } : {});
  const server = http.createServer(createApp({ store, data, email, sms }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  const signUp = async (name, address) => { const c = client(); assert.equal((await c('POST', '/api/signup', { name, email: address, password: 'password123' })).status, 201); return c; };
  const token = link => link.split('#t=')[1];
  return { client, signUp, token, mails, sent, close: () => new Promise(r => server.close(r)) };
}

test('phone numbers are read as typed, with ten digits taken as a US number', () => {
  assert.equal(normPhone('(555) 123-4567'), '+15551234567');
  assert.equal(normPhone('1 555 123 4567'), '+15551234567');
  assert.equal(normPhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normPhone('12345'), null);
  assert.equal(normPhone(''), null);
});

test('each role gets its own permissions, with the admin’s ticks only where the role leaves a choice', () => {
  assert.deepEqual(permsFor('viewer', { tasks: true, meds: true }), { tasks: false, addTasks: false, meds: false });
  assert.deepEqual(permsFor('caregiver', {}), { tasks: true, addTasks: false, meds: false });
  assert.deepEqual(permsFor('caregiver', { addTasks: true, meds: true }), { tasks: true, addTasks: true, meds: true });
  assert.deepEqual(permsFor('admin', {}), { tasks: false, addTasks: true, meds: true });
  assert.deepEqual(permsFor('admin', { tasks: true }), { tasks: true, addTasks: true, meds: true });
});

test('an admin adds a caregiver by email and phone, who joins and shares the same care plan', async () => {
  const app = await boot();
  try {
    const george = await app.signUp('George', 'george@example.com');
    await george('POST', '/api/items', { id: 'med-1', name: 'Lisinopril', med: true });
    const solo = await george('GET', '/api/team');
    assert.equal(solo.body.members.length, 1);
    assert.equal(solo.body.members[0].owner, true);

    const add = await george('POST', '/api/team/members', { name: 'Maria', email: 'Maria@Example.com', phone: '(555) 123-4567', role: 'caregiver', perms: { meds: true } });
    assert.equal(add.status, 201);
    assert.deepEqual(add.body.member.perms, { tasks: true, addTasks: false, meds: true });
    assert.equal(add.body.member.status, 'invited');
    assert.equal(add.body.invite.emailed, true);
    assert.equal(add.body.invite.texted, true);
    assert.equal(app.mails[0].to[0], 'maria@example.com');
    assert.match(app.mails[0].subject, /George added you/);
    assert.equal(app.sent[0].to, '+15551234567');
    assert.ok(app.sent[0].body.includes(add.body.invite.link));

    // The invite link shows who added them, without signing in.
    const t = app.token(add.body.invite.link);
    const info = await app.client()('POST', '/api/invite/info', { token: t });
    assert.deepEqual(info.body, { inviter: 'George', name: 'Maria', email: 'maria@example.com', role: 'caregiver' });

    const maria = await app.signUp('Maria', 'maria.r@example.com');
    const joined = await maria('POST', '/api/invite/accept', { token: t });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.me.role, 'caregiver');

    // Both see the same medications, and a dose Maria marks reaches George.
    const items = await maria('GET', '/api/items');
    assert.deepEqual(items.body.items.map(i => i.name), ['Lisinopril']);
    await maria('PUT', '/api/items/med-1', { name: 'Lisinopril', med: true, doses: [{ kind: 'taken', by: 'Maria' }] });
    assert.equal((await george('GET', '/api/data')).body.data.purchases[0].doses[0].by, 'Maria');
    assert.equal((await george('GET', '/api/data')).body.space, (await maria('GET', '/api/data')).body.space);
    const me = await maria('GET', '/api/me');
    const { patient, patients, ...team } = me.body.team;
    assert.deepEqual(team, { role: 'caregiver', perms: { tasks: true, addTasks: false, meds: true }, owner: false });
    assert.deepEqual(patients.map(p => p.id), [patient]);

    // The link works once.
    assert.equal((await app.client()('POST', '/api/invite/info', { token: t })).status, 400);
    // Only admins see emails and phone numbers, and only admins add people.
    const seen = await maria('GET', '/api/team');
    assert.equal(seen.body.members.length, 2);
    assert.equal(seen.body.members.some(m => 'email' in m || 'phone' in m), false);
    assert.equal((await maria('POST', '/api/team/members', { name: 'Ann', email: 'ann@example.com', role: 'viewer' })).status, 403);
  } finally { await app.close(); }
});

test('admins change what a person may do, resend invites and remove people, but the owner always stays an admin', async () => {
  const app = await boot({ texts: false });
  try {
    const george = await app.signUp('George', 'george@example.com');
    const add = await george('POST', '/api/team/members', { name: 'Sam', email: 'sam@example.com', role: 'viewer' });
    assert.equal(add.body.invite.texted, false);
    assert.equal((await george('POST', '/api/team/members', { name: 'Sam again', email: 'SAM@example.com', role: 'viewer' })).status, 409);
    assert.equal((await george('POST', '/api/team/members', { name: 'Bad', email: 'bad@example.com', phone: '123', role: 'viewer' })).status, 400);
    assert.equal((await george('POST', '/api/team/members', { name: 'Bad', email: 'nope', role: 'viewer' })).status, 400);

    const id = add.body.member.id;
    const promoted = await george('PUT', `/api/team/members/${id}`, { role: 'admin', perms: { tasks: true } });
    assert.deepEqual(promoted.body.member.perms, { tasks: true, addTasks: true, meds: true });

    // A new link replaces the old one.
    const old = app.token(add.body.invite.link);
    const again = await george('POST', `/api/team/members/${id}/invite`, {});
    assert.equal((await app.client()('POST', '/api/invite/info', { token: old })).status, 400);
    const sam = await app.signUp('Sam', 'sam@example.com');
    await sam('POST', '/api/invite/accept', { token: app.token(again.body.invite.link) });

    // A second admin can add people too.
    assert.equal((await sam('POST', '/api/team/members', { name: 'Lee', email: 'lee@example.com', role: 'caregiver' })).status, 201);
    const owner = (await sam('GET', '/api/team')).body.members.find(m => m.owner);
    assert.equal((await sam('PUT', `/api/team/members/${owner.id}`, { role: 'viewer' })).status, 400);
    assert.equal((await sam('DELETE', `/api/team/members/${owner.id}`, {})).status, 400);

    // Removed: back to their own, empty plan.
    assert.equal((await george('DELETE', `/api/team/members/${id}`, {})).status, 200);
    assert.equal((await sam('GET', '/api/me')).body.team.owner, true);
    assert.equal((await sam('GET', '/api/data')).body.data, null);
  } finally { await app.close(); }
});

test('someone on one care team can join another family’s too, and leaves one without the other', async () => {
  const app = await boot();
  try {
    const a = await app.signUp('Ann', 'ann@example.com'), b = await app.signUp('Bo', 'bo@example.com');
    const inviteA = await a('POST', '/api/team/members', { name: 'Cy', email: 'cy@example.com', role: 'viewer' });
    const inviteB = await b('POST', '/api/team/members', { name: 'Cy', email: 'cy@example.com', role: 'viewer' });
    const cy = await app.signUp('Cy', 'cy@example.com');
    assert.equal((await cy('POST', '/api/invite/accept', { token: app.token(inviteA.body.invite.link) })).status, 200);
    assert.equal((await cy('POST', '/api/invite/accept', { token: app.token(inviteB.body.invite.link) })).status, 200);
    assert.equal((await cy('GET', '/api/me')).body.team.patients.length, 2);
    assert.equal((await cy('POST', '/api/team/leave', {})).status, 200);
    assert.equal((await cy('GET', '/api/me')).body.team.patients.length, 1);
    // The owner can't leave their own team.
    assert.equal((await a('POST', '/api/team/leave', {})).status, 400);
  } finally { await app.close(); }
});

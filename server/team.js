/* Care teams: an admin adds family and paid caregivers by email and phone, and chooses what each person may do. Everyone
   who joins shares the owner's care plan: the same medications, daily care report, photos, refills and visits.
   Roles: admin (adds people, changes the plan), caregiver (has My Tasks) and viewer (follows along). Admins tick the extra
   permissions per person: My Tasks for an admin, and adding tasks or scanning and changing medications for a caregiver.
   Patients: a home or small agency cares for 1 to 10 patients, each with their own medications, report, photos and settings.
   Admins are on every patient; each caregiver and family viewer is on the patients an admin chose for them. */
const crypto = require('node:crypto');
const { normPhone } = require('./sms');

class TeamError extends Error { constructor(status, message) { super(message); this.status = status; } }

const ROLES = ['admin', 'caregiver', 'viewer'];
const ROLE_WORDS = { admin: 'an admin', caregiver: 'a caregiver', viewer: 'a family member following along' };
const INVITE_DAYS = 14;
const MAX_PATIENTS = 10;
// Patients added after the first hold their data under an account nobody can sign in to (no password, no real email).
const PATIENT_PASSWORD = 'patient';
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const ALL = { tasks: true, addTasks: true, meds: true };
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const validEmail = e => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const normEmail = e => String(e || '').trim().toLowerCase();

/* What a role allows, with the admin's ticks where the role leaves a choice. */
function permsFor(role, p = {}) {
  if (role === 'admin') return { tasks: !!p.tasks, addTasks: true, meds: true };
  if (role === 'caregiver') return { tasks: true, addTasks: !!p.addTasks, meds: !!p.meds };
  return { tasks: false, addTasks: false, meds: false };
}

function createTeam({ store, data = null, email = null, sms = null }) {
  /* The team's patients, first one first. A team that never added one has a single patient: the owner's own plan. */
  async function patientIds(ownerId) {
    const rows = await store.listPatients(ownerId);
    return rows.length ? rows.map(r => r.id) : [ownerId];
  }
  /* The patients a person is on: every one for admins; for others, the ones an admin chose (the first patient for people
     added before there were several). */
  function allowedFor(m, all) {
    if (!m || m.role === 'admin') return all;
    const list = Array.isArray(m.patients) ? m.patients : [all[0]];
    return all.filter(id => list.includes(id));
  }

  /* Whose care plan this account works on, and what it may do there. Someone on no team works on their own plan.
     patientId is the patient whose data the request reads and changes: the one asked for when this person is on it,
     otherwise their first. */
  async function access(user, wanted = null) {
    const m = await store.membershipOf(user.id);
    const ownerId = m ? m.ownerId : user.id;
    const patients = allowedFor(m, await patientIds(ownerId));
    const patientId = patients.includes(wanted) ? wanted : patients[0] || null;
    if (!m) return { ownerId, memberId: null, role: 'admin', perms: ALL, owner: true, patients, patientId };
    return { ownerId, memberId: m.id, role: m.role, perms: permsFor(m.role, m.perms), owner: m.ownerId === user.id, patients, patientId };
  }
  async function requireAdmin(user) {
    const a = await access(user);
    if (a.role !== 'admin') throw new TeamError(403, 'Only an admin can change who’s on the care team.');
    return a;
  }

  const status = m => m.userId ? 'joined' : 'invited';
  const out = (m, me, admin, all) => ({
    id: m.id, name: m.name, role: m.role, perms: permsFor(m.role, m.perms), status: status(m),
    owner: m.userId === m.ownerId, you: m.userId === me,
    ...(admin ? { email: m.email, phone: m.phone, invitedAt: m.invitedAt, patients: allowedFor(m, all) } : {})
  });

  /* A patient as the app shows them: the name and photo from their own profile. */
  async function patientOut(id, ownerId) {
    const profile = (await store.getRawData(id))?.payload?.profile || {};
    const photo = typeof profile.photo === 'string' && (PHOTO.test(profile.photo) || /^\/api\/files\/[0-9a-f-]{36}$/i.test(profile.photo)) ? profile.photo : '';
    const name = typeof profile.name === 'string' && profile.name.trim() && profile.name.toLowerCase() !== 'you' ? profile.name.trim() : (await store.findUserById(id))?.name || '';
    return { id, name, photo, first: id === ownerId };
  }
  /* The patients this person is on, for the picker and the switch on Home. */
  async function patients(a) {
    const list = [];
    for (const id of a.patients) list.push(await patientOut(id, a.ownerId));
    return list;
  }

  /* The care team as this account sees it. Phone numbers and emails are shown to admins only. Someone who isn't an admin sees
     the admins and the people on their own patients, so a family in a care home never sees another family. */
  async function view(user, wanted = null) {
    const a = await access(user, wanted);
    const all = await patientIds(a.ownerId);
    let members = await store.listMembers(a.ownerId);
    if (!members.length) {
      const owner = await store.findUserById(a.ownerId);
      members = [{ id: 'owner', ownerId: a.ownerId, userId: a.ownerId, name: owner.name, email: owner.email, phone: '', role: 'admin', perms: ALL }];
    }
    const admin = a.role === 'admin';
    if (!admin) members = members.filter(m => m.role === 'admin' || allowedFor(m, all).some(id => a.patients.includes(id)));
    return { me: { role: a.role, perms: a.perms, owner: a.owner }, members: members.map(m => out(m, user.id, admin, all)), patients: await patients(a) };
  }

  /* Who a caregiver or viewer is on, from the patient ids the admin ticked. Admins are on everyone. */
  async function chosenPatients(ownerId, role, value) {
    if (role === 'admin') return null;
    const all = await patientIds(ownerId);
    if (all.length === 1) return all;
    const list = Array.isArray(value) ? all.filter(id => value.includes(id)) : [];
    if (!list.length) throw new TeamError(400, role === 'viewer' ? 'Choose who they’ll follow.' : 'Choose who they’ll care for.');
    return list;
  }

  /* Settings → People → Patients: admins add a patient by name and photo, change them, or remove one. */
  function patientFields(body, { partial = false } = {}) {
    const out = {};
    if (!partial || body.name !== undefined) {
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) throw new TeamError(400, 'Enter their name.');
      out.name = name;
    }
    if (body.photo === null) out.photo = null;
    else if (body.photo !== undefined) {
      if (typeof body.photo !== 'string' || body.photo.length > 2_000_000 || !PHOTO.test(body.photo)) throw new TeamError(400, 'Use a JPG, PNG or WebP photo.');
      out.photo = body.photo;
    }
    return out;
  }
  async function saveProfile(id, fields) {
    const raw = await store.getRawData(id);
    const profile = { ...(raw?.payload?.profile || {}) };
    if (fields.name) profile.name = fields.name;
    if (fields.photo === null) delete profile.photo; else if (fields.photo) profile.photo = fields.photo;
    await data.putSettings(id, { settings: raw?.payload?.settings || {}, profile });
  }
  async function addPatient(user, body) {
    const a = await requireAdmin(user);
    const fields = patientFields(body || {});
    const all = await patientIds(a.ownerId);
    if (all.length >= MAX_PATIENTS) throw new TeamError(400, `A care team can have up to ${MAX_PATIENTS} patients.`);
    const holder = await store.createUser({ email: `patient-${crypto.randomUUID()}@patients.adltrack.invalid`, name: fields.name, passwordHash: PATIENT_PASSWORD });
    // The plan the team already had becomes the first patient.
    if (all.length === 1 && all[0] === a.ownerId) await store.addPatient(a.ownerId, a.ownerId, 0);
    await store.addPatient(a.ownerId, holder.id, all.length);
    await saveProfile(holder.id, fields);
    return { patient: await patientOut(holder.id, a.ownerId) };
  }
  async function updatePatient(user, id, body) {
    const a = await requireAdmin(user);
    if (!(await patientIds(a.ownerId)).includes(id)) throw new TeamError(404, 'That patient isn’t on this care team.');
    await saveProfile(id, patientFields(body || {}, { partial: true }));
    return { patient: await patientOut(id, a.ownerId) };
  }
  async function removePatient(user, id) {
    const a = await requireAdmin(user);
    if (!(await patientIds(a.ownerId)).includes(id)) throw new TeamError(404, 'That patient isn’t on this care team.');
    if (id === a.ownerId) throw new TeamError(400, 'The first patient stays with the care team.');
    const all = await patientIds(a.ownerId), members = await store.listMembers(a.ownerId);
    const name = (await patientOut(id, a.ownerId)).name;
    // Nobody is left on no patient: they're given someone else first, or removed.
    const stranded = members.find(m => m.role !== 'admin' && allowedFor(m, all).every(p => p === id));
    if (stranded) throw new TeamError(409, `${stranded.name} is only on ${name}. Choose someone else for them in People first, or remove them.`);
    for (const m of members) if (Array.isArray(m.patients) && m.patients.includes(id)) await store.updateMember(a.ownerId, m.id, { patients: m.patients.filter(p => p !== id) });
    await data.deleteAccount(id);
    return { ok: true };
  }
  /* The patients that go when the account that set up the team is deleted (the first patient is the account itself). */
  async function forget(ownerId) {
    for (const id of await patientIds(ownerId)) if (id !== ownerId) await data.deleteAccount(id);
  }

  /* The owner gets their own row when the first person is added, so they show on the list and can tick My Tasks. */
  async function ensureOwner(ownerId) {
    if (await store.membershipOf(ownerId)) return;
    const owner = await store.findUserById(ownerId);
    try { await store.addMember({ ownerId, userId: ownerId, name: owner.name, email: owner.email, role: 'admin', perms: ALL }); }
    catch (err) { if (err.code !== 'EXISTS') throw err; }
  }

  function clean(body, { partial = false } = {}) {
    const out = {};
    if (!partial || body.name !== undefined) {
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 60) throw new TeamError(400, 'Enter their name.');
      out.name = name;
    }
    if (!partial || body.phone !== undefined) {
      const raw = String(body.phone || '').trim();
      const phone = raw ? normPhone(raw) : '';
      if (phone === null) throw new TeamError(400, 'Enter a mobile number with its area code, like (555) 123-4567.');
      out.phone = phone;
    }
    if (!partial || body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw new TeamError(400, 'Choose what they’ll do.');
      out.role = body.role;
    }
    if (out.role || body.perms !== undefined) out.perms = permsFor(out.role || body.role, body.perms && typeof body.perms === 'object' ? body.perms : {});
    return out;
  }

  /* Sends the invite by email and by text when each is set up. The link is always returned so the admin can share it. */
  async function deliver(member, token, inviterId, base) {
    const inviter = (await store.findUserById(inviterId))?.name || 'Your family';
    const link = `${base}/join.html#t=${token}`;
    const role = ROLE_WORDS[member.role];
    let emailed = false, texted = false;
    if (email && email.available()) {
      try { await email.sendInvite(member.email, { inviter, name: member.name, role, link }); emailed = true; }
      catch (err) { console.error('Invite email failed:', err.message); }
    }
    if (sms && sms.available() && member.phone) {
      try { await sms.sendInvite(member.phone, { inviter, role, link }); texted = true; }
      catch (err) { console.error('Invite text failed:', err.message); }
    }
    return { link, emailed, texted };
  }
  const newToken = () => { const token = crypto.randomBytes(32).toString('base64url'); return { token, hash: sha256(token) }; };

  async function add(user, body, base) {
    const a = await requireAdmin(user);
    const fields = clean(body || {});
    const address = normEmail(body.email);
    if (!validEmail(address)) throw new TeamError(400, 'Enter a valid email address.');
    const patients = await chosenPatients(a.ownerId, fields.role, body.patients);
    await ensureOwner(a.ownerId);
    const { token, hash } = newToken();
    let member;
    try { member = await store.addMember({ ownerId: a.ownerId, ...fields, patients, email: address, inviteHash: hash, invitedBy: user.id }); }
    catch (err) { if (err.code === 'EXISTS') throw new TeamError(409, 'Someone with this email is already on the care team.'); throw err; }
    return { member: out(member, user.id, true, await patientIds(a.ownerId)), invite: await deliver(member, token, user.id, base) };
  }

  async function update(user, id, body) {
    const a = await requireAdmin(user);
    const member = await store.getMember(a.ownerId, id);
    if (!member) throw new TeamError(404, 'That person isn’t on the care team.');
    const fields = clean({ role: member.role, ...body }, { partial: true });
    // The account the plan belongs to always stays an admin.
    if (member.userId === a.ownerId && fields.role && fields.role !== 'admin') throw new TeamError(400, 'The person who set up this care team stays an admin.');
    const role = fields.role || member.role;
    if (role !== 'admin' && (body.patients !== undefined || member.patients === null)) fields.patients = await chosenPatients(a.ownerId, role, body.patients ?? [(await patientIds(a.ownerId))[0]]);
    return { member: out(await store.updateMember(a.ownerId, id, fields), user.id, true, await patientIds(a.ownerId)) };
  }

  async function remove(user, id) {
    const a = await requireAdmin(user);
    const member = await store.getMember(a.ownerId, id);
    if (!member) throw new TeamError(404, 'That person isn’t on the care team.');
    if (member.userId === a.ownerId) throw new TeamError(400, 'The person who set up this care team can’t be removed.');
    await store.deleteMember(a.ownerId, id);
    return { ok: true };
  }

  async function resend(user, id, base) {
    const a = await requireAdmin(user);
    const { token, hash } = newToken();
    const member = await store.setMemberInvite(a.ownerId, id, hash);
    if (!member) throw new TeamError(404, 'That person has already joined.');
    return { invite: await deliver(member, token, user.id, base) };
  }

  async function leave(user) {
    const m = await store.membershipOf(user.id);
    if (!m) throw new TeamError(400, 'You aren’t on anyone else’s care team.');
    if (m.ownerId === user.id) throw new TeamError(400, 'You set up this care team, so you can’t leave it.');
    await store.deleteMember(m.ownerId, m.id);
    return { ok: true };
  }

  async function findInvite(token) {
    const m = typeof token === 'string' && token.length >= 20 && token.length <= 100 ? await store.findInvite(sha256(token)) : null;
    if (!m || Date.now() - new Date(m.invitedAt).getTime() > INVITE_DAYS * 864e5) throw new TeamError(400, 'This invite has expired or was already used. Ask whoever added you to send a new one.');
    return m;
  }
  /* What the invite link shows before signing in: who added you and as what. */
  async function inviteInfo(token) {
    const m = await findInvite(token);
    const owner = await store.findUserById(m.ownerId);
    return { inviter: owner ? owner.name : '', name: m.name, email: m.email, role: m.role };
  }
  async function accept(user, token) {
    const m = await findInvite(token);
    const current = await store.membershipOf(user.id);
    if (current && current.ownerId !== m.ownerId) throw new TeamError(409, 'You’re already on another care team. Leave it in Settings → People first.');
    if (m.ownerId === user.id) throw new TeamError(400, 'This is your own care team.');
    if (!current) {
      try { await store.joinMember(m.id, user.id); }
      catch (err) { if (err.code === 'EXISTS') throw new TeamError(409, 'You’re already on another care team. Leave it in Settings → People first.'); throw err; }
    }
    return view(user);
  }

  return { access, view, patients, add, update, remove, resend, leave, inviteInfo, accept, addPatient, updatePatient, removePatient, forget };
}

module.exports = { createTeam, permsFor, TeamError, ROLES, MAX_PATIENTS };

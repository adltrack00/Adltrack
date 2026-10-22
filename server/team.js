/* Care teams: an admin adds family and paid caregivers by email and phone, and chooses what each person may do. Everyone
   who joins shares the owner's care plan: the same medications, daily care report, photos, refills and visits.
   Roles: admin (adds people, changes the plan), caregiver (has My Tasks) and viewer (follows along). Admins tick the extra
   permissions per person: My Tasks for an admin, and adding tasks or scanning and changing medications for a caregiver.
   One account can be on several families' care teams: a caregiver who goes to different homes is signed up by each family's
   admin, with that family's own role and ticks, and switches between them. Each team is one patient's care plan. */
const crypto = require('node:crypto');
const { normPhone } = require('./sms');

class TeamError extends Error { constructor(status, message) { super(message); this.status = status; } }

const ROLES = ['admin', 'caregiver', 'viewer'];
const ROLE_WORDS = { admin: 'an admin', caregiver: 'a caregiver', viewer: 'a family member following along' };
const INVITE_DAYS = 14;
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

function createTeam({ store, email = null, sms = null }) {
  /* Whose care plan this account works on, and what it may do there. Someone on no team works on their own plan. Someone on
     several teams works on the one the app asked for (wanted, the plan's owner id), or their first; patients lists them all. */
  async function access(user, wanted = null) {
    const list = await store.membershipsOf(user.id);
    const m = list.find(x => x.ownerId === wanted) || list[0];
    const patients = list.length ? list.map(x => x.ownerId) : [user.id];
    if (!m) return { ownerId: user.id, memberId: null, role: 'admin', perms: ALL, owner: true, patients };
    // changedBy: the admin who last changed this person's access, for the note their app shows.
    return { ownerId: m.ownerId, memberId: m.id, role: m.role, perms: permsFor(m.role, m.perms), owner: m.ownerId === user.id, ...(m.perms?.changedBy ? { changedBy: m.perms.changedBy } : {}), patients };
  }
  async function requireAdmin(user, wanted) {
    const a = await access(user, wanted);
    if (a.role !== 'admin') throw new TeamError(403, 'Only an admin can change who’s on the care team.');
    return a;
  }

  const status = m => m.userId ? 'joined' : 'invited';
  const out = (m, me, admin) => ({
    id: m.id, name: m.name, role: m.role, perms: permsFor(m.role, m.perms), status: status(m),
    owner: m.userId === m.ownerId, you: m.userId === me,
    ...(admin ? { email: m.email, phone: m.phone, invitedAt: m.invitedAt } : {})
  });

  /* Each care plan this person is on, as the picker and the switch on Home show it: the patient's name and photo from the
     plan's profile, and the family that signed them up. */
  async function patients(a) {
    const list = [];
    for (const id of a.patients) {
      const profile = (await store.getRawData(id))?.payload?.profile || {}, owner = await store.findUserById(id);
      const photo = typeof profile.photo === 'string' && /^(data:image\/jpeg;base64,[a-z0-9+/=]+|\/api\/files\/[0-9a-f-]{36})$/i.test(profile.photo) ? profile.photo : '';
      const name = typeof profile.name === 'string' && profile.name.trim() && profile.name.toLowerCase() !== 'you' ? profile.name.trim().slice(0, 40) : owner?.name || '';
      list.push({ id, name, photo, by: owner?.name || '' });
    }
    return list;
  }

  /* The care team as this account sees it. Phone numbers and emails are shown to admins only. */
  async function view(user, wanted = null) {
    const a = await access(user, wanted);
    let members = await store.listMembers(a.ownerId);
    if (!members.length) {
      const owner = await store.findUserById(a.ownerId);
      members = [{ id: 'owner', ownerId: a.ownerId, userId: a.ownerId, name: owner.name, email: owner.email, phone: '', role: 'admin', perms: ALL }];
    }
    const admin = a.role === 'admin';
    return { me: { role: a.role, perms: a.perms, owner: a.owner }, members: members.map(m => out(m, user.id, admin)) };
  }

  /* The owner gets their own row when the first person is added, so they show on the list and can tick My Tasks. */
  async function ensureOwner(ownerId) {
    if ((await store.membershipsOf(ownerId)).some(m => m.ownerId === ownerId)) return;
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

  async function add(user, body, base, wanted = null) {
    const a = await requireAdmin(user, wanted);
    const fields = clean(body || {});
    const address = normEmail(body.email);
    if (!validEmail(address)) throw new TeamError(400, 'Enter a valid email address.');
    await ensureOwner(a.ownerId);
    const { token, hash } = newToken();
    let member;
    try { member = await store.addMember({ ownerId: a.ownerId, ...fields, email: address, inviteHash: hash, invitedBy: user.id }); }
    catch (err) { if (err.code === 'EXISTS') throw new TeamError(409, 'Someone with this email is already on the care team.'); throw err; }
    return { member: out(member, user.id, true), invite: await deliver(member, token, user.id, base) };
  }

  async function update(user, id, body, wanted = null) {
    const a = await requireAdmin(user, wanted);
    const member = await store.getMember(a.ownerId, id);
    if (!member) throw new TeamError(404, 'That person isn’t on the care team.');
    const fields = clean({ role: member.role, ...body }, { partial: true });
    if (fields.perms) fields.perms.changedBy = user.name;
    // The account the plan belongs to always stays an admin.
    if (member.userId === a.ownerId && fields.role && fields.role !== 'admin') throw new TeamError(400, 'The person who set up this care team stays an admin.');
    return { member: out(await store.updateMember(a.ownerId, id, fields), user.id, true) };
  }

  async function remove(user, id, wanted = null) {
    const a = await requireAdmin(user, wanted);
    const member = await store.getMember(a.ownerId, id);
    if (!member) throw new TeamError(404, 'That person isn’t on the care team.');
    if (member.userId === a.ownerId) throw new TeamError(400, 'The person who set up this care team can’t be removed.');
    await store.deleteMember(a.ownerId, id);
    return { ok: true };
  }

  async function resend(user, id, base, wanted = null) {
    const a = await requireAdmin(user, wanted);
    const { token, hash } = newToken();
    const member = await store.setMemberInvite(a.ownerId, id, hash);
    if (!member) throw new TeamError(404, 'That person has already joined.');
    return { invite: await deliver(member, token, user.id, base) };
  }

  async function leave(user, wanted = null) {
    const list = await store.membershipsOf(user.id), m = list.find(x => x.ownerId === wanted) || list[0];
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
    if (m.ownerId === user.id) throw new TeamError(400, 'This is your own care team.');
    // Already on this family's team (another invite to the same person): nothing to join.
    if (!(await store.membershipsOf(user.id)).some(x => x.ownerId === m.ownerId)) {
      try { await store.joinMember(m.id, user.id); }
      catch (err) { if (err.code !== 'EXISTS') throw err; }
    }
    return { ...(await view(user, m.ownerId)), patient: m.ownerId };
  }

  return { access, patients, view, add, update, remove, resend, leave, inviteInfo, accept };
}

module.exports = { createTeam, permsFor, TeamError, ROLES };

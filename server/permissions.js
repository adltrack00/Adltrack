/* Who may change what on a care plan, checked on the server for every write (hiding buttons in the app is never enough).
   Family viewers change nothing. Marking doses and today's tasks needs My Tasks. Adding or changing medications, scanning
   papers and the plan's settings need the medications tick, which admins always have. The care steps around a medication
   (refill steps, picked up, finished, a visit's checklist) can be marked by anyone who does the care or manages the plan.
   An item or the settings arrive whole from the app, so the check compares them with what's saved and looks at what changed. */
class PermissionError extends Error { constructor(message) { super(message); this.status = 403; } }

const SAY = {
  viewer: 'You can’t change this.',
  tasks: 'Only people with My Tasks can mark doses and tasks. Ask an admin to add it.',
  meds: 'Ask an admin to let you scan papers and change medications.',
  addTasks: 'Ask an admin to let you add tasks.',
  admin: 'Only an admin can do this.'
};
// Marked from My Tasks.
const TASK_FIELDS = new Set(['doses', 'marks']);
// The care steps around a medication or a visit: refill steps, picked up, finished, the visit's checklist, and the log of them.
const CARE_FIELDS = new Set(['refill', 'refilledOn', 'refills', 'pickup', 'discardAfter', 'log', 'steps', 'status', 'returnedOn', 'finishedAt', 'finishedBy', 'snoozeUntil']);
// Finished (or a visit went) and back: anything else, such as confirming a medication, changes the plan.
const CARE_STATUS = new Set(['deciding', 'received']);
// Saved apart from the item (the QR code or label has its own route), or the item's own id.
const IGNORED = new Set(['id', 'label', 'labelFileId']);
// What makes an item a medication, a visit, a task or an incident: changing it changes the plan.
const KIND_FIELDS = new Set(['med', 'appt', 'task', 'incident']);
// Vital signs are recorded with the plan's settings; everything else in the settings belongs to the plan.
const VITAL_KEYS = new Set(['vitals', 'vitalsLog']);
// Turned on by anyone who allows notifications on their phone, viewers too, so alerts reach everyone.
const ANYONE_KEYS = new Set(['notifications']);

/* JSON with object keys sorted, so a value saved and read back (where the database may reorder keys) compares equal. */
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const blank = v => v === undefined || v === null;
const same = (a, b) => blank(a) && blank(b) || stable(a) === stable(b);
const changed = (before = {}, after = {}, skip = new Set()) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => !skip.has(k) && !same(before[k], after[k]));

function createPermissions(access) {
  const { role, perms } = access;
  const viewer = role === 'viewer';
  const can = { tasks: !viewer && !!perms.tasks, addTasks: !viewer && !!perms.addTasks, meds: !viewer && !!perms.meds, admin: role === 'admin' };
  can.care = can.tasks || can.meds;
  function need(what) {
    if (viewer) throw new PermissionError(SAY.viewer);
    if (!can[what]) throw new PermissionError(SAY[what === 'care' ? 'tasks' : what]);
  }

  /* An item saved whole: a new or removed item changes the plan; otherwise each changed field needs its own permission.
     From the + on My Tasks: a new task needs "Can add new tasks" (admins always have it), and anyone who does the care or
     manages the plan reports an incident. Neither can carry a medication or a visit with it. */
  function item(before, after) {
    if (viewer) throw new PermissionError(SAY.viewer);
    const plain = !after.med && !after.appt && !after.doses;
    if (!before && after.task && !after.incident && plain) return need('addTasks');
    if (!before && after.incident && !after.task && plain && !after.marks) return need('care');
    if (!before) return need('meds');
    const skip = new Set(IGNORED);
    // An app that leaves the purchase out keeps the saved one.
    if (after.purchaseId === undefined) skip.add('purchaseId');
    const fields = changed(before, after, skip);
    // Moving a dose time moves today's marked dose with it, as part of changing the medication.
    const retimed = fields.includes('times') && can.meds;
    for (const f of fields) {
      if (KIND_FIELDS.has(f)) need('meds');
      else if (TASK_FIELDS.has(f)) { if (!retimed) need('tasks'); }
      else if (f === 'status' && !(CARE_STATUS.has(before.status) && CARE_STATUS.has(after.status))) need('meds');
      else if (CARE_FIELDS.has(f)) need('care');
      // A task's own details (what, when, how often) change with "Can add new tasks".
      else if (before.task && after.task) need('addTasks');
      else need('meds');
    }
  }

  /* The plan's settings and the Home profile, saved together. */
  function settings(before, after) {
    const keys = changed(before.settings || {}, after.settings || {}).filter(k => !ANYONE_KEYS.has(k));
    if (!keys.length && !changed(before.profile || {}, after.profile || {}).length) return;
    if (viewer) throw new PermissionError(SAY.viewer);
    if (keys.some(k => VITAL_KEYS.has(k))) need('tasks');
    if (keys.some(k => !VITAL_KEYS.has(k)) || changed(before.profile || {}, after.profile || {}).length) need('meds');
  }

  return { can, need, item, settings };
}

module.exports = { createPermissions, PermissionError, SAY };

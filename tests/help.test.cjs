const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

/* Help (help.js): the floating chat button and the section's help pop-up. Only the page logic, with a tiny stand-in DOM. */
function load(view = 'overview', extra = {}) {
  const made = [];
  const el = () => ({ style: {}, hidden: false, className: '', innerHTML: '', setAttribute(k, v) { this[k] = v; }, focus() {}, remove() { this.gone = true; }, querySelector: () => el(), getBoundingClientRect: () => ({ height: 70 }) });
  const document = { body: { appendChild(n) { made.push(n); }, classList: { add() {}, remove() {} } }, createElement: () => el(), getElementById: id => id === 'help-fab' ? made.find(n => n.id === 'help-fab') : id === 'tasks-sheet' ? el() : null,
    querySelector: s => s === '.help-pop' ? made.find(n => n.className === 'help-pop' && !n.gone) || null : null, querySelectorAll: () => [], addEventListener() {} };
  const ctx = { view, tasksOpen: false, reportTab: 'today', selected: null, find: () => null, document, innerWidth: 390, innerHeight: 844, getComputedStyle: () => ({}),
    window: { addEventListener() {} }, requestAnimationFrame: f => f(), MutationObserver: class { observe() {} }, setTimeout, clearTimeout, ...extra };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('help.js', 'utf8'), ctx);
  return { ctx, made };
}

test('every section that maps to help has its own help, with a title, a line on what it is and its steps', () => {
  const { ctx } = load();
  const topics = vm.runInContext('helpTopics', ctx), views = vm.runInContext('helpViews', ctx);
  for (const k of new Set(Object.values(views))) assert.ok(topics[k], k);
  for (const k of ['home', 'tasks', 'take', 'plus', 'scan', 'medications', 'appointments', 'planned', 'documents', 'calendar', 'settings', 'photos', 'info'])
    assert.ok(topics[k].title && topics[k].intro && topics[k].steps.length >= 2, k);
});

test('Home picks its help from what is open: the report, My Tasks or Photos', () => {
  const { ctx } = load();
  assert.equal(vm.runInContext('helpKey()', ctx), 'home');
  ctx.reportTab = 'photos'; assert.equal(vm.runInContext('helpKey()', ctx), 'photos');
  ctx.tasksOpen = true; assert.equal(vm.runInContext('helpKey()', ctx), 'tasks');
});

test('the button sits above the small My Tasks sheet on Home, and hides on pages without help', () => {
  const { ctx, made } = load();
  const fab = made.find(n => n.id === 'help-fab');
  assert.equal(fab.style.bottom, '84px');
  assert.equal(fab.hidden, false);
  ctx.view = 'terms'; vm.runInContext('placeHelp()', ctx);
  assert.equal(fab.hidden, true);
  ctx.view = 'scan'; vm.runInContext('placeHelp()', ctx);
  assert.equal(fab.hidden, false); assert.equal(fab.style.bottom, '');
});

test('the pop-up shows the section help with its × and Got it, and closes', () => {
  const { ctx, made } = load('documents');
  vm.runInContext('openHelp()', ctx);
  const pop = made.find(n => n.className === 'help-pop');
  assert.match(pop.innerHTML, /Documents/);
  assert.match(pop.innerHTML, /help-pop-x/);
  assert.match(pop.innerHTML, /Got it/);
  vm.runInContext('closeHelp()', ctx);
  assert.equal(pop.gone, true);
});

test('the app loads help and the offline copy keeps it', () => {
  const app = fs.readFileSync('app.html', 'utf8'), sw = fs.readFileSync('sw.js', 'utf8');
  assert.match(app, /help\.css/); assert.match(app, /<script src="help\.js"><\/script><script src="assistant\.js"><\/script><\/body>/);
  assert.match(sw, /'help\.js'/); assert.match(sw, /'help\.css'/);
});

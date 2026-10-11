/* Returnly server: account API + app files. Uses Postgres when DATABASE_URL is set, otherwise a local JSON file. */
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./server/store');
const { createApp } = require('./server/app');
const { loadPolicies } = require('./server/policies');

const production = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL || '';
if (production && !databaseUrl) {
  console.error('DATABASE_URL is required in production.');
  process.exit(1);
}
const store = createStore({ databaseUrl, file: path.join(__dirname, 'data', 'dev-store.json') });
const port = Number(process.env.PORT || 4174);
// Render routes traffic to 0.0.0.0; locally we stay on localhost only.
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');

store.init().then(async () => {
  // Invalid policy files stop the server rather than serve unchecked facts.
  const policies = loadPolicies();
  await store.syncPolicies(policies.versions());
  http.createServer(createApp({ store, production, policies })).listen(port, host, () =>
    console.log(`Returnly running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (${databaseUrl ? 'Postgres' : 'local file store'})`));
}).catch(err => { console.error('Could not start:', err.message); process.exit(1); });

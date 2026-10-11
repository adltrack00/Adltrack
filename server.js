/* Returnly server: account API + app files. Uses Postgres when DATABASE_URL is set, otherwise a local JSON file.
   Files (photos, receipts) go to an S3-compatible bucket when S3_* is set, otherwise to data/files. */
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./server/store');
const { createStorage, s3Config } = require('./server/storage');
const { createData } = require('./server/data');
const { createJobs, defineJobs } = require('./server/jobs');
const { createApp } = require('./server/app');
const { loadPolicies } = require('./server/policies');

const production = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.DATABASE_URL || '';
const s3 = s3Config(process.env);
if (production && !databaseUrl) {
  console.error('DATABASE_URL is required in production.');
  process.exit(1);
}
if (production && !s3) {
  console.error('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required in production.');
  process.exit(1);
}
const store = createStore({ databaseUrl, file: path.join(__dirname, 'data', 'dev-store.json') });
const storage = createStorage({ s3, dir: path.join(__dirname, 'data', 'files') });
const jobs = createJobs({ store });
const data = createData({ store, storage, jobs });
defineJobs(jobs, { store, storage });
const port = Number(process.env.PORT || 4174);
// Render routes traffic to 0.0.0.0; locally we stay on localhost only.
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');

store.init().then(async () => {
  // Invalid policy files stop the server rather than serve unchecked facts.
  const policies = loadPolicies();
  await store.syncPolicies(policies.versions());
  // Accounts still saved as one document (with photos inside) move into the purchases and items tables.
  const migrated = await data.migrateAll();
  if (migrated) console.log(`Moved ${migrated} account${migrated === 1 ? '' : 's'} to the items tables.`);
  await jobs.start();
  const server = http.createServer(createApp({ store, data, production, policies })).listen(port, host, () =>
    console.log(`Returnly running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (${databaseUrl ? 'Postgres' : 'local file store'}, ${storage.kind === 's3' ? 'S3 file storage' : 'local file storage'})`));
  const shutdown = () => { server.close(); jobs.stop().finally(() => store.close().finally(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch(err => { console.error('Could not start:', err.message); process.exit(1); });

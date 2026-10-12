/* Returnly server: account API + app files. Uses Postgres when DATABASE_URL is set, otherwise a local JSON file.
   Files (photos, receipts) go to an S3-compatible bucket when S3_* is set, otherwise to data/files. */
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./server/store');
const { createStorage, s3Config } = require('./server/storage');
const { createData } = require('./server/data');
const { createJobs, defineJobs, defineReviewJobs } = require('./server/jobs');
const { createApp } = require('./server/app');
const { loadPolicies } = require('./server/policies');
const { createClassifier } = require('./server/classify');
const { createReceiptReader } = require('./server/receipts');
const { createPlaces } = require('./server/places');
const { createPush, createReminders, vapidConfig } = require('./server/reminders');
const { createPolicyFinder } = require('./server/lookup');
const { createReview } = require('./server/review');
const { createEmail, emailConfig } = require('./server/email');

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
// Web Push needs VAPID keys; without them reminders still arrive while the app is open.
const push = createPush({ vapid: vapidConfig(process.env) });
// Reminder emails and password reset links need Postmark (POSTMARK_SERVER_TOKEN, EMAIL_FROM, APP_URL).
const email = createEmail({ config: emailConfig(process.env), secret: process.env.EMAIL_TOKEN_SECRET || '' });
if (email.available() && !process.env.EMAIL_TOKEN_SECRET) console.warn('EMAIL_TOKEN_SECRET isn’t set: links in emails stop working when the server restarts.');
const reminders = createReminders({ store, push, email, data });
// The every-minute reminder dispatch only runs when push or email is set up.
defineJobs(jobs, { store, storage, data, reminders: push.available() || email.available() ? reminders : null });
const port = Number(process.env.PORT || 4174);
// Render routes traffic to 0.0.0.0; locally we stay on localhost only.
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');

store.init().then(async () => {
  // Invalid policy files stop the server rather than serve unchecked facts.
  const policies = loadPolicies();
  await store.syncPolicies(policies.versions());
  // Unverified stores are looked up on the web; admins (ADMIN_EMAILS) review them, reports and flagged changes in Settings.
  const review = createReview({ store, data, policies, finder: createPolicyFinder(), jobs, admins: (process.env.ADMIN_EMAILS || '').split(',') });
  const approved = await review.loadApproved();
  if (approved) console.log(`Loaded ${approved} admin-approved polic${approved === 1 ? 'y' : 'ies'}.`);
  defineReviewJobs(jobs, review);
  // Accounts still saved as one document (with photos inside) move into the purchases and items tables.
  const migrated = await data.migrateAll();
  if (migrated) console.log(`Moved ${migrated} account${migrated === 1 ? '' : 's'} to the items tables.`);
  await jobs.start();
  const server = http.createServer(createApp({ store, data, production, policies, classifier: createClassifier(), receipts: createReceiptReader(), places: createPlaces({ store }), review, push, reminders, email, supportEmail: process.env.SUPPORT_EMAIL || '' })).listen(port, host, () =>
    console.log(`Returnly running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (${databaseUrl ? 'Postgres' : 'local file store'}, ${storage.kind === 's3' ? 'S3 file storage' : 'local file storage'})`));
  const shutdown = () => { server.close(); jobs.stop().finally(() => store.close().finally(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch(err => { console.error('Could not start:', err.message); process.exit(1); });

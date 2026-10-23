/* Adltrack server: account API + app files. Uses Postgres when DATABASE_URL is set, otherwise a local JSON file.
   Files (photos, receipts) go to an S3-compatible bucket when S3_* is set, otherwise to data/files. */
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./server/store');
const { createStorage, s3Config } = require('./server/storage');
const { createData } = require('./server/data');
const crypto = require('node:crypto');
const { createJobs, defineJobs, defineReviewJobs, defineInboxJobs } = require('./server/jobs');
const { createApp } = require('./server/app');
const { loadPolicies } = require('./server/policies');
const { createClassifier } = require('./server/classify');
const { createReceiptReader } = require('./server/receipts');
const { createDischargeReader } = require('./server/discharge');
const { createLabelReader } = require('./server/label');
const { createPlaces } = require('./server/places');
const { createPush, createReminders, vapidConfig } = require('./server/reminders');
const { createPolicyFinder } = require('./server/lookup');
const { createReview } = require('./server/review');
const { createEmailReader } = require('./server/mail');
const { createInbox } = require('./server/inbox');
const { oauthConfig, createOAuth, tokenKey } = require('./server/oauth');
const { createEmail, emailConfig } = require('./server/email');
const { createSms, smsConfig } = require('./server/sms');
const { createBilling, createStripe, stripeConfig, planConfig } = require('./server/billing');
const { createHealth } = require('./server/health');

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
// Purchases from email and Google / Apple sign-in. Inbox tokens and forwarded mail in the job queue are encrypted with
// INBOX_TOKEN_KEY; in development a throwaway key is made when it isn't set (connected inboxes then need reconnecting after a restart).
const oauthSettings = oauthConfig(process.env);
const inboxWanted = !!(oauthSettings.google || oauthSettings.microsoft || process.env.INBOUND_EMAIL_DOMAIN);
if (production && inboxWanted && !process.env.INBOX_TOKEN_KEY) {
  console.error('INBOX_TOKEN_KEY is required in production when Google, Microsoft or inbound email is set up (openssl rand -base64 32).');
  process.exit(1);
}
const inboxKey = tokenKey(process.env.INBOX_TOKEN_KEY) || crypto.randomBytes(32);
const store = createStore({ databaseUrl, file: path.join(__dirname, 'data', 'dev-store.json') });
const storage = createStorage({ s3, dir: path.join(__dirname, 'data', 'files') });
const jobs = createJobs({ store });
const data = createData({ store, storage, jobs });
// Web Push needs VAPID keys; without them reminders still arrive while the app is open.
const push = createPush({ vapid: vapidConfig(process.env) });
// Reminder emails and password reset links need Resend (RESEND_API_KEY, EMAIL_FROM, APP_URL).
const email = createEmail({ config: emailConfig(process.env), secret: process.env.EMAIL_TOKEN_SECRET || '' });
if (email.available() && !process.env.EMAIL_TOKEN_SECRET) console.warn('EMAIL_TOKEN_SECRET isn’t set: links in emails stop working when the server restarts.');
// Care team invites by text need Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM); without it they go by email.
const sms = createSms({ config: smsConfig(process.env) });
// Each family's plan is paid by card through Stripe (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET); without it trials still run.
const billing = createBilling({ store, stripe: createStripe({ config: stripeConfig(process.env) }), plan: planConfig(process.env) });
const reminders = createReminders({ store, push, email, sms, data });
// The every-minute reminder dispatch only runs when push, email or texts are set up.
const remindersOn = push.available() || email.available() || sms.available();
defineJobs(jobs, { store, storage, data, reminders: remindersOn ? reminders : null });
if (production && !remindersOn) console.warn('No reminders are sent: set VAPID_* (push), RESEND_API_KEY (email) or TWILIO_* (texts).');
// /api/health answers 503 when the reminder check stops running, and ALERT_EMAIL (or SUPPORT_EMAIL) gets an email.
const health = createHealth({ jobs, remindersOn, email, alertTo: process.env.ALERT_EMAIL || process.env.SUPPORT_EMAIL || '' });
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
  const oauth = createOAuth({ config: oauthSettings });
  const inbox = createInbox({ store, data, policies, reader: createEmailReader(), jobs, oauth, key: inboxKey, domain: (process.env.INBOUND_EMAIL_DOMAIN || '').toLowerCase(), resendKey: process.env.RESEND_API_KEY || '', publicUrl: oauthSettings.publicUrl, gmailVerified: process.env.GMAIL_VERIFIED === 'true' });
  defineInboxJobs(jobs, inbox);
  // Accounts still saved as one document (with photos inside) move into the purchases and items tables.
  const migrated = await data.migrateAll();
  if (migrated) console.log(`Moved ${migrated} account${migrated === 1 ? '' : 's'} to the items tables.`);
  await jobs.start();
  const watch = setInterval(() => health.check(), 60 * 1000);
  watch.unref();
  const server = http.createServer(createApp({ store, data, production, policies, classifier: createClassifier(), receipts: createReceiptReader(), discharge: createDischargeReader(), labels: createLabelReader(), places: createPlaces({ store }), review, push, reminders, email, supportEmail: process.env.SUPPORT_EMAIL || '', inbox, oauth, publicUrl: oauthSettings.publicUrl, inboundSecret: process.env.RESEND_WEBHOOK_SECRET || '', sms, billing, health })).listen(port, host, () =>
    console.log(`Adltrack running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (${databaseUrl ? 'Postgres' : 'local file store'}, ${storage.kind === 's3' ? 'S3 file storage' : 'local file storage'})`));
  const shutdown = () => { server.close(); jobs.stop().finally(() => store.close().finally(() => process.exit(0))); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch(err => { console.error('Could not start:', err.message); process.exit(1); });

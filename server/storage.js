/* File storage for photos, receipts and labels: an S3-compatible bucket (Cloudflare R2, AWS S3) in production, a local folder in development.
   Every backend has the same three calls: put(key, body, contentType), get(key) → { body, contentType } or null, remove(key). */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const safeKey = key => {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9/_.-]{0,250}$/i.test(key) || key.split('/').some(s => s === '..' || s === '.' || !s)) throw new Error('Invalid storage key.');
  return key;
};

function localStorage(dir) {
  const file = key => path.join(dir, safeKey(key));
  return {
    kind: 'local',
    async put(key, body, contentType) {
      const target = file(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target + '.tmp', body);
      await fs.rename(target + '.tmp', target);
      await fs.writeFile(target + '.type', contentType);
    },
    async get(key) {
      const target = file(key);
      try { return { body: await fs.readFile(target), contentType: await fs.readFile(target + '.type', 'utf8') }; }
      catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    },
    async remove(key) {
      const target = file(key);
      await fs.rm(target, { force: true });
      await fs.rm(target + '.type', { force: true });
    }
  };
}

/* AWS Signature Version 4 for S3-compatible APIs, so no SDK is needed. */
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();
const hex = b => crypto.createHash('sha256').update(b).digest('hex');
const encodePath = p => p.split('/').map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
function signRequest({ method, url, headers = {}, body = '', accessKeyId, secretAccessKey, region, service = 's3', date = new Date() }) {
  const u = new URL(url);
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = hex(body);
  const all = { ...headers, host: u.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
  const names = Object.keys(all).map(k => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const query = [...u.searchParams].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method, encodePath(decodeURIComponent(u.pathname)), query, names.map(n => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

function s3Storage({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto', fetchImpl = fetch }) {
  const base = endpoint.replace(/\/+$/, '');
  const url = key => `${base}/${encodeURIComponent(bucket)}/${encodePath(safeKey(key))}`;
  async function call(method, key, body, headers = {}) {
    const target = url(key);
    const res = await fetchImpl(target, { method, headers: signRequest({ method, url: target, headers, body: body || '', accessKeyId, secretAccessKey, region }), body: body || undefined });
    return res;
  }
  return {
    kind: 's3',
    async put(key, body, contentType) {
      const res = await call('PUT', key, body, { 'content-type': contentType });
      if (!res.ok) throw new Error(`Storage upload failed (${res.status}).`);
    },
    async get(key) {
      const res = await call('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage read failed (${res.status}).`);
      return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'application/octet-stream' };
    },
    async remove(key) {
      const res = await call('DELETE', key);
      if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status}).`);
    }
  };
}

/* S3_* settings select the bucket; without them files go to a local folder. */
function s3Config(env) {
  const config = { endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, region: env.S3_REGION || 'auto' };
  return config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey ? config : null;
}

function createStorage({ s3, dir }) {
  return s3 ? s3Storage(s3) : localStorage(dir);
}

module.exports = { createStorage, s3Config, signRequest };

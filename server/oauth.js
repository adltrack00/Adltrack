/* OAuth with Google, Microsoft and Apple: sign-in ("Continue with Google / Apple") and inbox access (Gmail, Outlook) are
   separate requests with separate scopes, so signing in never grants access to email. Inbox tokens are encrypted at rest
   (AES-256-GCM) with INBOX_TOKEN_KEY. */
const crypto = require('node:crypto');

const GOOGLE = { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', issuers: ['https://accounts.google.com', 'accounts.google.com'] };
const MICROSOFT = { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' };
const APPLE = { auth: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', issuers: ['https://appleid.apple.com'] };
// Narrowest scopes that do the job: Gmail read-only (no sending, deleting or labels); Graph Mail.Read (read only).
const SCOPES = {
  signinGoogle: 'openid email profile',
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  outlook: 'openid email offline_access https://graph.microsoft.com/Mail.Read',
  signinApple: 'name email'
};

function oauthConfig(env) {
  const pick = (...keys) => keys.every(k => env[k]) ? Object.fromEntries(keys.map(k => [k, env[k]])) : null;
  const google = pick('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  const microsoft = pick('MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET');
  const apple = pick('APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY');
  return {
    google: google && { clientId: google.GOOGLE_CLIENT_ID, clientSecret: google.GOOGLE_CLIENT_SECRET },
    microsoft: microsoft && { clientId: microsoft.MICROSOFT_CLIENT_ID, clientSecret: microsoft.MICROSOFT_CLIENT_SECRET },
    apple: apple && { clientId: apple.APPLE_CLIENT_ID, teamId: apple.APPLE_TEAM_ID, keyId: apple.APPLE_KEY_ID, privateKey: apple.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n') },
    // The service's own address (APP_URL, also used in emails), for OAuth redirects and Outlook notifications.
    publicUrl: (env.APP_URL || '').replace(/\/+$/, '')
  };
}

/* Token encryption. The key is 32 bytes, base64. Each value gets its own random IV; the tag stops tampering. */
function tokenKey(value) {
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('INBOX_TOKEN_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).');
  return key;
}
function seal(key, value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}
function unseal(key, sealed) {
  const [v, iv, tag, body] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Not a sealed value.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8'));
}

const b64url = b => Buffer.from(b).toString('base64url');
/* An id token's claims. It comes straight from the provider's token endpoint over TLS, which OpenID Connect allows in place
   of checking the signature; issuer, audience, expiry and nonce are still checked. */
function idClaims(idToken, { issuers = null, audience, nonce = null }) {
  const part = String(idToken || '').split('.')[1];
  if (!part) throw new Error('No id token.');
  const c = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (issuers && !issuers.includes(c.iss)) throw new Error('Wrong issuer.');
  if (audience && (Array.isArray(c.aud) ? !c.aud.includes(audience) : c.aud !== audience)) throw new Error('Wrong audience.');
  if (typeof c.exp === 'number' && c.exp * 1000 < Date.now() - 60_000) throw new Error('Expired id token.');
  if (nonce !== null && c.nonce !== nonce) throw new Error('Wrong nonce.');
  return c;
}
/* Apple's client secret is a short-lived ES256 JWT signed with the Sign in with Apple key. */
function appleClientSecret(apple, now = Date.now()) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: apple.keyId })), iat = Math.floor(now / 1000);
  const claims = b64url(JSON.stringify({ iss: apple.teamId, iat, exp: iat + 300, aud: 'https://appleid.apple.com', sub: apple.clientId }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: apple.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64url(sig)}`;
}

function createOAuth({ config, fetch: http = globalThis.fetch }) {
  const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)).toString();
  async function post(url, form) {
    const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: qs(form) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || `Token request failed (${res.status}).`), { code: json.error, status: res.status });
    return json;
  }
  const google = config.google, microsoft = config.microsoft, apple = config.apple;
  return {
    available: { google: !!google, microsoft: !!microsoft, apple: !!apple },
    /* The provider's sign-in page for one purpose: signinGoogle, gmail, outlook or signinApple. */
    authUrl(purpose, { state, nonce, redirectUri, loginHint }) {
      if (purpose === 'signinGoogle') return `${GOOGLE.auth}?${qs({ client_id: google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.signinGoogle, state, nonce, prompt: 'select_account' })}`;
      if (purpose === 'gmail') return `${GOOGLE.auth}?${qs({ client_id: google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.gmail, state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', login_hint: loginHint })}`;
      if (purpose === 'outlook') return `${MICROSOFT.auth}?${qs({ client_id: microsoft.clientId, redirect_uri: redirectUri, response_type: 'code', response_mode: 'query', scope: SCOPES.outlook, state, nonce, prompt: 'select_account', login_hint: loginHint })}`;
      if (purpose === 'signinApple') return `${APPLE.auth}?${qs({ client_id: apple.clientId, redirect_uri: redirectUri, response_type: 'code', response_mode: 'form_post', scope: SCOPES.signinApple, state, nonce })}`;
      throw new Error('Unknown purpose.');
    },
    /* Code → tokens, with the checked id-token claims where there is one. */
    async exchange(purpose, { code, redirectUri, nonce = null }) {
      if (purpose === 'signinGoogle' || purpose === 'gmail') {
        const t = await post(GOOGLE.token, { code, client_id: google.clientId, client_secret: google.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
        if (purpose === 'gmail' && !String(t.scope || '').split(' ').includes(SCOPES.gmail)) throw Object.assign(new Error('Gmail access wasn’t granted.'), { code: 'scope' });
        return { ...t, claims: t.id_token ? idClaims(t.id_token, { issuers: GOOGLE.issuers, audience: google.clientId, nonce }) : null };
      }
      if (purpose === 'outlook') {
        const t = await post(MICROSOFT.token, { code, client_id: microsoft.clientId, client_secret: microsoft.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', scope: SCOPES.outlook });
        return { ...t, claims: t.id_token ? idClaims(t.id_token, { audience: microsoft.clientId, nonce }) : null };
      }
      if (purpose === 'signinApple') {
        const t = await post(APPLE.token, { code, client_id: apple.clientId, client_secret: appleClientSecret(apple), redirect_uri: redirectUri, grant_type: 'authorization_code' });
        return { ...t, claims: idClaims(t.id_token, { issuers: APPLE.issuers, audience: apple.clientId, nonce }) };
      }
      throw new Error('Unknown purpose.');
    },
    /* A fresh access token for an inbox. A revoked or expired grant throws with code 'invalid_grant'. */
    async refresh(provider, refreshToken) {
      if (provider === 'gmail') return post(GOOGLE.token, { refresh_token: refreshToken, client_id: google.clientId, client_secret: google.clientSecret, grant_type: 'refresh_token' });
      return post(MICROSOFT.token, { refresh_token: refreshToken, client_id: microsoft.clientId, client_secret: microsoft.clientSecret, grant_type: 'refresh_token', scope: SCOPES.outlook });
    },
    /* Google lets apps revoke a grant. Microsoft has no app-side revoke for personal grants, so its tokens are deleted. */
    async revoke(provider, token) {
      if (provider !== 'gmail' || !token) return false;
      const res = await http(`${GOOGLE.revoke}?${qs({ token })}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      return res.ok;
    }
  };
}

module.exports = { oauthConfig, createOAuth, tokenKey, seal, unseal, idClaims, appleClientSecret, SCOPES };

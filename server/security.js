/* Account security: strong passwords, sign-out after inactivity on a shared phone, and the device names in the sign-in history. */

// A shared phone is signed out after this long without anyone using the app.
const SHARED_IDLE_MINUTES = 15;
// How often a session's "last used" time is saved while someone uses the app.
const TOUCH_MS = 60 * 1000;

// The most used passwords and words, checked after leaving out digits and symbols ("Password123!" is "password").
const COMMON = new Set(['password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbnm', 'letmein', 'welcome', 'iloveyou',
  'admin', 'administrator', 'login', 'abc', 'abcdef', 'abcdefg', 'abcdefgh', 'monkey', 'dragon', 'football', 'baseball', 'soccer', 'hockey',
  'sunshine', 'princess', 'shadow', 'master', 'superman', 'batman', 'trustno', 'freedom', 'whatever', 'starwars', 'pokemon', 'secret',
  'changeme', 'default', 'mypassword', 'passwordpassword', 'adltrack', 'caregiver', 'family', 'mother', 'father', 'grandma', 'grandpa',
  'jesus', 'love', 'lovely', 'hello', 'hellohello', 'flower', 'summer', 'winter', 'spring', 'autumn', 'charlie', 'michael', 'jennifer',
  'jordan', 'hunter', 'ranger', 'buster', 'tigger', 'cookie', 'chocolate', 'computer', 'internet', 'samsung', 'apple', 'google', 'iphone']);

/* What's wrong with a new password, or '' when it's strong enough: at least 10 characters, not one of the most used passwords,
   not only one character or a simple run (1234567890, aaaaaaaaaa), and not the person's email or name. */
function passwordProblem(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string' || password.length < 10) return 'Use a password with at least 10 characters.';
  if (password.length > 200) return 'Use a password with at most 200 characters.';
  const lower = password.toLowerCase(), letters = lower.replace(/[^a-z]/g, '');
  const run = '01234567890123456789abcdefghijklmnopqrstuvwxyz', backwards = [...run].reverse().join('');
  if (new Set(lower).size <= 2 || run.includes(lower) || backwards.includes(lower) || COMMON.has(letters) || COMMON.has(lower))
    return 'That password is too easy to guess. Try a few words that mean something only to you.';
  const mail = String(email).toLowerCase(), local = mail.split('@')[0], first = String(name).trim().toLowerCase();
  if ((mail && lower.includes(mail)) || (local.length >= 4 && letters === local.replace(/[^a-z]/g, '')) || (first.length >= 3 && letters === first.replace(/[^a-z]/g, '')))
    return 'Don’t use your email or name as your password.';
  return '';
}

/* "iPhone · Safari", "Windows · Chrome": the kind of device a sign-in came from, for the sign-in history. Never the full string. */
function deviceName(userAgent) {
  const ua = String(userAgent || '');
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [system, browser].filter(Boolean).join(' · ') || 'Unknown device';
}

/* A shared phone's session that nobody has used for SHARED_IDLE_MINUTES. */
const idleExpired = (session, at = Date.now()) => !!session.shared && at - new Date(session.lastSeen).getTime() > SHARED_IDLE_MINUTES * 60 * 1000;

module.exports = { passwordProblem, deviceName, idleExpired, SHARED_IDLE_MINUTES, TOUCH_MS };

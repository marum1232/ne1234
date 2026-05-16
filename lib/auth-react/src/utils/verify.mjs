// Quick smoke-test — run with: node src/utils/verify.mjs
// Tests tokenStorage (memory), jwtUtils with non-ASCII claim, authClient shape.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── 1. Load built CJS bundle ──────────────────────────────────────────────
const pkg = require('../../dist/index.cjs');
const { createTokenStorage, decodeJwt, isTokenExpired, getTokenExpiryRemaining, createAuthClient } = pkg;

let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    pass++;
  } else {
    console.error(`  ✗  ${label}`);
    fail++;
  }
}

// ── 2. TokenStorage (memory) ──────────────────────────────────────────────
console.log('\n[tokenStorage — memory]');
const mem = createTokenStorage('memory');
assert('getAccessToken() → null before set', mem.getAccessToken() === null);
mem.setAccessToken('tok_abc123');
assert('getAccessToken() → stored token', mem.getAccessToken() === 'tok_abc123');
mem.removeAccessToken();
assert('removeAccessToken() → null', mem.getAccessToken() === null);

// ── 3. jwtUtils — non-ASCII payload ──────────────────────────────────────
console.log('\n[jwtUtils — non-ASCII payload]');
// Craft a JWT with a Urdu/Arabic claim in the payload
function makeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(payload)}.fakesig`;
}

const now = Math.floor(Date.now() / 1000);
const validJwt   = makeJwt({ sub: '42', exp: now + 3600, iat: now, city: 'آزاد کشمیر' });
const expiredJwt = makeJwt({ sub: '99', exp: now - 120,  iat: now - 500 });

const decoded = decodeJwt(validJwt);
assert('decodeJwt returns payload object', decoded !== null && decoded.sub === '42');
assert('non-ASCII claim decoded correctly', decoded?.city === 'آزاد کشمیر');
assert('isTokenExpired → false for valid token',  !isTokenExpired(validJwt, 60));
assert('isTokenExpired → true for expired token',  isTokenExpired(expiredJwt, 60));

const remaining = getTokenExpiryRemaining(validJwt);
assert(`getTokenExpiryRemaining → >0 (got ${remaining}s)`, remaining > 0);
assert('getTokenExpiryRemaining expired → 0', getTokenExpiryRemaining(expiredJwt) === 0);

// ── 4. authClient shape ───────────────────────────────────────────────────
console.log('\n[authClient — shape check]');
const storage = createTokenStorage('memory');
storage.setAccessToken('fake-token');
const client = createAuthClient({ baseURL: 'http://localhost:5000', tokenStorage: storage });
assert('client.get is a function',    typeof client.get    === 'function');
assert('client.post is a function',   typeof client.post   === 'function');
assert('client.put is a function',    typeof client.put    === 'function');
assert('client.patch is a function',  typeof client.patch  === 'function');
assert('client.delete is a function', typeof client.delete === 'function');

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

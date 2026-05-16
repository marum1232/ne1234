// Smoke-test: run with  node src/utils/verify.mjs
// Tests tokenStorage (memory), jwtUtils with non-ASCII claim,
// authClient shape, and hook/type exports from the built bundle.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const pkg = require('../../dist/index.cjs');
const {
  createTokenStorage,
  createAuthClient,
  decodeJwt,
  isTokenExpired,
  getTokenExpiryRemaining,
  // hook functions (React hooks — shape-check only, not called)
  useAuth,
  useTokenRefresh,
  useLoginFlow,
  // context
  AuthContext,
  AuthProvider,
  useAuthContext,
  version,
} = pkg;

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

// ── 1. package version ────────────────────────────────────────────────────
console.log('\n[version]');
assert('version export === 0.0.1', version === '0.0.1');

// ── 2. TokenStorage (memory) ──────────────────────────────────────────────
console.log('\n[tokenStorage — memory]');
const mem = createTokenStorage('memory');
assert('getAccessToken() → null before set', mem.getAccessToken() === null);
mem.setAccessToken('tok_abc123');
assert('getAccessToken() → stored token', mem.getAccessToken() === 'tok_abc123');
mem.removeAccessToken();
assert('removeAccessToken() → null', mem.getAccessToken() === null);

// ── 3. jwtUtils — non-ASCII payload (Urdu / Arabic) ──────────────────────
console.log('\n[jwtUtils — non-ASCII payload]');
function makeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(payload)}.fakesig`;
}
const now = Math.floor(Date.now() / 1000);
const validJwt   = makeJwt({ sub: '42', exp: now + 3600, iat: now, city: 'آزاد کشمیر' });
const expiredJwt = makeJwt({ sub: '99', exp: now - 120,  iat: now - 500 });

const decoded = decodeJwt(validJwt);
assert('decodeJwt returns payload object', decoded !== null && decoded.sub === '42');
assert('non-ASCII claim (Urdu) decoded', decoded?.city === 'آزاد کشمیر');
assert('isTokenExpired → false (valid)',    !isTokenExpired(validJwt, 60));
assert('isTokenExpired → true (expired)',    isTokenExpired(expiredJwt, 60));
const remaining = getTokenExpiryRemaining(validJwt);
assert(`getTokenExpiryRemaining → >0 (got ${remaining}s)`, remaining > 0);
assert('getTokenExpiryRemaining expired → 0', getTokenExpiryRemaining(expiredJwt) === 0);

// ── 4. authClient shape ───────────────────────────────────────────────────
console.log('\n[authClient — shape]');
const storage = createTokenStorage('memory');
storage.setAccessToken('fake-token');
const client = createAuthClient({ baseURL: 'http://localhost:5000', tokenStorage: storage });
assert('client.get    is function', typeof client.get    === 'function');
assert('client.post   is function', typeof client.post   === 'function');
assert('client.put    is function', typeof client.put    === 'function');
assert('client.patch  is function', typeof client.patch  === 'function');
assert('client.delete is function', typeof client.delete === 'function');

// ── 5. Hook exports are functions ─────────────────────────────────────────
console.log('\n[hook exports — functions]');
assert('useAuth          is function', typeof useAuth          === 'function');
assert('useTokenRefresh  is function', typeof useTokenRefresh  === 'function');
assert('useLoginFlow     is function', typeof useLoginFlow     === 'function');
assert('useAuthContext   is function', typeof useAuthContext   === 'function');
assert('AuthProvider     is function', typeof AuthProvider     === 'function');
assert('AuthContext      is object',   typeof AuthContext      === 'object' && AuthContext !== null);

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

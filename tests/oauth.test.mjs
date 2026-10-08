import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../auth/worker.mjs';

const env = {
  CMS_ORIGIN: 'https://oslemoncat.github.io', CALLBACK_URL: 'https://auth.example.test/callback',
  REPOSITORY: 'oslemoncat/oslemoncat.github.io', ALLOWED_GITHUB_LOGIN: 'oslemoncat',
  GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', OAUTH_STATE_SECRET: 'test-only-state-key-with-at-least-32-chars'
};
async function loginRequest() {
  const response = await handleRequest(new Request('https://auth.example.test/auth?provider=github&site_id=oslemoncat.github.io&scope=repo'), env);
  return { response, redirect: new URL(response.headers.get('Location')), cookie: response.headers.get('Set-Cookie').split(';')[0] };
}
const callbackRequest = (state, cookie) => new Request(`https://auth.example.test/callback?code=test-code&state=${state}`, { headers: { Cookie: cookie } });
const mockGitHub = login => async (url, options) => {
  if (url.endsWith('/access_token')) {
    const body = JSON.parse(options.body);
    assert.equal(body.redirect_uri, env.CALLBACK_URL);
    assert.match(body.code_verifier, /^[\w-]{43}$/);
    return Response.json({ access_token: 'test-access-token' });
  }
  if (url.endsWith('/user')) return Response.json({ login });
  return Response.json({ full_name: env.REPOSITORY, private: false, permissions: { push: true } });
};
test('OAuth uses state, PKCE and fixed public-repository scope', async () => {
  const { response, redirect, cookie } = await loginRequest();
  assert.equal(response.status, 302);
  assert.equal(redirect.origin, 'https://github.com');
  assert.equal(redirect.searchParams.get('scope'), 'public_repo');
  assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  assert.match(redirect.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(cookie, /^__Host-decap_session=/);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
});
test('Successful login uses exact Decap protocol and fixed opener origin', async () => {
  const { redirect, cookie } = await loginRequest();
  const response = await handleRequest(callbackRequest(redirect.searchParams.get('state'), cookie), env, mockGitHub('oslemoncat'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.includes('authorization:github:success:'));
  assert.ok(html.includes('event.source !== window.opener'));
  assert.ok(html.includes('event.origin !== origin'));
  assert.ok(html.includes('https://oslemoncat.github.io'));
  assert.ok(!html.includes('test-secret'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Content-Security-Policy'), /nonce-/);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});
test('Missing or mismatched state never calls GitHub', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; throw new Error(); };
  const missing = await handleRequest(callbackRequest('bad', ''), env, fetcher);
  const { cookie } = await loginRequest();
  const mismatched = await handleRequest(callbackRequest('bad', cookie), env, fetcher);
  assert.equal(missing.status, 403); assert.equal(mismatched.status, 403); assert.equal(requests, 0);
});
test('Tampered session cookie is rejected', async () => {
  const { redirect, cookie } = await loginRequest();
  const changed = cookie.replace(/=(.)/, (_, char) => `=${char === 'e' ? 'f' : 'e'}`);
  const result = await handleRequest(callbackRequest(redirect.searchParams.get('state'), changed), env, mockGitHub('oslemoncat'));
  assert.equal(result.status, 403);
});
test('Other accounts and read-only repository users cannot receive a token', async () => {
  const { redirect, cookie } = await loginRequest();
  const response = await handleRequest(callbackRequest(redirect.searchParams.get('state'), cookie), env, mockGitHub('other-user'));
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes('test-access-token'));
  const readOnly = async (url, options) => url.includes('/repos/') ? Response.json({ full_name: env.REPOSITORY, private: false, permissions: { push: false } }) : mockGitHub('oslemoncat')(url, options);
  const denied = await handleRequest(callbackRequest(redirect.searchParams.get('state'), cookie), env, readOnly);
  assert.equal(denied.status, 403);
});
test('Unconfigured auth and unexpected origins fail closed', async () => {
  assert.equal((await handleRequest(new Request('https://auth.example.test/auth'), {})).status, 503);
  assert.equal((await handleRequest(new Request('https://auth.example.test/auth?provider=github&site_id=evil.test'), env)).status, 400);
  assert.equal((await handleRequest(new Request('https://auth.example.test/auth?provider=github&site_id=oslemoncat.github.io', { headers: { Origin: 'https://evil.test' } }), env)).status, 403);
});

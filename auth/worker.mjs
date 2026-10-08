// Cloudflare Worker: GitHub OAuth bridge for this site's Decap /admin/.
// No tokens or secrets are ever written to logs or to the public repository.
const encoder = new TextEncoder();
const cookieName = '__Host-decap_session';
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), x => x.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const jsonForScript = data => JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const clearCookie = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const baseHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };

async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signSession(data, secret) {
  const payload = b64(encoder.encode(JSON.stringify(data)));
  const signature = b64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload))));
  return `${payload}.${signature}`;
}
async function readSession(value, secret) {
  if (!value || value.length > 2048) throw new Error('state');
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) throw new Error('state');
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), unb64(signature), encoder.encode(payload));
  if (!valid) throw new Error('state');
  const data = JSON.parse(new TextDecoder().decode(unb64(payload)));
  if (data.expires < Date.now() || !/^[\w-]{43}$/.test(data.state) || !/^[\w-]{43}$/.test(data.verifier)) throw new Error('state');
  return data;
}
function config(env) {
  for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OAUTH_STATE_SECRET', 'CMS_ORIGIN', 'CALLBACK_URL', 'REPOSITORY', 'ALLOWED_GITHUB_LOGIN']) {
    if (!env[key] || String(env[key]).includes('REPLACE')) throw new Error('configuration');
  }
  if (env.OAUTH_STATE_SECRET.length < 32) throw new Error('configuration');
  const cms = new URL(env.CMS_ORIGIN), callback = new URL(env.CALLBACK_URL);
  if (cms.protocol !== 'https:' || cms.origin !== env.CMS_ORIGIN || callback.protocol !== 'https:' || callback.pathname !== '/callback' || callback.search || callback.hash || callback.username || callback.password) throw new Error('configuration');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.REPOSITORY)) throw new Error('configuration');
  return { cms, callback };
}
function popup(origin, result, payload, status = 200) {
  const nonce = random();
  const message = `authorization:github:${result}:${JSON.stringify(payload)}`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>GitHub 登录</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p id="status">正在完成登录，请保持此窗口打开。</p><script nonce="${nonce}">
    const origin = ${jsonForScript(origin)};
    const message = ${jsonForScript(message)};
    if (!window.opener) document.getElementById('status').textContent = '请从网站的文章管理页面重新登录。';
    else {
      function onMessage(event) {
        if (event.origin !== origin || event.source !== window.opener || event.data !== 'authorizing:github') return;
        window.removeEventListener('message', onMessage);
        window.opener.postMessage(message, origin);
        document.getElementById('status').textContent = '登录结果已返回网站，可以关闭此窗口。';
      }
      window.addEventListener('message', onMessage);
      window.opener.postMessage('authorizing:github', origin);
    }
  </script></body></html>`;
  return new Response(html, { status, headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie, 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'` } });
}
const errorResponse = (message, status) => new Response(message, { status, headers: { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' } });

export async function handleRequest(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);
  if (url.pathname === '/health') return new Response('ok', { headers: baseHeaders });
  if (!['/auth', '/callback'].includes(url.pathname)) return errorResponse('Not found', 404);
  let settings;
  try { settings = config(env); } catch { return errorResponse('登录服务尚未配置，请完成 Worker 变量和 Secret 设置。', 503); }
  const { cms, callback } = settings;
  if (url.origin !== callback.origin) return errorResponse('Incorrect authentication origin', 400);
  const origin = request.headers.get('Origin');
  if (origin && origin !== cms.origin) return errorResponse('Origin not allowed', 403);
  if (url.pathname === '/auth') {
    if (url.searchParams.get('provider') !== 'github' || url.searchParams.get('site_id') !== cms.hostname) return errorResponse('Invalid provider or site', 400);
    const state = random(), verifier = random();
    const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
    const session = await signSession({ state, verifier, expires: Date.now() + 600_000 }, env.OAUTH_STATE_SECRET);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback.href, scope: 'public_repo', state, code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'false', login: env.ALLOWED_GITHUB_LOGIN }).toString();
    return new Response(null, { status: 302, headers: { ...baseHeaders, Location: authorize.href, 'Set-Cookie': `${cookieName}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
  }
  let session;
  try {
    const cookie = request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    session = await readSession(cookie, env.OAUTH_STATE_SECRET);
    if (url.searchParams.get('state') !== session.state) throw new Error('state');
  } catch { return popup(cms.origin, 'error', { message: '登录请求已失效或校验失败，请重新登录。' }, 403); }
  if (url.searchParams.has('error')) return popup(cms.origin, 'error', { message: 'GitHub 授权未完成。' }, 401);
  const code = url.searchParams.get('code');
  if (!code || code.length > 512) return popup(cms.origin, 'error', { message: '缺少登录授权码。' }, 400);
  try {
    const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback.href, code_verifier: session.verifier })
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token || token.error) throw new Error('token');
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'oslemoncat-decap-oauth' };
    const userResponse = await fetcher('https://api.github.com/user', { headers });
    const user = await userResponse.json();
    if (!userResponse.ok || user.login?.toLowerCase() !== env.ALLOWED_GITHUB_LOGIN.toLowerCase()) return popup(cms.origin, 'error', { message: '这个 GitHub 账号没有本站的管理权限。' }, 403);
    const repoResponse = await fetcher(`https://api.github.com/repos/${env.REPOSITORY}`, { headers });
    const repo = await repoResponse.json();
    if (!repoResponse.ok || repo.permissions?.push !== true || repo.private !== false || repo.full_name?.toLowerCase() !== env.REPOSITORY.toLowerCase()) return popup(cms.origin, 'error', { message: '需要对本站公开仓库拥有写入权限。' }, 403);
    return popup(cms.origin, 'success', { token: token.access_token, provider: 'github' });
  } catch { return popup(cms.origin, 'error', { message: 'GitHub 登录服务暂时不可用，请稍后重试。' }, 502); }
}
export default { fetch(request, env) { return handleRequest(request, env); } };

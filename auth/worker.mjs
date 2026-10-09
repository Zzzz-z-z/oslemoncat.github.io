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
  if (url.pathname.startsWith('/api/')) return handlePortal(request, env, fetcher);
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
    const portal = url.searchParams.get('mode') === 'portal';
    const session = await signSession({ state, verifier, portal, expires: Date.now() + 600_000 }, env.OAUTH_STATE_SECRET);
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback.href, scope: 'public_repo', state, code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'true', ...(portal ? {} : { login: adminNames(env)[0] }) }).toString();
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
    if (!userResponse.ok || (!session.portal && !adminNames(env).includes(user.login?.toLowerCase()))) return popup(cms.origin, 'error', { message: '这个 GitHub 账号没有本站的管理权限。' }, 403);
    const repoResponse = await fetcher(`https://api.github.com/repos/${env.REPOSITORY}`, { headers });
    const repo = await repoResponse.json();
    if (!repoResponse.ok || (!session.portal && repo.permissions?.push !== true) || repo.private !== false || repo.full_name?.toLowerCase() !== env.REPOSITORY.toLowerCase()) return popup(cms.origin, 'error', { message: '需要对本站公开仓库拥有写入权限。' }, 403);
    return popup(cms.origin, 'success', { token: token.access_token, provider: 'github', ...(session.portal ? { portal: true } : {}) });
  } catch { return popup(cms.origin, 'error', { message: 'GitHub 登录服务暂时不可用，请稍后重试。' }, 502); }
}
export default { fetch(request, env) { return handleRequest(request, env); } };

// Unified website API. GitHub identities and permissions are checked on every request.
class PortalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const postSlug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
const adminNames = env => String(env.ALLOWED_GITHUB_LOGIN || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const decodeGithub = text => new TextDecoder().decode(unb64(String(text).replace(/\s/g, '').replaceAll('+', '-').replaceAll('/', '_')));
function portalJson(data, status, origin) {
  return Response.json(data, { status, headers: { ...baseHeaders, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
}
async function portalIdentity(request, env, fetcher) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([\w.-]{1,512})$/)?.[1];
  if (!token) throw new PortalError(401, '请先登录。');
  const gh = async (resource, method = 'GET', body) => {
    const response = await fetcher('https://api.github.com' + resource, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'lemoncat-hub', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new PortalError(response.status === 401 ? 401 : response.status, response.status === 401 ? '登录已失效，请重新登录。' : response.status === 403 ? 'GitHub 权限不足或请求过于频繁，请稍后重试。' : response.status === 404 ? '内容暂时不存在。' : 'GitHub 未能完成操作，请稍后重试。');
    return data;
  };
  const user = await gh('/user');
  const repo = await gh(`/repos/${env.REPOSITORY}`);
  if (!user.login || repo.private !== false || repo.full_name?.toLowerCase() !== env.REPOSITORY.toLowerCase()) throw new PortalError(403, '网站仓库配置不正确。');
  return { gh, user, repo, role: adminNames(env).includes(user.login.toLowerCase()) && repo.permissions?.push === true ? 'admin' : 'member' };
}
const needAdmin = identity => { if (identity.role !== 'admin') throw new PortalError(403, '只有管理员可以审核、发布或删除文章。'); };
async function readPortalBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 30_000_000) throw new PortalError(413, '本次附件总量过大，请分批提交。');
  const text = await request.text();
  if (text.length > 30_000_000) throw new PortalError(413, '本次附件总量过大，请分批提交。');
  try { return JSON.parse(text); } catch { throw new PortalError(400, '提交内容格式错误。'); }
}
async function submissionDocuments(input, identity, env) {
  const p = input.post || {};
  if (!postSlug(p.slug) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 160 || typeof p.body !== 'string' || !p.body.trim() || p.body.length > 400_000) throw new PortalError(400, '请填写有效的文章地址、标题和正文。');
  const modulesFile = await identity.gh(`/repos/${env.REPOSITORY}/contents/content/modules.json`);
  const modules = JSON.parse(decodeGithub(modulesFile.content));
  if (!modules.some(x => x.slug === p.module)) throw new PortalError(400, '请选择有效的知识模块。');
  const isDate = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const time = Date.parse(value + 'T00:00:00Z'); return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value; };
  if (!isDate(p.date) || !isDate(p.updated) || p.updated < p.date) throw new PortalError(400, '文章日期无效。');
  const tags = Array.isArray(p.tags) ? p.tags.filter(x => typeof x === 'string' && x.length <= 40).slice(0,20) : [];
  const images = Array.isArray(p.images) ? p.images.slice(0,30) : [];
  const attachments = Array.isArray(p.attachments) ? p.attachments.slice(0,30) : [];
  for (const [records,key,prefix] of [[images,'src','/assets/images/'],[attachments,'file','/assets/files/']]) {
    if (records.some(x => !x || typeof x[key] !== 'string' || !x[key].startsWith(prefix) || /[\\\u0000-\u001f]/.test(x[key]) || x[key].split('/').includes('..') || ['caption','title'].some(k => x[k] != null && (typeof x[k] !== 'string' || x[k].length > 300)))) throw new PortalError(400, '附件地址无效。');
  }
  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length > 12) throw new PortalError(400, '一次最多上传 12 个文件。');
  let bytes = 0;
  const documents = [];
  const seen = new Set();
  for (const f of files) {
    const isImage = /^assets\/images\/uploads\/[a-z0-9-]{1,120}\.(png|jpg|jpeg|gif|webp|avif)$/i.test(f.path || '');
    const isFile = /^assets\/files\/uploads\/[a-z0-9-]{1,120}\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|zip|mp4|webm|ogv|mp3|m4a|wav|ogg|oga|flac)$/i.test(f.path || '');
    if ((!isImage && !isFile) || typeof f.content !== 'string' || f.content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content) || seen.has(f.path)) throw new PortalError(400, '文件名称或类型无效。');
    seen.add(f.path);
    const size = f.content.length * 3 / 4 - (f.content.endsWith('==') ? 2 : f.content.endsWith('=') ? 1 : 0);
    if (size > (isImage ? 10 : 20) * 1024 * 1024 || (bytes += size) > 20 * 1024 * 1024) throw new PortalError(413, '图片最多 10 MB、附件最多 20 MB，本次文件总量最多 20 MB。');
    documents.push({ path: f.path, content: f.content, encoding: 'base64' });
  }
  const meta = { slug:p.slug, title:p.title.trim(), summary:String(p.summary || '').slice(0,1000), module:p.module, date:p.date, updated:p.updated, tags, cover:images[0]?.src || p.cover || '', order:0, draft:false, images, attachments, author:identity.user.login };
  if (meta.cover && (!meta.cover.startsWith('/assets/images/') && !meta.cover.startsWith('assets/images/'))) throw new PortalError(400, '封面图地址无效。');
  const source = '---\n' + Object.entries(meta).map(([key,value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n' + p.body.trim() + '\n';
  documents.push({ path:`content/posts/${p.slug}.md`, content:source, encoding:'utf-8' });
  return { documents, post:meta };
}
async function commitPortalFiles(gh, repository, parentSha, documents, message) {
  const parent = await gh(`/repos/${repository}/git/commits/${parentSha}`);
  const tree = [];
  for (const document of documents) {
    const blob = await gh(`/repos/${repository}/git/blobs`, 'POST', { content:document.content, encoding:document.encoding });
    tree.push({ path:document.path, mode:'100644', type:'blob', sha:blob.sha });
  }
  const createdTree = await gh(`/repos/${repository}/git/trees`, 'POST', { base_tree:parent.tree.sha, tree });
  const commit = await gh(`/repos/${repository}/git/commits`, 'POST', { message, tree:createdTree.sha, parents:[parentSha] });
  return commit.sha;
}
async function getPortalSubmission(identity, env, number) {
  const pr = await identity.gh(`/repos/${env.REPOSITORY}/pulls/${number}`);
  if (pr.base?.repo?.full_name?.toLowerCase() !== env.REPOSITORY.toLowerCase() || pr.base.ref !== 'main' || !/^lemoncat\/submission-[a-z0-9-]+$/.test(pr.head?.ref || '') || !pr.title?.startsWith('[投稿] ')) throw new PortalError(404, '这不是本站的文章投稿。');
  if (identity.role !== 'admin' && pr.user?.login?.toLowerCase() !== identity.user.login.toLowerCase()) throw new PortalError(403, '只能查看或修改自己的投稿。');
  return pr;
}
async function inspectPortalSubmission(identity, env, pr) {
  if (pr.changed_files > 50) throw new PortalError(400, '稿件修改的文件过多。');
  const files = await identity.gh(`/repos/${env.REPOSITORY}/pulls/${pr.number}/files?per_page=100`);
  if (files.length !== pr.changed_files) throw new PortalError(409, '文件列表尚未完整，请刷新后重试。');
  const posts = files.filter(f => /^content\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(f.filename));
  if (posts.length !== 1 || files.some(f => !['added','modified'].includes(f.status) || (!posts.includes(f) && (f.status !== 'added' || !/^assets\/(images|files)\/uploads\/[a-z0-9-]+\.(png|jpg|jpeg|gif|webp|avif|pdf|docx?|xlsx?|pptx?|txt|md|csv|zip|mp4|webm|ogv|mp3|m4a|wav|ogg|oga|flac)$/i.test(f.filename))))) throw new PortalError(403, '稿件包含文章和媒体以外的改动，不能从这里发布。');
  const source = await identity.gh(`/repos/${pr.head.repo.full_name}/contents/${posts[0].filename}?ref=${pr.head.sha}`);
  return { files, source:decodeGithub(source.content), path:posts[0].filename };
}
async function handlePortal(request, env, fetcher) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.CMS_ORIGIN) return errorResponse('Origin not allowed',403);
  if (request.method === 'OPTIONS') return portalJson({},200,origin);
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.REPOSITORY || '')) throw new PortalError(503,'网站服务尚未配置。');
    const identity = await portalIdentity(request,env,fetcher), {gh,user,role,repo} = identity;
    const url = new URL(request.url), resource = url.pathname;
    if (resource === '/api/session' && request.method === 'GET') return portalJson({login:user.login,id:actorId(identity),avatar:user.avatar_url,role,ai:role==='admin' && Boolean(env.DEEPSEEK_API_KEY)},200,origin);
    if (resource === '/api/submissions' && request.method === 'GET') {
      const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page')) || 1));
      const prs = await gh(`/repos/${env.REPOSITORY}/pulls?state=all&base=main&sort=updated&per_page=100&page=${page}`);
      return portalJson({items:prs.filter(p=>p.title?.startsWith('[投稿] ') && p.head?.ref?.startsWith('lemoncat/submission-') && (role==='admin' || p.user?.login?.toLowerCase()===user.login.toLowerCase())).map(p=>({number:p.number,title:p.title.slice(5),author:p.user?.login,state:p.merged_at?'published':p.state==='open'?'pending':'closed',sha:p.head.sha,date:p.updated_at,url:p.html_url})), hasMore:prs.length===100},200,origin);
    }
    if (resource === '/api/submissions' && request.method === 'POST') {
      const input = await readPortalBody(request), {documents,post} = await submissionDocuments(input,identity,env);
      const source = await gh(`/repos/${env.REPOSITORY}/git/ref/heads/main`);
      const forkName = env.REPOSITORY.split('/')[1];
      let fork;
      try { fork = await gh(`/repos/${user.login}/${forkName}`); } catch(error) { if(error.status!==404)throw error; fork = await gh(`/repos/${env.REPOSITORY}/forks`,'POST',{}); }
      if (fork.full_name?.toLowerCase()===env.REPOSITORY.toLowerCase()) throw new PortalError(400,'管理员请直接发布文章。');
      if (!fork.fork || fork.parent?.full_name?.toLowerCase()!==env.REPOSITORY.toLowerCase() || fork.owner?.login?.toLowerCase()!==user.login.toLowerCase()) throw new PortalError(409,'同名仓库不属于本站投稿空间，请先在 GitHub 调整同名仓库。');
      const branch = 'lemoncat/submission-' + crypto.randomUUID();
      try { await gh(`/repos/${fork.full_name}/git/refs`,'POST',{ref:'refs/heads/'+branch,sha:source.object.sha}); } catch(error) { if(error.status===422 || error.status===409) throw new PortalError(409,'GitHub 正在准备你的稿件空间，请稍后再次提交。'); throw error; }
      const sha = await commitPortalFiles(gh,fork.full_name,source.object.sha,documents,'Submit article: '+post.title);
      await gh(`/repos/${fork.full_name}/git/refs/heads/${branch}`,'PATCH',{sha,force:false});
      const pr = await gh(`/repos/${env.REPOSITORY}/pulls`,'POST',{title:'[投稿] '+post.title,body:'由 '+user.login+' 提交，等待 Lemoncat 审核。\n\n知识模块：'+post.module,head:user.login+':'+branch,base:'main'});
      return portalJson({number:pr.number,url:pr.html_url},201,origin);
    }
    const submissionMatch = resource.match(/^\/api\/submissions\/(\d+)$/);
    if (submissionMatch && request.method==='GET') {
      const pr = await getPortalSubmission(identity,env,submissionMatch[1]);
      const content = await inspectPortalSubmission(identity,env,pr);
      return portalJson({number:pr.number,title:pr.title.slice(5),author:pr.user.login,sha:pr.head.sha,state:pr.state,canDelete:role==='admin'||pr.user.login.toLowerCase()===user.login.toLowerCase(),check:role==='admin'&&pr.state==='open'?await submissionCheck(identity,env,pr):null,source:content.source,mediaBase:`https://raw.githubusercontent.com/${pr.head.repo.full_name}/${pr.head.sha}/`,files:content.files.map(f=>({path:f.filename,status:f.status}))},200,origin);
    }
    if (submissionMatch && request.method==='PATCH') {
      const pr = await getPortalSubmission(identity,env,submissionMatch[1]);
      if(pr.state!=='open' || pr.user.login.toLowerCase()!==user.login.toLowerCase()) throw new PortalError(403,'只能修改自己尚未审核的投稿。');
      const current = await inspectPortalSubmission(identity,env,pr), input = await readPortalBody(request);
      const {documents,post} = await submissionDocuments(input,identity,env);
      if(current.path!==`content/posts/${post.slug}.md` || input.sha!==pr.head.sha) throw new PortalError(409,'稿件已经变化，请刷新；修改时请保持文章地址。');
      const sha = await commitPortalFiles(gh,pr.head.repo.full_name,pr.head.sha,documents,'Update article: '+post.title);
      await gh(`/repos/${pr.head.repo.full_name}/git/refs/heads/${pr.head.ref}`,'PATCH',{sha,force:false});
      await gh(`/repos/${env.REPOSITORY}/pulls/${pr.number}`,'PATCH',{title:'[投稿] '+post.title});
      return portalJson({number:pr.number,sha},200,origin);
    }
    const reviewMatch = resource.match(/^\/api\/submissions\/(\d+)\/review$/);
    if(reviewMatch && request.method==='POST') {
      needAdmin(identity);
      const input=await readPortalBody(request),pr=await getPortalSubmission(identity,env,reviewMatch[1]);
      if(pr.state!=='open' || input.sha!==pr.head.sha) throw new PortalError(409,'稿件已变化或已处理，请重新打开。');
      if(input.action==='reject') { await gh(`/repos/${env.REPOSITORY}/pulls/${pr.number}`,'PATCH',{state:'closed'}); return portalJson({state:'closed'},200,origin); }
      if(input.action!=='publish') throw new PortalError(400,'审核操作无效。');
      const inspected=await inspectPortalSubmission(identity,env,pr);
      const owner=await checkSubmissionOwner(identity,env,pr,inspected);
      const check=await submissionCheck(identity,env,pr);
      if(check.status!=='success'){const error=new PortalError(409,check.message);error.check=check;throw error;}
      const merged=await gh(`/repos/${env.REPOSITORY}/pulls/${pr.number}/merge`,'PUT',{sha:pr.head.sha,merge_method:'squash',commit_title:'Publish article: '+pr.title.slice(5)});
      if(!merged.merged) throw new PortalError(409,'文章暂时不能发布，请检查合并冲突。');
      try{await writeOwner(identity,env,owner.slug,owner,fetcher);}catch{ return portalJson({state:'published',message:'文章已发布；作者权限记录暂未完成，可由管理员删除。'},200,origin); }
      return portalJson({state:'published'},200,origin);
    }
    if(resource==='/api/ownership'&&request.method==='GET'){
      const owners=await readOwners(gh,env),id=actorId(identity);
      return portalJson({owned:Object.entries(owners).filter(([,p])=>id&&p.id===id).map(([slug])=>slug)},200,origin);
    }
    const permission=resource.match(/^\/api\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/permissions$/);
    if(permission&&request.method==='GET'){
      if(role==='admin')return portalJson({canDelete:true,canEdit:true},200,origin);
      const owners=await readOwners(gh,env),id=actorId(identity);
      return portalJson({canDelete:Boolean(id&&ownerOf(owners,permission[1])?.id===id),canEdit:false},200,origin);
    }
    if(submissionMatch&&request.method==='DELETE'){
      const pr=await getPortalSubmission(identity,env,submissionMatch[1]);
      if(pr.merged_at)throw new PortalError(409,'文章已发布，请到已发布文章中删除。');
      await gh(`/repos/${env.REPOSITORY}/pulls/${pr.number}`,'PATCH',{state:'closed'});
      return portalJson({deleted:true},200,origin);
    }
    if(resource==='/api/articles' && request.method==='POST') {
      needAdmin(identity);
      const {documents,post}=await submissionDocuments(await readPortalBody(request),identity,env);
      const owners=await readOwners(gh,env);let existed=false;
      try{await gh('/repos/'+env.REPOSITORY+'/contents/content/posts/'+post.slug+'.md?ref=main');existed=true;}catch(e){if(e.status!==404)throw e;}
      const previous=existed?ownerOf(owners,post.slug):null;
      const owner=previous||{id:actorId(identity),login:user.login};
      if(owner.id)documents.at(-1).content=documents.at(-1).content.replace('\n---\n','\nauthor_id: '+JSON.stringify(owner.id)+'\n---\n');
      const source=await gh(`/repos/${env.REPOSITORY}/git/ref/heads/main`);
      const sha=await commitPortalFiles(gh,env.REPOSITORY,source.object.sha,documents,'Publish article: '+post.title);
      await gh(`/repos/${env.REPOSITORY}/git/refs/heads/main`,'PATCH',{sha,force:false});
      try{await writeOwner(identity,env,post.slug,owner,fetcher);}catch{return portalJson({slug:post.slug,sha,message:'文章已发布；作者权限记录暂未完成，可由管理员删除。'},201,origin);}
      return portalJson({slug:post.slug,sha},201,origin);
    }
    const deleteMatch=resource.match(/^\/api\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if(deleteMatch && request.method==='DELETE') {
      const slug=deleteMatch[1],id=actorId(identity),owners=role==='admin'?null:await readOwners(gh,env);
      if(role!=='admin'&&(!id||ownerOf(owners,slug)?.id!==id))throw new PortalError(403,'只能删除自己写的文章。');
      const file=await gh(`/repos/${env.REPOSITORY}/contents/content/posts/${slug}.md?ref=main`);
      if(role!=='admin'&&sourceActor(decodeGithub(file.content))!==id)throw new PortalError(403,'文章作者记录不一致，请联系管理员。');
      const resource=`/repos/${env.REPOSITORY}/contents/content/posts/${slug}.md`,body={message:'Delete article: '+slug,sha:file.sha,branch:'main'};
      if(role==='admin')await gh(resource,'DELETE',body);else await contentWriter(env,fetcher,resource,'DELETE',body);
      return portalJson({deleted:true},200,origin);
    }
    if(resource==='/api/assist' && request.method==='POST') {
      needAdmin(identity);
      if(!env.DEEPSEEK_API_KEY) throw new PortalError(503,'DeepSeek 尚未配置，请先添加 API Key。');
      const input=await readPortalBody(request);
      if(typeof input.prompt!=='string' || !input.prompt.trim() || input.prompt.length>6000) throw new PortalError(400,'请输入 6000 字以内的需求。');
      const response=await fetcher('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.DEEPSEEK_API_KEY},body:JSON.stringify({model:env.DEEPSEEK_MODEL || 'deepseek-flash',messages:[{role:'system',content:'你是 Lemoncat 的网站与写作助手。用中文给出清晰的设计、代码或写作建议。提供建议，不声称已替用户发布或修改网站。'},{role:'user',content:input.prompt}],max_tokens:1800,stream:false}),signal:AbortSignal.timeout(45000)});
      if(!response.ok) throw new PortalError(502,'DeepSeek 请求未完成，请检查密钥、余额或稍后重试。');
      const data=await response.json();
      return portalJson({text:data.choices?.[0]?.message?.content || '没有返回内容，请重试。'},200,origin);
    }
    throw new PortalError(404,'接口不存在。');
  } catch(error) { return portalJson({message:error instanceof PortalError ? error.message : '服务暂时不可用，请稍后重试。',...(error.check?{check:error.check}:{})},error instanceof PortalError ? error.status : 502,origin); }
}

// Article ownership is maintained by the server in a separate file.
// Submission PRs may not modify this file, so displayed names cannot grant delete rights.
const actorId=identity=>Number.isSafeInteger(identity.user.id)?'github:'+identity.user.id:null;
async function readOwners(gh,env){
  try{
    const file=await gh('/repos/'+env.REPOSITORY+'/contents/content/ownership.json?ref=main');
    const data=JSON.parse(decodeGithub(file.content));
    if(data.version!==1||!data.articles||Array.isArray(data.articles))throw new PortalError(503,'文章作者记录格式异常，请联系管理员。');
    for(const [slug,item]of Object.entries(data.articles))if(!postSlug(slug)||!/^github:\d+$/.test(item?.id||''))throw new PortalError(503,'文章作者记录格式异常，请联系管理员。');
    return data.articles;
  }catch(e){if(e.status===404)return {};throw e;}
}
function ownerOf(owners,slug){return Object.hasOwn(owners,slug)?owners[slug]:null;}
async function writeOwner(identity,env,slug,owner,fetcher){
  if(!owner.id)return;
  // Read a fresh main tip and commit author metadata + ownership together.
  // A concurrent change blocks the non-forced ref update instead of overwriting it.
  const parent=await identity.gh('/repos/'+env.REPOSITORY+'/git/ref/heads/main');
  const owners=await readOwners(identity.gh,env);
  const file=await identity.gh('/repos/'+env.REPOSITORY+'/contents/content/posts/'+slug+'.md?ref='+parent.object.sha);
  const source=decodeGithub(file.content);
  const front=/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if(!front)throw new PortalError(400,'文章元数据无效。');
  const meta=front[1].replace(/^author_id:.*(?:\r?\n|$)/gm,'');
  const stamped='---\n'+meta.trimEnd()+'\nauthor_id: '+JSON.stringify(owner.id)+'\n---\n'+source.slice(front[0].length);
  if(ownerOf(owners,slug)?.id===owner.id&&source===stamped)return;
  const updated={...owners,[slug]:{id:owner.id,login:owner.login}};
  const sha=await commitPortalFiles(identity.gh,env.REPOSITORY,parent.object.sha,[
    {path:'content/ownership.json',encoding:'utf-8',content:JSON.stringify({version:1,articles:updated},null,2)+'\n'},
    {path:'content/posts/'+slug+'.md',encoding:'utf-8',content:stamped}
  ],'Record article owner: '+slug);
  await identity.gh('/repos/'+env.REPOSITORY+'/git/refs/heads/main','PATCH',{sha,force:false});
}
function sourceActor(source){
  const front=/^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1]||'';
  try{const value=JSON.parse(front.match(/^author_id:\s*(.+)$/m)?.[1]||'null');return typeof value==='string'?value:null;}catch{return null;}
}
async function checkSubmissionOwner(identity,env,pr,content){
  const slug=content.path.split('/').pop().replace(/\.md$/,'');
  const owners=await readOwners(identity.gh,env),owner=ownerOf(owners,slug);
  let exists=false;
  try{await identity.gh('/repos/'+env.REPOSITORY+'/contents/'+content.path+'?ref=main');exists=true;}catch(e){if(e.status!==404)throw e;}
  const author=Number.isSafeInteger(pr.user?.id)?'github:'+pr.user.id:null;
  if(exists&&(!author||owner?.id!==author))throw new PortalError(403,'稿件试图覆盖别人的文章，请使用新的文章地址。');
  return {slug,id:author,login:pr.user.login};
}
async function contentWriter(env,fetcher,resource,method='GET',body){
  if(!env.GITHUB_CONTENT_TOKEN)throw new PortalError(503,'作者删除功能尚未配置，请联系 Lemoncat 添加内容服务授权。');
  const response=await fetcher('https://api.github.com'+resource,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.GITHUB_CONTENT_TOKEN,'User-Agent':'lemoncat-content','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=response.status===204?{}:await response.json();
  if(!response.ok)throw new PortalError(response.status===409?409:502,response.status===409?'文章已变化，请刷新后再删除。':'删除暂未完成，请检查内容服务授权。');
  return data;
}
async function submissionCheck(identity,env,pr){
  const runs=await identity.gh('/repos/'+env.REPOSITORY+'/actions/runs?head_sha='+pr.head.sha+'&event=pull_request&per_page=30');
  const run=(runs.workflow_runs||[]).filter(r=>r.head_sha===pr.head.sha&&r.path==='.github/workflows/pages.yml'&&r.event==='pull_request').sort((a,b)=>b.id-a.id)[0];
  const detailUrl='https://github.com/'+env.REPOSITORY+'/pull/'+pr.number+'/checks';
  if(!run)return {status:'queued',message:'自动检查尚未开始，请稍后刷新。',url:detailUrl};
  const url='https://github.com/'+env.REPOSITORY+'/actions/runs/'+run.id;
  if(run.conclusion==='action_required')return {status:'approval_required',message:'等待你在 GitHub 批准外部投稿运行检查。批准前不会开始，请打开检查详情，点击“Approve and run workflows”。',url};
  if(run.status!=='completed')return {status:'running',message:'自动检查正在排队或运行。最近检查约 10 秒，整次运行约半分钟，请稍后刷新。',url};
  if(run.conclusion!=='success')return {status:'failed',message:'自动检查失败，请打开检查详情查看原因；修改稿件后会重新检查。',url};
  const jobs=await identity.gh('/repos/'+env.REPOSITORY+'/actions/runs/'+run.id+'/jobs?filter=latest&per_page=100');
  if(!jobs.jobs?.some(j=>j.name==='build'&&j.conclusion==='success'))return {status:'failed',message:'本次运行没有通过网页构建检查。',url};
  return {status:'success',message:'自动检查已通过，可以审核发布。',url};
}

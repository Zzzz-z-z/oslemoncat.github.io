/* 逐步递进诊断 GitHub API 的写入能力，定位失败分界点。
   用法：
     1) 把令牌写入一个临时文件
     2) node scripts/diagnose-push.mjs --token-file <路径>

   每一步都打印状态码、server 头、x-github-request-id 与响应片段。
   分界点会直接告诉我们：是通道问题、体积问题，还是权限问题。
*/
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'https://api.github.com';
const OWNER = 'oslemoncat';
const REPO = 'oslemoncat.github.io';
const BRANCH = 'main';

const argIndex = process.argv.indexOf('--token-file');
const tokenPath = argIndex >= 0 ? process.argv[argIndex + 1] : null;
if (!tokenPath || !existsSync(tokenPath)) {
  console.error('用法：node scripts/diagnose-push.mjs --token-file <令牌文件路径>');
  process.exit(2);
}
const token = readFileSync(tokenPath, 'utf8').trim();
console.log(`令牌：${token.slice(0, 4)}****（长度 ${token.length}）`);
console.log(`目标：${OWNER}/${REPO} @ ${BRANCH}\n`);

let stepNo = 0;
async function step(label, method, path, body, { showBody = true } = {}) {
  stepNo += 1;
  const payload = body ? JSON.stringify(body) : null;
  const started = Date.now();
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'osc-diagnose',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload,
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    const server = response.headers.get('server') || '-';
    const reqId = response.headers.get('x-github-request-id') || '-';
    const ctype = response.headers.get('content-type') || '-';
    const ms = Date.now() - started;
    console.log(`[${String(stepNo).padStart(2)}] ${String(response.status).padEnd(4)} ${method.padEnd(6)} ${label}`);
    console.log(`      请求体 ${payload ? payload.length : 0}B · 响应 ${text.length}B · ${ms}ms`);
    console.log(`      server=${server}  request-id=${reqId}  type=${ctype}`);
    if (!response.ok && showBody) {
      console.log(`      响应：${text.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { ok: response.ok, status: response.status, text, json };
  } catch (error) {
    console.log(`[${String(stepNo).padStart(2)}] ERR  ${method.padEnd(6)} ${label}`);
    console.log(`      ${error.name}: ${error.message}`);
    return { ok: false, error };
  }
}

/* ---- 1 只读基线 ---- */
await step('GET /user', 'GET', '/user');
const refResult = await step('GET ref', 'GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const parentSha = refResult.json && refResult.json.object ? refResult.json.object.sha : null;
console.log(`      父提交：${parentSha ? parentSha.slice(0, 7) : '未知'}\n`);

/* ---- 2 单个 blob ---- */
const blob1 = await step('POST blob（小文本）', 'POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
  content: 'diagnose probe',
  encoding: 'utf-8',
});
const sha1 = blob1.json && blob1.json.sha ? blob1.json.sha : null;
console.log(`      blob sha：${sha1 ? sha1.slice(0, 7) : '无（这一步没成功）'}\n`);

if (!sha1) {
  console.log('结论：连单个 blob 都建不了，通道或权限有问题，先解决这一步。');
  process.exit(1);
}

/* ---- 3 单文件 tree ---- */
const tree1 = await step('POST tree（1 项）', 'POST', `/repos/${OWNER}/${REPO}/git/trees`, {
  tree: [{ path: '.osc-probe/a.txt', mode: '100644', type: 'blob', sha: sha1 }],
});
const tree1Sha = tree1.json && tree1.json.sha ? tree1.json.sha : null;
console.log(`      tree sha：${tree1Sha ? tree1Sha.slice(0, 7) : '无'}\n`);

/* ---- 4 递增体积的 tree，找分界点 ---- */
if (tree1Sha) {
  for (const count of [5, 15, 30, 47]) {
    const items = Array.from({ length: count }, (_, i) => ({
      path: `.osc-probe/bulk-${String(count)}/f${String(i).padStart(2, '0')}.txt`,
      mode: '100644',
      type: 'blob',
      sha: sha1,
    }));
    const result = await step(`POST tree（${count} 项）`, 'POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: items });
    if (!result.ok) {
      console.log(`\n结论：${count} 项时失败 —— 分界点在 ${count} 项以内，属于体积/网关限制。`);
      break;
    }
    if (count === 47) {
      console.log('\n结论：47 项也成功 —— 体积不是问题，之前失败可能是瞬时故障或与 base_tree 有关。');
      /* 清理：用父提交的 tree 建一个 no-op 提交并推回，抵消探测产生的影响？不需要——
         探测只创建了游离对象，不会改变分支指向，GitHub 会自行回收。 */
    }
  }
} else {
  console.log('结论：单文件 tree 都建不了（但 blob 可以）——这是最反常的情况，请把上面响应发我。');
}

console.log('\n（本次探测未修改任何分支，只创建了游离对象，不影响仓库内容。）');

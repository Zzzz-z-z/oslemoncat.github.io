/* 连接性探测：区分「通道能做什么」——只读 GET 能通不代表能写。
   用法：将 token 写入临时文件后执行
     node scripts/connectivity-probe.mjs --token-file <路径>

   输出每一项请求的方法、路径、状态码与响应摘要，用于判断：
     · api.github.com 是否可达
     · POST/PATCH 是否被中间层拦截（表现为 404/403/405）
     · 令牌权限是否足够
*/
import { readFileSync, existsSync } from 'node:fs';

const API = 'https://api.github.com';
const OWNER = 'oslemoncat';
const REPO = 'oslemoncat.github.io';

const index = process.argv.indexOf('--token-file');
const tokenPath = index >= 0 ? process.argv[index + 1] : null;
if (!tokenPath || !existsSync(tokenPath)) {
  console.error('用法：node scripts/connectivity-probe.mjs --token-file <令牌文件路径>');
  process.exit(2);
}
const token = readFileSync(tokenPath, 'utf8').trim();
console.log(`令牌：${token.slice(0, 4)}****（长度 ${token.length}）\n`);

async function probe(label, method, path, body) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'osc-probe',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const server = response.headers.get('server') || '-';
    const summary = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    console.log(`${String(response.status).padEnd(4)} ${method.padEnd(6)} ${label}`);
    console.log(`     server=${server}  ${Date.now() - started}ms  ${text.length}B`);
    if (!response.ok) console.log(`     ${summary.replace(/\s+/g, ' ')}`);
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    console.log(`ERR  ${method.padEnd(6)} ${label}  ${error.name}: ${error.message}`);
    return { ok: false, error };
  }
}

console.log('--- 只读请求 ---');
await probe('GET /user', 'GET', '/user');
const repo = await probe('GET /repos/:owner/:repo', 'GET', `/repos/${OWNER}/${REPO}`);
await probe('GET ref', 'GET', `/repos/${OWNER}/${REPO}/git/ref/heads/main`);

console.log('\n--- 写入请求（关键：判断 POST/PATCH 是否被拦）---');
const blob = await probe('POST git/blobs（单个小文件）', 'POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
  content: 'connectivity probe',
  encoding: 'utf-8',
});

let blobSha = null;
if (blob.ok) {
  try { blobSha = JSON.parse(blob.text).sha; } catch { /* 忽略 */ }
}

if (blobSha) {
  await probe('POST git/trees（单文件）', 'POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    tree: [{ path: '.probe-test.txt', mode: '100644', type: 'blob', sha: blobSha }],
  });

  await probe('POST git/trees（47 文件，复现失败场景）', 'POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    tree: Array.from({ length: 47 }, (_, i) => ({
      path: `.probe-bulk/f${String(i).padStart(2, '0')}.txt`,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    })),
  });
} else {
  console.log('  跳过 tree 测试：blob 创建未成功。');
}

console.log('\n--- 结论提示 ---');
console.log('  · GET 成功但 POST 全部 404/403/405 → 网络中间层拦截写操作，需换通道');
console.log('  · POST blobs 成功但 POST trees 404  → GitHub 侧问题，改用 base_tree 逐批构建');
console.log('  · 全部成功                        → 可以做完整上传');

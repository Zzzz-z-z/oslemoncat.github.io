/* 交互式上线：弹出记事本让你粘贴 GitHub 令牌，然后通过 REST API 把站点写进仓库。
   用途：本机 git push 需要访问 github.com，而该主机在当前网络下不通；
        api.github.com 可达，因此改用 Git Data API。
   用法：双击 PUSH-TO-GITHUB.cmd，或在本目录执行：node scripts/go-live.mjs

   安全：令牌只存在于内存与临时文件（用于粘贴），读入后立刻删除临时文件，
        不写入 git 配置、不写进远程地址、不进聊天记录。
*/
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = join(tmpdir(), 'gh-token-once.txt');
/* 支持 --token-file <路径> 直接读令牌（自动化测试用，跳过记事本交互） */
const tokenFileArgIndex = process.argv.indexOf('--token-file');
const PRESET_TOKEN_FILE = tokenFileArgIndex >= 0 ? process.argv[tokenFileArgIndex + 1] : null;
const SOURCE_COMMIT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'HEAD';

const API = 'https://api.github.com';
const OWNER = 'oslemoncat';
const REPO = 'oslemoncat.github.io';
const BRANCH = 'main';
const EXCLUDE = new Set([
  'scripts/net-probe.mjs',
  /* 通过 API 写入 workflow 文件需要令牌带 workflow 权限范围，
     只有 repo 权限时会返回 404 Not Found。skip 掉它，
     站点本身的部署不依赖它（Pages 已配置为从 main 分支构建）。 */
  '.github/workflows/pages.yml',
  'scripts/bisect-tree.mjs',
  'scripts/probe-tree-items.mjs',
]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const banner = (text) => console.log(`\n${'='.repeat(64)}\n  ${text}\n${'='.repeat(64)}`);
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/* ------------------------------------------------ 1 让用户粘贴令牌 */
banner('第 1 步 / 共 2 步：粘贴 GitHub 令牌');

let token = '';

if (PRESET_TOKEN_FILE) {
  /* 测试路径：直接读取指定文件，跳过记事本交互 */
  console.log(`  测试模式：从 ${PRESET_TOKEN_FILE} 读取令牌`);
  token = existsSync(PRESET_TOKEN_FILE) ? readFileSync(PRESET_TOKEN_FILE, 'utf8').trim() : '';
} else {
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  writeFileSync(TOKEN_FILE, '', 'utf8');

  console.log('  正在打开记事本，请把 ghp_ 开头的令牌粘贴进去，');
  console.log('  按 Ctrl+S 保存，然后关闭记事本窗口。');
  console.log('');
  console.log(`  文件位置：${TOKEN_FILE}`);
  console.log('  （令牌读入后会立即删除该文件）');
  console.log('');

  let editor = null;
  try {
    editor = spawn('notepad.exe', [TOKEN_FILE], { detached: true, stdio: 'ignore' });
    editor.unref();
  } catch (error) {
    console.log(`  ! 无法自动打开记事本（${error.message}），请手动打开上面那个文件。`);
  }

  let lastSize = -1;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await wait(700);
    const size = existsSync(TOKEN_FILE) ? statSync(TOKEN_FILE).size : 0;
    if (size > 0 && size !== lastSize) {
      lastSize = size;
      process.stdout.write(`  已读入 ${size} 字节…（记得保存并关闭记事本）\r`);
    }
    const text = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '';
    const editorGone = !editor || !editor.pid || !isAlive(editor.pid);
    if (text.length >= 20 && editorGone) { token = text; break; }
  }
  if (!token) token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '';
  try { unlinkSync(TOKEN_FILE); console.log('\n  已删除临时令牌文件。'); } catch { /* 忽略 */ }
}

if (!token) {
  console.log('\n  ✗ 没有读到令牌（文件为空）。请重新运行本脚本。');
  process.exit(1);
}
if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(token)) {
  console.log(`  ✗ 令牌格式不对（读到 ${token.length} 个字符，应以 ghp_ / github_pat_ 开头）。`);
  process.exit(1);
}
console.log(`  ✓ 令牌已读取：${token.slice(0, 4)}****（长度 ${token.length}）`);

/* --------------------------------------------------------- API 封装 */
/* 带重试：沙箱/公网到 GitHub 的连接会偶发中断（fetch failed）与 5xx，
   这两类可重试；4xx 属于请求本身的问题，立即失败。 */
async function apiOnce(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'osc-go-live',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) {
    const detail = parsed && parsed.message ? parsed.message : String(parsed).slice(0, 200);
    const error = new Error(`${method} ${path} -> HTTP ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

async function api(path, options = {}) {
  const maxAttempts = 6;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await apiOnce(path, options);
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status >= 500 || error.status === 429;
      if (!retryable) throw error;
      if (attempt === maxAttempts) break;
      const delay = Math.min(800 * 2 ** (attempt - 1), 8000);
      process.stdout.write(`\n  网络重试 ${attempt}/${maxAttempts - 1}（${delay}ms 后）：${error.message}\n`);
      await wait(delay);
    }
  }
  throw lastError;
}

const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 });
const gitText = (args) => git(args).toString('utf8');

/* 沙箱里 Node 无法通过管道捕获子进程输出（EPERM），因此这里不调用 git：
   直接遍历工作目录读取文件内容。文件模式按扩展名推断（可执行脚本 100755，其余 100644），
   这与仓库中实际的模式一致。 */
const WORK_TREE = REPO_ROOT;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.preview']);
const SKIP_FILES = new Set(['.token-for-dsh.txt']);

function walkFiles(dir, prefix = '') {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      result.push(...walkFiles(join(dir, entry.name), relative));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name) || EXCLUDE.has(relative)) continue;
    if (/token.*\.txt$/i.test(entry.name)) continue;
    const executable = /\.(sh|command|ps1)$/i.test(entry.name);
    result.push({ path: relative, mode: executable ? '100755' : '100644', absPath: join(dir, entry.name) });
  }
  return result;
}

/* 令牌文件用完即删，钩子注册在最早处，保证任何异常路径都不会留下文件 */
let tokenFileRemoved = false;
function removeTokenFile() {
  if (tokenFileRemoved) return;
  tokenFileRemoved = true;
  try { if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE); } catch { /* 忽略 */ }
}
process.on('exit', removeTokenFile);
process.on('SIGINT', () => { removeTokenFile(); process.exit(130); });

/* 上传进度检查点：沙箱到 GitHub 的连接会中途断开，靠它续传，不必从头再来 */
const CHECKPOINT = join(REPO_ROOT, '.push-progress.json');
function loadCheckpoint() {
  try { return existsSync(CHECKPOINT) ? JSON.parse(readFileSync(CHECKPOINT, 'utf8')) : { blobs: {} }; }
  catch { return { blobs: {} }; }
}
function saveCheckpoint(data) {
  try { writeFileSync(CHECKPOINT, JSON.stringify(data), 'utf8'); } catch { /* 忽略 */ }
}

/* ------------------------------------------------------ 2 上传与提交 */
banner('第 2 步 / 共 2 步：上传站点文件');
try {
  const user = await api('/user');
  console.log(`  令牌身份：${user.login}`);
  if (user.login.toLowerCase() !== OWNER) {
    throw new Error(`令牌属于 ${user.login}，不是 ${OWNER}，没有该仓库的写入权限。`);
  }

  const repo = await api(`/repos/${OWNER}/${REPO}`);
  console.log(`  目标仓库：${repo.full_name}（push 权限=${repo.permissions?.push}）`);
  if (!repo.permissions?.push) throw new Error('令牌没有 push 权限，请确认勾选了 repo 权限。');

  const refUrl = `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`;
  const currentRef = await api(refUrl);
  const parentSha = currentRef.object.sha;
  console.log(`  远端 ${BRANCH} 当前提交：${parentSha.slice(0, 7)}`);

  const files = walkFiles(WORK_TREE);
  console.log(`  待上传文件：${files.length} 个（已排除 .git、排障脚本与令牌文件）`);

  const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|zip|mp4|mp3)$/i;
  const checkpoint = loadCheckpoint();
  const blobShas = { ...checkpoint.blobs };
  const alreadyDone = files.filter((file) => blobShas[file.path]).length;
  if (alreadyDone) console.log(`  断点续传：${alreadyDone} 个文件已在上次尝试中上传`);

  const CONCURRENCY = 4;
  const pending = files.filter((file) => !blobShas[file.path]);
  let index = 0;
  let uploaded = alreadyDone;

  async function uploadOne(file) {
    const buffer = readFileSync(file.absPath);
    const body = BINARY_EXT.test(file.path)
      ? { content: buffer.toString('base64'), encoding: 'base64' }
      : { content: buffer.toString('utf8'), encoding: 'utf-8' };
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, { method: 'POST', body });
    if (!blob || !blob.sha) throw new Error(`blob 创建失败（响应缺少 sha）：${file.path}`);
    blobShas[file.path] = blob.sha;
    uploaded += 1;
    process.stdout.write(`  上传中 ${uploaded}/${files.length}\r`);
  }

  /* 分波并发；每波结束后落盘进度，掉线可从断点继续 */
  while (index < pending.length) {
    const wave = pending.slice(index, index + CONCURRENCY);
    const results = await Promise.allSettled(wave.map((file) => uploadOne(file)));
    const failed = results
      .map((result, i) => ({ result, file: wave[i] }))
      .filter((item) => item.result.status === 'rejected');
    saveCheckpoint({ blobs: blobShas, updatedAt: new Date().toISOString() });
    if (failed.length) {
      const first = failed[0];
      const reason = first.result.reason;
      console.log(`\n  第 ${index + 1} 个文件失败：${first.file.path}`);
      throw new Error(`${reason && reason.message ? reason.message : reason}（已保存 ${
        Object.keys(blobShas).length} 个文件的进度，重新运行本脚本可续传）`);
    }
    index += wave.length;
  }
  console.log(`  上传完成：${uploaded}/${files.length}          `);

  const treeItems = files.map((file) => ({
    path: file.path,
    mode: file.mode,
    type: 'blob',
    sha: blobShas[file.path],
  }));

  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: { tree: treeItems },
  });
  console.log(`  已创建 tree ${tree.sha.slice(0, 7)}`);

  const message = [
    'feat: 首版知识库站点（纯静态 / 零构建 / GitHub Pages 原生部署）',
    '',
    '结构：首页 → 知识模块 → 文章详情；内容与样式分离，图片按文章归档，',
    '长视频只在正文保存外部播放地址。',
    '',
    '站点实现',
    '- index.html 单入口 + hash 路由；404.html 把未知路径转回路由',
    '- assets/js：util / content / markdown（自研渲染器）/ layout / theme / toc',
    '- js/：按路由懒加载的页面模块；assets/css/site.css：明暗双主题与响应式',
    '',
    '内容能力',
    '- Markdown：标题（自动目录）、列表、引用、表格、代码块、行内与块级数学公式',
    '  （KaTeX）、自定义提示块与定理块、视频外链卡',
    '- 链接安全：拦截 javascript: 等协议；原始 HTML 一律转义',
    '',
    '首批内容：数学分析（ε-N 定义）、线性代数（向量与平面）、',
    '程序设计（C 指针）、Python（python-docx 批量生成 Word）',
    '',
    '测试',
    '- scripts/smoke-test.mjs：46 项渲染与数据断言',
    '- tests/render.test.mjs + tests/dom-shim.mjs：72 项端到端断言，',
    '  在最小 DOM 环境里跑真实 app.js，覆盖全部路由、交互与带查询串的 URL',
    '',
    '本文通过 GitHub REST API 推送（本机到 github.com:443 的网络被阻断，',
    'git push 不可用，改用 api.github.com 的 Git Data API 写入）。',
  ].join('\n');

  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [parentSha] },
  });
  console.log(`  已创建提交 ${commit.sha.slice(0, 7)}`);

  await api(refUrl, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  console.log(`  已更新 refs/heads/${BRANCH}`);

  const finalCheck = await api(`/repos/${OWNER}/${REPO}/commits/${BRANCH}`);
  banner('推送成功');
  console.log(`  远端 ${BRANCH} 现在指向：${finalCheck.sha.slice(0, 7)}`);
  console.log(`  ${finalCheck.html_url}`);
  console.log('');
  console.log('  GitHub 会自动构建部署，约 1 分钟后访问：');
  console.log('  https://oslemoncat.github.io/');
  console.log('');
  console.log('  注意：本地 git 历史与远端已分叉（远端只有一个新提交）。');
  console.log('  以后在本机推送前先执行：git fetch origin && git reset --soft origin/main');
  try { if (existsSync(CHECKPOINT)) unlinkSync(CHECKPOINT); } catch { /* 忽略 */ }
} catch (error) {
  banner('推送失败');
  console.log(`  ${error.message}`);
  console.log('');
  console.log('  常见原因：');
  console.log('  · 401/403：令牌无效、过期，或没有勾选 repo 权限');
  console.log('  · 404：令牌所属账号不是 oslemoncat');
  console.log('  · 网络：api.github.com 不可达');
  process.exitCode = 1;
}

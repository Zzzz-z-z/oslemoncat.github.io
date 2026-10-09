/* 端到端渲染测试：在最小 DOM 环境里跑真实的 app.js + 页面模块，
   逐个路由断言渲染结果。这是补上「路由一条都没测」这个漏洞的测试。
   用法：
     python -m http.server 8000        # 另开一个终端
     node tests/render.test.mjs        # 或 node tests/render.test.mjs 8000
*/
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './dom-shim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.argv[2] || '8000';

/* --------------------------------------------------------------- 断言工具 */
let passed = 0;
const failures = [];
const consoleErrors = [];

function check(label, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

const realError = console.error;
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); realError(...args); };

/* ---------------------------------------------------------- 建立 DOM 环境 */
const env = installDom({ repoRoot: ROOT, port: PORT });
env.loadSkeleton();
const { document, window: win, goto } = env;

/* 先 import 纯函数做单元测试（此时已装好 DOM，import 副作用安全） */
const app = await import('../app.js');
const { parseHash, matchRoute, startApp } = app;
const { detectBase, resolveUrl } = await import('../assets/js/util.js');

/* --------------------------------------------------------- 1. 路由单元测试 */
console.log('\n[1] hash 解析与路由匹配');
const hashCases = [
  ['#/', '/', 'home'],
  ['', '/', 'home'],
  ['#', '/', 'home'],
  ['#/about', '/about', 'about'],
  ['#/modules', '/modules', 'modules'],
  ['#/module/math-analysis', '/module/math-analysis', 'module'],
  ['#/article/apostol-sequence-limit', '/article/apostol-sequence-limit', 'article'],
  ['#/articles', '/articles', 'articles'],
  ['#/articles?module=python&q=docx', '/articles', 'articles'],
  ['#/about/', '/about', 'about'],
  ['#/does-not-exist', '/does-not-exist', null],
];
for (const [hash, expectedPath, expectedPage] of hashCases) {
  const { path, params } = parseHash(hash);
  const matched = matchRoute(path);
  const page = matched ? matched.page : null;
  check(`parseHash("${hash}") -> ${path}`, path === expectedPath, `得到 ${path}`);
  check(`matchRoute("${path}") -> ${page || 'notfound'}`, page === expectedPage, `期望 ${expectedPage || 'notfound'}`);
  if (hash.includes('module=python')) {
    check('查询参数解析', params.get('module') === 'python' && params.get('q') === 'docx');
  }
}
check('matchRoute 提取 slug 参数', matchRoute('/article/abc-123').arg === 'abc-123');

/* ------------------------------------------------------ 2. 逐个路由渲染 */
console.log('\n[2] 路由渲染（真实 app.js 启动路径）');
const content = () => document.getElementById('content');
const text = () => content().textContent.replace(/\s+/g, ' ');

let route = await startApp({ document, window: win });
check('首页渲染有内容', content().innerHTML.length > 500, `${content().innerHTML.length} 字符`);
check('首页未报错', !/渲染出错|加载失败|页面不存在/.test(text()), text().slice(0, 120));
check('首页出现站点标题', text().includes(JSON.parse(readFileSync(join(ROOT, 'content', 'site.json'), 'utf8')).title), text().slice(0, 80));
check('首页出现知识模块区块', text().includes('知识模块'));
check('首页出现最近更新', text().includes('最近更新'));
check('首页模块卡片可点击', content().querySelectorAll('a[href^="#/module/"]').length >= 4,
  `${content().querySelectorAll('a[href^="#/module/"]').length} 个`);
check('页头已挂载', Boolean(document.querySelector('.site-header') || document.getElementById('site-header')));
check('页脚已挂载', document.querySelectorAll('.site-footer').length > 0);

goto('#/modules');
await new Promise((r) => setTimeout(r, 500));
check('模块总览页无错误提示', !/渲染出错|加载失败/.test(text()), text().slice(0, 120));
check('模块总览页列出全部模块', text().includes('数学分析') && text().includes('线性代数') && text().includes('程序设计'));

goto('#/module/python');
await new Promise((r) => setTimeout(r, 500));
check('模块页无错误提示', !/渲染出错|加载失败/.test(text()), text().slice(0, 120));
check('模块页显示模块标题', text().includes('Python'));
check('模块页列出该模块文章', text().includes('python-docx'));

goto('#/articles');
await new Promise((r) => setTimeout(r, 500));
check('文章列表页无错误提示', !/渲染出错|加载失败/.test(text()), text().slice(0, 120));
check('文章列表页出现筛选条', content().querySelectorAll('.filter-chip').length >= 5,
  `${content().querySelectorAll('.filter-chip').length} 个`);
check('文章列表页列出文章', content().querySelectorAll('a[href^="#/article/"]').length >= 4,
  `${content().querySelectorAll('a[href^="#/article/"]').length} 篇`);

goto('#/articles?q=极限');
await new Promise((r) => setTimeout(r, 500));
check('搜索框回填关键字', (content().querySelector('.search-input') || {}).value === '极限');
check('搜索结果已过滤', text().includes('数列极限') && !text().includes('python-docx'), text().slice(0, 200));

goto('#/article/apostol-sequence-limit');
await new Promise((r) => setTimeout(r, 600));
check('文章页无错误提示', !/渲染出错|加载失败/.test(text()), text().slice(0, 200));
check('文章页显示标题', text().includes('数列极限的 ε-N 定义'));
check('文章页渲染正文', content().querySelectorAll('.prose p').length >= 8,
  `${content().querySelectorAll('.prose p').length} 段`);
check('文章页有侧边目录', content().querySelectorAll('.toc a').length >= 3,
  `${content().querySelectorAll('.toc a').length} 条`);
check('文章页有定理块', content().querySelectorAll('.theorem').length >= 3,
  `${content().querySelectorAll('.theorem').length} 个`);
check('文章页有提示块', content().querySelectorAll('.callout').length >= 2);
check('文章页有公式占位', content().querySelectorAll('.math-inline').length >= 10
  && content().querySelectorAll('.math-display').length >= 3,
  `inline=${content().querySelectorAll('.math-inline').length} display=${content().querySelectorAll('.math-display').length}`);
check('文章页有视频外链卡', content().querySelectorAll('.video-card').length >= 1);
check('文章页有面包屑', content().querySelectorAll('.crumbs a').length >= 3);
// 这篇是所在模块的唯一一篇文章，因此不该出现上下篇
check('单篇模块不显示上下篇', content().querySelectorAll('.pager').length === 0,
  `pager=${content().querySelectorAll('.pager').length}`);
check('document.title 已更新', document.title.includes('数列极限'), document.title);

goto('#/article/linear-algebra-vectors-and-planes');
await new Promise((r) => setTimeout(r, 600));
check('带配图文章渲染正常', !/渲染出错/.test(text()) && content().querySelectorAll('.prose img').length >= 1,
  `${content().querySelectorAll('.prose img').length} 张图`);

goto('#/about');
await new Promise((r) => setTimeout(r, 500));
check('关于页无错误提示', !/渲染出错|加载失败/.test(text()), text().slice(0, 120));
check('关于页含目录结构说明', text().includes('content/') && text().includes('assets/'));

goto('#/does-not-exist');
await new Promise((r) => setTimeout(r, 400));
check('未知路由显示页面不存在', text().includes('页面不存在'), text().slice(0, 120));
check('未知路由不再谎报渲染出错', !text().includes('渲染出错'));

goto('#/article/no-such-article');
await new Promise((r) => setTimeout(r, 400));
check('缺失文章显示明确提示', text().includes('没有找到文章'), text().slice(0, 120));

/* ---------------------------------------------------------- 3. 交互行为 */
console.log('\n[3] 交互');
goto('#/');
await new Promise((r) => setTimeout(r, 400));

const themeBtn = document.getElementById('theme-toggle');
check('主题按钮存在', Boolean(themeBtn));
const beforeTheme = document.documentElement.getAttribute('data-theme');
themeBtn.dispatchEvent({ type: 'click', preventDefault() {} });
const afterTheme = document.documentElement.getAttribute('data-theme');
check('点击切换主题', beforeTheme !== afterTheme, `${beforeTheme} -> ${afterTheme}`);
check('主题写入 localStorage', window.localStorage.getItem('osc-theme') === afterTheme);

const navToggle = document.getElementById('nav-toggle');
const navEl = document.querySelector('.site-nav');
check('移动端导航按钮存在', Boolean(navToggle) && Boolean(navEl));
navToggle.dispatchEvent({ type: 'click', preventDefault() {} });
check('点击展开导航', navEl.classList.contains('is-open'), `class="${navEl.getAttribute('class')}"`);
navToggle.dispatchEvent({ type: 'click', preventDefault() {} });
check('再次点击收起导航', !navEl.classList.contains('is-open'));

/* --------------------------------------------- 4. 带查询串的 URL（回归） */
/* 事故背景：用 http://host/index.html?v=123#/ 打开时，document.baseURI 带着 ?v=123，
   相对路径 fetch('content/site.json') 被解析成 '/content/site.json?v=123'，
   静态服务器返回 404 页面（HTML），于是报 "Unexpected token '<'" 整个站点白屏。
   修复方式：base 只从 location.pathname 推导。这组测试锁死该行为。 */
console.log('\n[4] 带查询串的 URL');
{
  const queryEnv = installDom({ repoRoot: ROOT, port: PORT });
  queryEnv.loadSkeleton();
  queryEnv.location.pathname = '/index.html';
  queryEnv.location.search = '?v=20261008161217';
  queryEnv.document.baseURI = `${queryEnv.ORIGIN}index.html?v=20261008161217`;

  const base = detectBase();
  check('detectBase 丢掉查询串', base === '/', `得到 "${base}"`);
  check('resolveUrl 拼接不带查询串',
    resolveUrl('content/site.json') === '/content/site.json',
    `得到 "${resolveUrl('content/site.json')}"`);

  const textUtil = readFileSync(join(ROOT, 'assets', 'js', 'util.js'), 'utf8');
  check('base 不再取自 document.baseURI',
    !/document\.baseURI/.test(textUtil.split('export function resolveUrl')[0]),
    'detectBase 里仍引用了 document.baseURI');

  const queryApp = await import(`../app.js?query-case=${Date.now()}`);
  await queryApp.startApp({ document: queryEnv.document, window: queryEnv.window });
  const box = queryEnv.document.getElementById('content');
  const body = box.textContent.replace(/\s+/g, ' ');
  check('带 ?v= 打开时首页仍能渲染', body.includes('知识模块') && body.includes('最近更新'), body.slice(0, 120));
  check('带 ?v= 打开时不报 JSON 解析错误', !/Unexpected token|is not valid JSON|渲染出错/.test(body), body.slice(0, 160));
  check('带 ?v= 打开时文章数量正确', /4 篇文章/.test(body), body.slice(0, 60));
}

/* ------------------------------------------------------------- 5. 汇总 */
console.log('\n[5] 控制台错误');
const appErrors = consoleErrors.filter((line) => line.includes('[app]') || line.includes('[article]'));
if (appErrors.length) {
  appErrors.slice(0, 8).forEach((line) => console.log(`  ! ${line.slice(0, 240)}`));
}
check('运行期间没有 app/article 层错误', appErrors.length === 0, `${appErrors.length} 条`);

console.log(`\n断言 ${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  console.log('\n失败清单：');
  failures.forEach((item) => console.log(`  - ${item}`));
  process.exit(1);
}
console.log('✅ 全部通过');

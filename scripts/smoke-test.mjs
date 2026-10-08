/* 渲染冒烟测试：在 Node 里跑通 Markdown 渲染器与内容数据，作为无浏览器环境下的验证手段。
   用法：node scripts/smoke-test.mjs */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/* ---------------------------------------------------------- 1. JSON 合法性 */
console.log('\n[1] JSON 合法性');
for (const file of walk(ROOT).filter((f) => f.endsWith('.json') && !f.includes('node_modules'))) {
  const rel = relative(ROOT, file);
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    console.log(`  ok   ${rel}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${rel} — ${error.message}`);
  }
}

/* ------------------------------------------------- 2. 索引与文件一一对应 */
console.log('\n[2] 文章索引与文件对应');
const articleDir = join(ROOT, 'content', 'articles');
let slugs = [];
const generated = join(ROOT, 'content', 'generated', 'articles-index.json');
const manual = join(ROOT, 'content', 'articles.json');
if (existsSync(generated)) {
  const data = JSON.parse(readFileSync(generated, 'utf8'));
  slugs = Array.isArray(data) ? data : data.articles || [];
  console.log('  info 使用 content/generated/articles-index.json');
} else {
  const data = JSON.parse(readFileSync(manual, 'utf8'));
  slugs = Array.isArray(data) ? data : data.articles || [];
  console.log('  info 使用 content/articles.json');
}
check('索引非空', slugs.length > 0, `got ${slugs.length}`);

const modules = JSON.parse(readFileSync(join(ROOT, 'content', 'modules.json'), 'utf8'));
const moduleSlugs = new Set(modules.map((m) => m.slug));

for (const slug of slugs) {
  const md = join(articleDir, `${slug}.md`);
  const meta = join(articleDir, `${slug}.json`);
  check(`${slug}: 正文存在`, existsSync(md));
  check(`${slug}: 元数据存在`, existsSync(meta));
  if (!existsSync(meta)) continue;
  const data = JSON.parse(readFileSync(meta, 'utf8'));
  check(`${slug}: title 非空`, Boolean(data.title));
  check(`${slug}: module 已登记 (${data.module})`, moduleSlugs.has(data.module));
  check(`${slug}: date 格式`, !data.date || /^\d{4}-\d{2}-\d{2}$/.test(data.date), data.date);
  if (data.cover) {
    check(`${slug}: 封面文件存在`, existsSync(join(ROOT, data.cover)), data.cover);
  }
}

/* ----------------------------------------------------- 3. Markdown 渲染 */
console.log('\n[3] Markdown 渲染');
const { renderMarkdown } = await import('../assets/js/markdown.js');

const sample = [
  '# 标题',
  '',
  '正文里有行内公式 $a_n \\to L$ 与代码 `int *p`。',
  '',
  '$$',
  '\\left|a_n - L\\right| < \\eps',
  '$$',
  '',
  '## 小节',
  '',
  '- 列表项一',
  '- 列表项二',
  '  - 嵌套项',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '> 引用内容',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```c',
  'int *p = &a;',
  '```',
  '',
  '::: tip 提示标题',
  '提示正文。',
  ':::',
  '',
  '::: theorem 定理 1',
  '内容 $x^2$。',
  ':::',
  '',
  '::: video 示例视频',
  'url: https://example.com/v',
  'source: 示例平台',
  ':::',
  '',
  '---',
  '',
  '结束。',
].join('\n');

const single = renderMarkdown(sample);
const html = single.html;

check('渲染无异常', typeof html === 'string' && html.length > 100);
check('h1 降级为 h2', html.includes('<h2'));
check('未生成 h1', !html.includes('<h1'));
check('标题带 id 锚点', /<h2 id="[^"]+"/.test(html));
check('行内公式占位', html.includes('math-inline'));
check('块级公式占位', html.includes('math-display'));
check('公式内容被转义保存', html.includes('data-tex="\\left|a_n - L\\right|'));
check('自定义宏 \\eps 保留给 KaTeX', html.includes('\\eps'));
check('行内代码', html.includes('<code>int *p</code>'));
check('无序列表', html.includes('<ul>'));
check('嵌套列表', (html.match(/<ul>/g) || []).length >= 2);
check('有序列表带数字', html.includes('<ol>'));
check('引用块', html.includes('<blockquote>'));
check('表格', html.includes('<table>') && html.includes('<th>A</th>') && html.includes('<td>2</td>'));
check('代码块保留内容', html.includes('int *p = &amp;a;'));
check('提示块', html.includes('callout--tip') && html.includes('提示标题'));
check('定理块', html.includes('theorem--theorem'));
check('视频卡', html.includes('video-card') && html.includes('example.com/v'));
check('分隔线', html.includes('<hr>'));
check('目录条目已收集', single.headings.length >= 2, `headings=${single.headings.length}`);

// 危险输入
const evil = renderMarkdown('[点我](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');
check('javascript: 链接被拦截', !evil.html.includes('javascript:'));
check('原始 HTML 被转义', !evil.html.includes('<img src=x'));

// 重复标题的 id 去重
const dup = renderMarkdown('## 同名\n\n## 同名\n');
check('重复标题 id 去重', dup.headings[0].id !== dup.headings[1].id,
  `${dup.headings[0].id} vs ${dup.headings[1].id}`);

/* ------------------------------------------- 4. 每篇真实正文都能渲染 */
console.log('\n[4] 真实文章渲染');
for (const slug of slugs) {
  const mdPath = join(articleDir, `${slug}.md`);
  if (!existsSync(mdPath)) continue;
  const source = readFileSync(mdPath, 'utf8');
  const result = renderMarkdown(source);
  check(`${slug}: 渲染成功`, result.html.length > 200, `${result.html.length} 字符`);
  check(`${slug}: 有目录条目`, result.headings.length > 0, `${result.headings.length} 条`);
  // 未闭合的 ::: 会让正文里残留字面量
  check(`${slug}: 无残留 ::: 标记`, !result.html.includes(':::'));
  check(`${slug}: 无未替换的加粗标记`, !result.html.includes('**'));
}

/* ----------------------------------------------- 5. 引用文件是否齐全 */
console.log('\n[5] 正文引用的本地资源');
for (const slug of slugs) {
  const mdPath = join(articleDir, `${slug}.md`);
  if (!existsSync(mdPath)) continue;
  const source = readFileSync(mdPath, 'utf8');
  const refs = [...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^https?:/i.test(ref)) continue;
    check(`${slug}: ${ref}`, existsSync(join(ROOT, ref)));
  }
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);

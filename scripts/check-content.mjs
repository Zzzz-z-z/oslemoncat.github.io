/* 内容连通性自检：完整走一遍「索引 → 每篇文章元数据 → 正文 → 封面/配图」
   的加载链路，相当于把浏览器要发的请求在 Node 里跑一遍。
   用法：node scripts/check-content.mjs [端口]（默认 8000） */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.argv[2] || '8000';
const BASE = `http://127.0.0.1:${PORT}/`;

let failures = 0;
async function fetchCheck(label, path, { expectText } = {}) {
  const url = new URL(path, BASE).href;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    const ok = expectText ? body.includes(expectText) : body.length > 0;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} ${response.status}  ${body.length} B`);
    if (!ok) failures += 1;
    return body;
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label.padEnd(46)} ${error.message}`);
    return null;
  }
}

console.log(`\n对 http://127.0.0.1:${PORT}/ 做内容连通性自检\n`);

console.log('[页面骨架]');
await fetchCheck('index.html', 'index.html', { expectText: '<main id="content">' });
await fetchCheck('app.js', 'app.js', { expectText: 'ROUTES' });
await fetchCheck('assets/css/site.css', 'assets/css/site.css', { expectText: '--accent' });

console.log('\n[渲染引擎]');
for (const mod of ['util', 'content', 'markdown', 'layout', 'theme', 'toc']) {
  await fetchCheck(`assets/js/${mod}.js`, `assets/js/${mod}.js`);
}
for (const page of ['home', 'modules', 'module', 'articles', 'article', 'about']) {
  await fetchCheck(`js/${page}.js`, `js/${page}.js`);
}

console.log('\n[内容数据]');
const siteJson = await fetchCheck('content/site.json', 'content/site.json', { expectText: '知识库' });
await fetchCheck('content/modules.json', 'content/modules.json', { expectText: '数学分析' });
const indexRaw = await fetchCheck('content/articles.json', 'content/articles.json', { expectText: 'articles' });

const slugs = indexRaw ? JSON.parse(indexRaw).articles : [];

console.log('\n[每篇文章：元数据 + 正文 + 封面 + 正文内图片]');
for (const slug of slugs) {
  const metaRaw = await fetchCheck(`${slug} 元数据`, `content/articles/${slug}.json`, { expectText: slug });
  await fetchCheck(`${slug} 正文`, `content/articles/${slug}.md`);
  if (!metaRaw) continue;
  const meta = JSON.parse(metaRaw);
  if (meta.cover) await fetchCheck(`${slug} 封面`, meta.cover, { expectText: '<svg' });

  // 正文里引用的本地图片
  const md = readFileSync(join(ROOT, 'content', 'articles', `${slug}.md`), 'utf8');
  const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]).filter((r) => !/^https?:/i.test(r));
  for (const ref of refs) {
    if (!existsSync(join(ROOT, ref))) {
      failures += 1;
      console.log(`  FAIL ${slug} 正文图片缺失: ${ref}`);
      continue;
    }
    await fetchCheck(`${slug} 正文图片`, ref, { expectText: '<svg' });
  }
}

console.log(`\n${failures === 0 ? '✅ 全部请求成功，站点内容链路完整' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);

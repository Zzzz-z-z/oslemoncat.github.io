import { mkdir, writeFile, cp, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { readJson, readPosts } from './cms-content.mjs';

const ignoredLegacy = new Set(['articles', 'posts', 'generated', 'articles.json']);
// A fresh output directory prevents deleted/unpublished posts remaining online.
// No recursive delete is needed: each build uses a new directory.
export async function buildSite(root, out) {
  try { await lstat(out); throw new Error(`输出目录已存在：${out}；请选择一个新的空目录。`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { modules, posts } = await readPosts(root);
  const published = posts.filter(post => post.meta.draft !== true);
  await mkdir(path.join(out, 'content/articles'), { recursive: true });
  for (const name of ['index.html', '404.html', 'app.js', '.nojekyll', 'assets', 'js', 'admin']) {
    await cp(path.join(root, name), path.join(out, name), { recursive: true });
  }
  // Keep existing content-layer side files; author sources and legacy indexes are excluded.
  const { readdir, readFile } = await import('node:fs/promises');
  for (const name of await readdir(path.join(root, 'content'))) {
    if (!ignoredLegacy.has(name)) await cp(path.join(root, 'content', name), path.join(out, 'content', name), { recursive: true });
  }
  for (const { slug, meta, body } of published) {
    const { slug: ignored, ...frontendMeta } = meta;
    await writeFile(path.join(out, 'content/articles', `${slug}.json`), JSON.stringify(frontendMeta, null, 2) + '\n');
    await writeFile(path.join(out, 'content/articles', `${slug}.md`), body);
  }
  const index = JSON.stringify({ articles: published.map(x => x.slug) }, null, 2) + '\n';
  await writeFile(path.join(out, 'content/articles.json'), index);
  await mkdir(path.join(out, 'content/generated'), { recursive: true });
  await writeFile(path.join(out, 'content/generated/articles-index.json'), index);
  const config = YAML.parse(await readFile(path.join(root, 'admin/config.yml'), 'utf8'));
  config.collections.find(x => x.name === 'posts').fields.find(x => x.name === 'module').options = modules.map(x => ({ label: x.title, value: x.slug }));
  await writeFile(path.join(out, 'admin/config.yml'), YAML.stringify(config));
  const site = await readJson(path.join(out, 'content/site.json'));
  if (!site.nav.some(item => item.href === 'admin/' || item.href === '/admin/')) {
    site.nav.push({ label: '文章管理', href: 'admin/' });
    await writeFile(path.join(out, 'content/site.json'), JSON.stringify(site, null, 2) + '\n');
  }
  return { total: posts.length, published: published.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.join(root, 'dist');
  const result = await buildSite(root, out);
  console.log(`构建完成：${result.published}/${result.total} 篇文章发布到 dist/。`);
}

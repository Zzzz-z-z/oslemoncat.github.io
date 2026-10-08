import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { readJson, validSlug } from './cms-content.mjs';

// Copies old split files into single CMS sources; never changes the old files.
export async function migrate(root) {
  const source = path.join(root, 'content/articles');
  const destination = path.join(root, 'content/posts');
  await mkdir(destination, { recursive: true });
  let count = 0;
  for (const file of (await readdir(source)).filter(x => x.endsWith('.json')).sort()) {
    const slug = path.basename(file, '.json');
    if (!validSlug(slug)) throw new Error(`不支持的文章文件名：${file}`);
    const target = path.join(destination, `${slug}.md`);
    try { await access(target); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const meta = await readJson(path.join(source, file));
    const body = await readFile(path.join(source, `${slug}.md`), 'utf8');
    const data = { ...meta, slug, updated: meta.updated || meta.date, tags: meta.tags || [], draft: meta.draft === true };
    await writeFile(target, `---\n${YAML.stringify(data)}---\n${body}`, { encoding: 'utf8', flag: 'wx' });
    count += 1;
  }
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(`迁移完成：新建 ${await migrate(root)} 篇 CMS 文章；旧文件保持原样。`);
}

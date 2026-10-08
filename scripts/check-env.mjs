/* 环境自检：确认本地服务器按 UTF-8 正确返回中文，并检查 KaTeX CDN 可达性。
   用法：node scripts/check-env.mjs [端口] */
const PORT = process.argv[2] || '8000';
const LOCAL = [
  ['index.html', `http://127.0.0.1:${PORT}/index.html`],
  ['site.json', `http://127.0.0.1:${PORT}/content/site.json`],
  ['modules.json', `http://127.0.0.1:${PORT}/content/modules.json`],
  ['文章正文', `http://127.0.0.1:${PORT}/content/articles/apostol-sequence-limit.md`],
];

const CDN = [
  ['KaTeX CSS', 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'],
  ['KaTeX JS', 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js'],
];

console.log('\n[1] 本地服务器：中文编码是否正确');
let ok = true;
for (const [label, url] of LOCAL) {
  try {
    const buffer = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(10000) })).arrayBuffer());
    const text = buffer.toString('utf8');
    const replacement = (text.match(/\uFFFD/g) || []).length;
    const sample = (text.match(/[\u4e00-\u9fa5]{2,}/g) || []).slice(0, 3).join(' / ');
    const good = replacement === 0 && sample.length > 0;
    if (!good) ok = false;
    console.log(`  ${good ? 'ok  ' : 'FAIL'} ${label.padEnd(12)} 字节 ${buffer.length}  替换字符 ${replacement}  样例：${sample}`);
  } catch (error) {
    ok = false;
    console.log(`  FAIL ${label.padEnd(12)} ${error.message}`);
  }
}

console.log('\n[2] KaTeX CDN 可达性（决定数学公式能否渲染）');
for (const [label, url] of CDN) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const bytes = (await response.arrayBuffer()).byteLength;
    console.log(`  ${response.ok ? 'ok  ' : 'FAIL'} ${label.padEnd(12)} HTTP ${response.status}  ${Math.round(bytes / 1024)} KB`);
  } catch (error) {
    console.log(`  WARN ${label.padEnd(12)} 不可达：${error.message}`);
    console.log('       → 公式会降级显示为 TeX 源码（站点仍可正常浏览）');
  }
}

console.log(ok ? '\n✅ 本地服务与编码检查通过' : '\n❌ 有问题，见上');
process.exit(ok ? 0 : 1);

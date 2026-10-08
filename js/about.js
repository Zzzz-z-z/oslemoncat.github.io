/* 关于页：站点说明、目录结构、如何新增内容、可扩展方向。 */
import { el } from '../assets/js/util.js';
import { loadSite, loadModules, loadArticles } from '../assets/js/content.js';
import { pageHead } from '../assets/js/layout.js';
import { renderMarkdown, typesetMath } from '../assets/js/markdown.js';

const ABOUT = `
## 这是什么

这里是一个纯静态的个人知识库，用来把课程笔记、知识总结和零散记录集中归档。
不用数据库、不依赖后端服务：所有内容都是仓库里的文本文件，浏览器直接读取渲染，
因此可以直接托管在 GitHub Pages 上，也不需要任何构建步骤。

## 目录结构

\`\`\`
oslemoncat.github.io/
├── index.html                # 唯一入口页，所有路由都在这里挂载
├── 404.html                  # GitHub Pages 的兜底页
├── content/                  # ★ 内容层：只放数据，不放样式
│   ├── site.json             # 站点标题、导航、页脚
│   ├── modules.json          # 知识模块清单
│   ├── articles.json         # 文章索引（slug 列表）
│   └── articles/
│       ├── <slug>.json       # 文章元数据
│       └── <slug>.md         # 文章正文
└── assets/
    ├── css/site.css          # ★ 样式层：全部视觉都在这里
    ├── js/                   # 渲染引擎（工具、内容、Markdown、布局、主题）
    └── images/<slug>/        # 图片按文章归档
\`\`\`

内容和样式是分开的：改版式只动 \`assets/css/site.css\`，写文章只动 \`content/\`，
两者互不影响。

## 新增一篇文章

1. 在 \`content/articles/\` 下新建 \`<slug>.md\`（正文）和 \`<slug>.json\`（元数据）。

   \`\`\`json
   {
     "title": "文章标题",
     "summary": "一两句话说明，会显示在列表里。",
     "module": "math-analysis",
     "date": "2026-10-08",
     "updated": "2026-10-08",
     "tags": ["极限", "数列"],
     "cover": "assets/images/<slug>/cover.svg",
     "order": 0
   }
   \`\`\`

2. 把 \`<slug>\` 追加到 \`content/articles.json\` 的数组里。
3. 提交推送，刷新页面即可看到。

> \`cover\` 是可选的；\`draft: true\` 可以标记草稿；\`order\` 用于时间相同时的排序。

## 正文支持的写法

| 写法 | 效果 |
| --- | --- |
| \`## 标题\` / \`### 标题\` | 节标题，自动进右侧目录 |
| \`$x^2$\` / \`$$\\int_a^b f(x)\\,dx$$\` | 行内 / 块级数学公式（KaTeX） |
| \`\`\`c 代码块 \`\`\` | 代码块 |
| \`> 引用\` | 引用块 |
| \`::: tip 标题\` … \`:::\` | 提示块，类型有 note / tip / warn / key |
| \`::: theorem 定理 2.1\` … \`:::\` | 定理块，类型有 definition / theorem / example / proof |
| \`::: video\` + \`url:\` / \`source:\` | 视频外链卡片（长视频不放仓库，只存地址） |
| \`![](assets/images/<slug>/a.png)\` | 图片，按文章归档 |

示例：

\`\`\`markdown
::: theorem 定理 2.1（单调有界定理）
单调有界数列必收敛。
:::

::: video 第 3 讲：数列极限的 ε-N 语言
url: https://www.bilibili.com/video/BVxxxx
source: Bilibili
duration: 24:10
:::
\`\`\`

## 图片与视频怎么放

- **图片**：放进 \`assets/images/<文章 slug>/\`，用相对路径引用。单张建议压缩到 300 KB 以内
  （可以用 Squoosh 或 \`pngquant\`），避免仓库越来越大。
- **视频**：视频文件不进仓库。把视频传到 B 站、YouTube 或其他平台，
  在文章里用 \`::: video\` 块只保存链接。

## 可扩展的方向

下面这些都属于「纯静态可做」，不需要服务器：

- 全文搜索：把文章正文一起打进索引，改成浏览器端搜索（文章上千篇时再考虑）。
- 代码高亮：加 highlight.js，或换用支持高亮的渲染器。
- 标签页：按 \`tags\` 聚合，生成 \`#/tag/<name>\` 路由。
- 系列文章：在元数据里加 \`series\` 字段，做上一篇/下一篇的系列串联。
- 评论：GitHub Discussions / giscus 这类第三方服务，挂上即可。

需要后端才能做的（当前明确不做）：登录、收藏同步、后台管理界面、访问统计后台。
`;

export async function renderAbout(container) {
  const [site, modules, articles] = await Promise.all([loadSite(), loadModules(), loadArticles()]);

  container.innerHTML = '';
  const wrap = el('div', { class: 'wrap' });
  wrap.appendChild(pageHead('关于', site.description));

  const meta = el('div', { class: 'card', style: 'margin:26px 0 34px' }, [
    el('div', { class: 'card__meta', style: 'padding-top:0' }, [
      el('span', { text: `站点：${site.title}` }),
      el('span', { text: `模块：${modules.length} 个` }),
      el('span', { text: `文章：${articles.length} 篇` }),
      site.url ? el('a', { href: site.url, target: '_blank', rel: 'noopener noreferrer', text: '访问线上站点' }) : null,
    ]),
  ]);
  wrap.appendChild(meta);

  const { html } = renderMarkdown(ABOUT);
  const prose = el('div', { class: 'prose', html });
  wrap.appendChild(prose);

  container.appendChild(wrap);
  typesetMath(prose);
}

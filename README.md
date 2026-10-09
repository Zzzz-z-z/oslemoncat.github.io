# Lemoncat的喵喵屋

> 本地接入版已增加 `/admin/` 文章后台、Cloudflare GitHub 登录与自动发布。
> 请先阅读 [CMS_SETUP.md](CMS_SETUP.md)。后台编辑源是 `content/posts/`；
> GitHub Actions 自动生成和发布 `dist/`。下方记录的是接入前的静态版维护方式。

个人知识库站点：把课程笔记整理成「首页 → 知识模块 → 文章详情」的结构，托管在 GitHub Pages 上。

- **纯静态、零构建**：不需要 Node、不需要打包，仓库里的文件就是线上运行的文件。
- **内容与样式分离**：写文章只动 `content/`，改版式只动 `assets/css/site.css`。
- **图片按文章归档**：`assets/images/<slug>/`。
- **长视频不进仓库**：正文里用 `::: video` 块只保存外部播放地址。

线上地址：<https://oslemoncat.github.io/>

---

## 快速开始（本地预览）

浏览器直接双击 `index.html` 是**打不开**的：站点通过 `fetch` 读取 `content/` 下的
JSON 与 Markdown，而 `file://` 协议被浏览器安全策略禁止读取本地文件。
请用一个本地静态服务器：

```bash
# 任选其一，在项目根目录执行
python -m http.server 8000
npx serve .
php -S localhost:8000
```

然后访问 <http://localhost:8000>。

> 直接双击 `index.html` 看不了：站点用 `fetch` 读取 `content/` 下的 JSON 与 Markdown，
> `file://` 协议下会被浏览器的安全策略拦截。

---

## 本地校验

改完内容或代码后，按顺序跑这三步（前两步需要本地服务器在 8000 端口运行）：

```bash
# 1) 内容链路与渲染单元测试（46 项断言：Markdown、索引、封面、安全转义）
node scripts/smoke-test.mjs

# 2) 端到端渲染测试（66 项断言：真实 app.js 启动路径 + 全部路由 + 交互）
#    在最小 DOM 环境里跑真实前端代码，覆盖路由解析、每页渲染、主题切换、移动端菜单
node tests/render.test.mjs 8000

# 3) 请求连通性与编码检查
node scripts/check-content.mjs 8000
node scripts/check-env.mjs 8000
```

视觉自检（需要普通终端，沙箱里跑不了浏览器）：

```powershell
pwsh -File scripts/verify-layout.ps1      # 关键页面截图输出到 .preview/
```

`tests/dom-shim.mjs` 是一个最小 DOM 实现（约 400 行），只实现了站点实际用到的 API，
**不要**把它当 jsdom 用；新增前端 API 调用时记得同步补 shim。

---

## 目录结构

```
oslemoncat.github.io/
├── index.html                  # 唯一入口页（所有路由都在这里挂载）
├── 404.html                    # GitHub Pages 兜底页，把未知路径转成 hash 路由
├── app.js                      # 路由与启动逻辑
├── content/                    # ★ 内容层：只放数据
│   ├── site.json               # 站点标题、导航、页脚
│   ├── modules.json            # 知识模块清单
│   ├── articles.json           # 文章索引（slug 列表）
│   ├── generated/              # 批量导入脚本生成的索引（可选）
│   └── articles/
│       ├── <slug>.json         # 文章元数据
│       └── <slug>.md           # 文章正文
├── assets/
│   ├── css/site.css            # ★ 样式层：所有视觉都在这里
│   ├── js/                     # 渲染引擎
│   │   ├── util.js             # DOM / 日期 / fetch 工具
│   │   ├── content.js          # 内容加载与缓存、模块聚合
│   │   ├── markdown.js         # Markdown 渲染器（零依赖，含数学与提示块）
│   │   ├── layout.js           # 页头页脚、卡片、列表、分页、面包屑
│   │   ├── theme.js            # 明暗主题
│   │   └── toc.js              # 目录高亮与页内锚点
│   └── images/<slug>/          # 图片按文章归档
├── js/                         # 页面模块（按路由懒加载）
│   ├── home.js  modules.js  module.js  articles.js  article.js  about.js
└── scripts/import_tex.py       # 把 LaTeX 讲义批量导入成文章（可选）
```

### 路由表

| URL | 页面 |
| --- | --- |
| `#/` | 首页 |
| `#/modules` | 知识模块总览 |
| `#/module/<slug>` | 单个模块及其文章列表 |
| `#/articles?module=&q=` | 全部文章，支持模块筛选与关键字搜索 |
| `#/article/<slug>` | 文章详情 |
| `#/about` | 关于 / 写作指南 |

---

## 新增一篇文章

1. **写正文** `content/articles/<slug>.md`
2. **写元数据** `content/articles/<slug>.json`

```json
{
  "title": "文章标题",
  "summary": "一两句话，显示在列表与卡片里。",
  "module": "math-analysis",
  "date": "2026-10-08",
  "updated": "2026-10-08",
  "tags": ["标签一", "标签二"],
  "cover": "assets/images/<slug>/cover.svg",
  "order": 10,
  "draft": false
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✔ | 文章标题 |
| `module` | ✔ | 对应 `content/modules.json` 里的 `slug`，未匹配时归入「未分类」 |
| `summary` | | 摘要 |
| `date` / `updated` | | `YYYY-MM-DD`，列表按 `updated`（缺失时用 `date`）倒序 |
| `tags` | | 字符串数组 |
| `cover` | | 封面图相对路径 |
| `order` | | 时间相同时的排序权重 |
| `draft` | | `true` 时标记为草稿（当前仍会显示，便于本地校对） |

3. **登记索引**：把 `<slug>` 加进 `content/articles.json` 的 `articles` 数组。

如果生成了 `content/generated/articles-index.json`（见下节），加载时**优先使用它**，
此时不必手工维护 `articles.json`。

---

## 新增一个知识模块

编辑 `content/modules.json`，追加一项：

```json
{
  "slug": "writing",
  "title": "学术写作",
  "subtitle": "College Writing Skills",
  "description": "模块说明，显示在卡片上。",
  "accent": "#8b6fd0",
  "order": 50
}
```

`accent` 是该模块的主题色，会用于卡片装饰条与标签。

---

## 正文支持的写法

| 语法 | 效果 |
| --- | --- |
| `## 标题` / `### 标题` | 节标题，自动进入右侧目录（`#` 与 `##` 都按节标题渲染，避免重复 h1） |
| `$x^2$`、`$$\int_a^b f(x)\,dx$$` | 行内 / 块级数学公式（KaTeX） |
| ` ```c … ``` ` | 代码块 |
| `> 引用` | 引用块 |
| `**粗体**`、`*斜体*`、`~~删除线~~` | 行内强调 |
| `[文字](链接)`、`![图注](路径)` | 链接（外链自动新标签打开）、图片 |
| 空行分隔的 `\|` 表格 | 表格 |
| `::: note/tip/warn/key 标题` … `:::` | 提示块 |
| `::: definition/theorem/example/proof 标题` … `:::` | 定理块 |
| `::: video 标题` + `url:` / `source:` / `duration:` | 视频外链卡片 |

示例：

````markdown
::: theorem 定理 2.1（单调有界定理）
单调有界数列必收敛。
:::

::: video 第 3 讲：数列极限的 ε-N 语言
url: https://www.bilibili.com/video/BVxxxx
source: Bilibili
duration: 24:10
:::
````

---

## 图片与视频的处理约定

- **图片**：放入 `assets/images/<文章 slug>/`，正文用相对路径引用。
  单张建议压缩到 300 KB 以内（Squoosh、`pngquant`、`oxipng` 都可以），
  避免仓库体积失控。SVG（矢量图）几乎不占空间，示意图优先用 SVG。
- **视频**：视频文件**不进仓库**。上传到 B 站 / YouTube 等平台后，
  用 `::: video` 块保存链接即可。

---

## 批量导入 LaTeX 讲义

仓库里带了 `scripts/import_tex.py`，可以把已有的 `.tex` 讲义粗转成 Markdown 文章：

```bash
python scripts/import_tex.py "D:/path/数学分析知识点总结_Apostol体系.tex" \
  --slug apostol-full \
  --title "数学分析知识点总结（Apostol 体系）" \
  --module math-analysis
```

脚本会做这些事：

- 去掉导言区（`\documentclass` 到 `\begin{document}`）与常见格式命令；
- 把 `\section` / `\subsection` / `\subsubsection` 映射成 `##` / `###` / `####`；
- 把 `theorem` / `example` / `solution` 环境映射成 `::: theorem` / `::: example` / `::: solution` 块；
- 保留数学环境（`equation`、`align`、`$…$`）为 LaTeX，交给 KaTeX 渲染；
- 写出 `content/articles/<slug>.md`、`<slug>.json`，并追加到 `content/generated/articles-index.json`。

转换是**启发式**的，产出需要人工校对（尤其是表格、图片、自定义宏）。
建议一次转换一篇，转完在本地预览确认。

---

## 部署

推送到 `main` 分支即自动部署（`.github/workflows/pages.yml`）。
也可以在仓库 **Settings → Pages** 里把 Source 设为 “GitHub Actions”。

首次启用前请确认：**Settings → Pages → Source = GitHub Actions**。

### 第一次推送

仓库已初始化好，本地 `main` 就是在远端 `f3546b5` 之上的若干提交，
因此推送是**快进**，不需要强推。

**最简单的方式**：双击项目根目录的 `一键上线.cmd`。
它会检查网络、配置 TLS 后端、打印待推送提交，然后推送；
首次推送会弹出 GitHub 登录窗口，登录一次即可（凭证会被记住）。

手动方式：

```powershell
git config --local http.sslBackend openssl   # 本机 schannel 握手 GitHub 会报 SEC_E_NO_CREDENTIALS
git push -u origin main
```

> 本机 git 默认的 schannel 后端读取凭据句柄失败，改用 openssl 后端即可正常访问 GitHub。
> 该配置只作用于本仓库（`--local`），不影响其他项目。
>
> 若本机使用代理，推送前先设置：`git config --local http.proxy http://127.0.0.1:端口`

### 开启 Pages（只需一次）

推上去之后，站点还不会自动上线，需要开启 Pages：

1. 打开 <https://github.com/oslemoncat/oslemoncat.github.io/settings/pages>
2. **Source** 选 **GitHub Actions**，保存
3. 打开 <https://github.com/oslemoncat/oslemoncat.github.io/actions> 看部署是否变绿
4. 访问 <https://oslemoncat.github.io/>

之后每次 `git push` 到 `main` 都会自动重新部署，约 1 分钟生效。

---

## 环境与服务

| 项目 | 说明 |
| --- | --- |
| 运行时依赖 | 无 |
| 构建步骤 | 无（文件即产物） |
| 数学公式 | KaTeX 0.16.11，通过 jsDelivr CDN 加载；加载失败时公式降级显示为 TeX 源码 |
| 字体 | 系统字体栈（Segoe UI / PingFang SC / Noto Sans SC …） |
| 浏览器要求 | 支持 ES Modules 的现代浏览器（Chrome/Edge 90+、Safari 15+、Firefox 90+） |

想彻底摆脱 CDN，可以把 KaTeX 的 `katex.min.css`、`katex.min.js` 与 `fonts/`
下载到 `assets/vendor/katex/`，然后修改 `js/article.js` 顶部的两个常量。

---

## 可扩展方向（纯静态可实现）

- **全文搜索**：把正文一起打进索引，改为浏览器端搜索。
- **代码高亮**：接入 highlight.js 或 Prism。
- **标签页**：按 `tags` 聚合，新增 `#/tag/<name>` 路由。
- **系列文章**：元数据加 `series` 字段，串联同一系列的上下篇。
- **评论**：giscus / GitHub Discussions，纯前端挂载。

需要后端才能做的（当前明确不做）：登录、收藏同步、后台管理、访问统计。

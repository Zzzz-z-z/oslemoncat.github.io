# 在自己的网站编辑和发布文章

此接入包对应 `oslemoncat/oslemoncat.github.io` 当前网站。网站继续放在 GitHub Pages，文章后台位于 `https://oslemoncat.github.io/admin/`，Cloudflare Worker 只负责 GitHub 登录认证。

后台启用后，日常操作是：**登录 → 新建/编辑文章 → 保存草稿 → 发布 → 等待 Pages 部署成功**。

## 1. 创建 Cloudflare Worker

1. 在 Cloudflare 控制台进入 **Workers & Pages → Create application → Start with Hello World!**。
2. Worker 名称填 `lemoncat-cms-auth`，点击 **Deploy**。
3. 你的实际地址是 `https://lemoncat-cms-auth.zhounanxuan071106.workers.dev`。下面用 **W** 代表这个完整地址，末尾不加 `/`。后台配置已填入这个实际地址。
4. 进入这个 Worker，点击 **Edit code**。
5. 点击编辑器左侧原有的 **`worker.js`**，在代码区按 **Ctrl+A**，用本地 `auth/worker.mjs` 的完整内容覆盖它。控制台里的入口文件名保持 `worker.js`，然后保存并部署。如果已经另外新增了 `worker.mjs`，仍需要覆盖原来的 `worker.js`，否则默认入口会继续显示 Hello World。

此时访问 `W/health` 应显示 `ok`。这个检查只说明代码已运行；登录还需要后面的配置。个人使用可以从 Workers 免费方案开始，限额以 [Cloudflare 定价文档](https://developers.cloudflare.com/workers/platform/pricing/) 为准。

## 2. 在 GitHub 创建登录应用

打开 [GitHub 创建 OAuth App](https://github.com/settings/applications/new)，填写：

| 字段 | 填写内容 |
| --- | --- |
| Application name | `oslemoncat 文章管理` |
| Homepage URL | `https://oslemoncat.github.io/admin/` |
| Redirect URI（旧版名称：Authorization callback URL） | `https://lemoncat-cms-auth.zhounanxuan071106.workers.dev/callback` |

在 **Redirect URIs** 区域的 **Redirect URI** 输入框中填写上面的回调地址，一个地址即可。**Allow wildcard matching** 和 **Enable Device Flow** 保持不勾选，**Expire user access tokens** 保留默认勾选。这个版本不自动续期；GitHub 会话令牌过期后，退出后台再登录即可。点击 **Register application**，记录 **Client ID**，再生成 **Client Secret**。

**Client Secret 直接填到下一步 Cloudflare 的 Secret 中，不要放到网页、仓库或聊天里。** GitHub 登录时会请求 `public_repo` 范围：这是 OAuth App 的公开仓库权限范围，并非只能写本站这一个仓库。认证代码额外检查登录账号必须是 `oslemoncat`，且对本站仓库拥有写入权限。相关行为见 [GitHub OAuth 文档](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)。

## 3. 设置 Worker 的变量和密钥

从代码编辑器左上角返回 Worker 详情页，进入顶部 **Settings**。在 **Runtime variables and secrets** 区域选择 **Production**，点击这一栏右上角的 **＋ Add variable**（部分旧界面显示 **Variables and Secrets → Add**）。按下表手动填写变量名称和值，随后点击 **Deploy** 使设置生效。

当前弹窗中，**Key** 填变量名称，**Value** 填变量值。右侧 **Secret** 复选框勾选表示密钥，不勾选表示普通文本；这个界面没有单独的 Type 下拉框。通过弹窗里的 **＋ Add** 可一次填写多项，最后点击蓝色 **Add … variable(s) and deploy**。

| Key（名称） | Secret 是否勾选 | Value（值） |
| --- | --- | --- |
| `CMS_ORIGIN` | 不勾选 | `https://oslemoncat.github.io` |
| `REPOSITORY` | 不勾选 | `oslemoncat/oslemoncat.github.io` |
| `ALLOWED_GITHUB_LOGIN` | 不勾选 | `oslemoncat` |
| `CALLBACK_URL` | 不勾选 | `https://lemoncat-cms-auth.zhounanxuan071106.workers.dev/callback` |
| `GITHUB_CLIENT_ID` | 不勾选 | 第二步得到的 Client ID |
| `GITHUB_CLIENT_SECRET` | **勾选** | 第二步得到的 Client Secret |
| `OAUTH_STATE_SECRET` | **勾选** | 32 字符以上的随机密钥，推荐 64 字符 |

双击 `auth/generate-state-key.html`，点击“生成随机密钥”，复制结果到 `OAUTH_STATE_SECRET`。这个本地页面没有网络请求。

`CALLBACK_URL` 必须与 GitHub OAuth App 的 callback URL 完全一致。修改变量和 Secret 后要部署该版本。[Cloudflare Secret 设置说明](https://developers.cloudflare.com/workers/configuration/secrets/)

如果习惯命令行，也可以使用 `auth/wrangler.jsonc`：填写其中的公开变量，通过 Wrangler 的 Secret 命令设置两个密钥，然后部署。第一次接入推荐按上面的控制台操作。

## 4. 上传网站接入文件

1. `admin/config.yml` 的 `backend.base_url` 已填入你的实际 Worker 地址；确认它与控制台的地址一致。
2. 将接入包里的文件按目录放入原仓库的 `main` 分支。保留 `admin/`、`auth/`、`content/posts/`、`scripts/`、`tests/` 和隐藏的 `.github/` 路径结构。
3. 接入包已迁移原有四篇文章。后台今后编辑 `content/posts/<slug>.md`；它同时包含文章信息和 Markdown 正文。
4. GitHub 仓库 **Settings → Pages → Source** 改为 **GitHub Actions**。
5. 打开仓库的 **Actions**，等待 **Publish website and admin** 成功；也可以手动运行这个工作流。
6. 访问 `https://oslemoncat.github.io/admin/`，点击 GitHub 登录，完成授权。

GitHub 网页的普通文件拖拽上传可能漏掉 `.github/` 等隐藏目录。可通过 GitHub Desktop 提交整个接入目录，或者使用仓库网页 **Add file → Create new file** 单独建立 `.github/workflows/pages.yml`。只把文件放入 `dist/` 无法接入 CMS；需要上传接入包的源文件。

GitHub Pages 的发布来源设置参见 [官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 5. 第一次发布文章

1. 在后台选择 **学习文章 → 新建文章**。
2. “文章地址”填写小写英文短横线名称，例如 `sequence-limit-review`；填写标题、摘要、知识模块和日期。
3. 写正文。普通文字、列表和图片可以在可视化编辑器里操作；数学公式、`::: theorem` 和 `::: video` 等现有语法使用 Markdown 源码模式。后台预览暂时关闭，实际排版以发布网站为准。
4. 用 **保存草稿** 保存。文章进入 Decap 的草稿流程，不会直接更新 `main`。随后在工作流中将它标记为可发布，再执行 **发布**。按钮名称可能随编辑器翻译版本略有变化。
5. 发布会把文章合并到 `main`，触发 Pages 构建。等 Actions 成功后刷新首页，文章和索引会一起更新。
6. 原有文章也能在后台打开并修改。更新时调整“更新日期”。

“暂时隐藏文章”开关用于撤下已发布文章。开启后，即使该文件在 main 分支，部署产物中也不包含它。草稿仍可能在公开 GitHub 仓库或分支里被读取；这个开关不提供内容保密。

首页标题下的 **管理后台** 按钮会打开 `/admin/`。

文章编辑器提供三种上传入口：

- **封面图**：选择图片后上传，用作文章封面。
- **文章图片 → 新增图片 → 图片文件**：上传图片，填写可选的说明；发布后在正文下方显示。单张图片不超过 10 MB。正文工具栏也可以插入图片。
- **附件与音视频 → 新增附件 → 文件**：上传 PDF、Word、Excel、PPT、TXT、ZIP、音频或视频，填写可选的显示名称。单个文件不超过 20 MB。发布后会显示文件类型及下载入口；浏览器支持的音视频格式会显示播放器。

图片保存在 `assets/images/uploads/`，附件保存在 `assets/files/uploads/`。上传后仍需要保存并发布文章，等 Actions 发布成功后资源才会在网站出现。文件链接也可以直接指向已有的外部资源。

长视频可以继续使用当前网站的外链写法：

```markdown
::: video 视频标题
url: 你的实际视频链接
source: Bilibili
duration: 12:30
:::
```

## 这次接入新增的文件

```text
admin/
  index.html                    网页后台入口
  config.yml                    编辑字段、仓库与登录服务地址
  vendor/decap-cms.js            固定版本 3.16.3，放在自己的网站
  vendor/LICENSE.txt            开源许可
auth/
  worker.mjs                    可直接粘贴到 Cloudflare 的认证代码
  wrangler.jsonc                可选命令行部署配置
  generate-state-key.html       本机生成校验密钥
  .gitignore                    排除本地密钥文件
content/posts/*.md              原有四篇文章的 CMS 编辑源
scripts/
  cms-content.mjs               解析与校验文章
  cms-migrate.mjs               旧格式迁移，重复运行不会覆盖已有源
  cms-build.mjs                 生成网站读取的正文、元数据与索引
tests/
  cms-integration.test.mjs       文章、索引和草稿发布验证
  oauth.test.mjs                 登录状态与账号权限验证
.github/workflows/pages.yml     自动构建与 GitHub Pages 部署
package.json / package-lock.json
.gitignore
CMS_SETUP.md
```

自动构建把 `content/posts` 中的文章转成原网站读取的 `.md + .json` 格式，并同步两个文章索引。页面布局、路由和 Markdown 渲染器保持当前实现。后台的模块选项从 `content/modules.json` 自动同步。现有旧文章源文件保留作迁移备份，以后从后台维护 `content/posts/`，避免双处编辑。

构建只把网站文件、已发布文章和后台文件放进 `dist/`。认证代码和编辑源没有进入 Pages 部署产物，两个 Secret 始终只配置在 Cloudflare。

## 本地开发和检查

需要 Node.js 22 或更新版本。在仓库目录执行：

```text
npm ci --ignore-scripts
npm run cms:migrate
npm run cms:test
npm run cms:build
```

`cms:migrate` 只在接入或导入旧格式文章时需要。每次本地构建要求 `dist/` 不存在，避免旧的删除/隐藏文章残留；GitHub Actions 每次都会使用干净目录。本地再次构建时，只清理自己生成的 `dist/` 目录。

## 当前交付状态与排查

已完成：后台文件、四篇原文迁移、自动索引和发布流程、Worker 认证代码，以及迁移/草稿/登录权限测试。

你的实际 Worker 地址已经填入配置。待你配置：GitHub OAuth App、Cloudflare 变量和 Secret、仓库上传与 Pages Source。真实 GitHub 登录和文章发布需要这些完成后验证；本地测试没有向 GitHub 写入内容。

- 登录显示“尚未配置”：检查七个 Worker 变量和 Secret，并重新部署。
- GitHub callback 错误：比对 GitHub 与 Worker 两处的 callback URL。
- 弹窗登录完成但后台未登录：检查 `admin/config.yml` 的 base_url 是否与 Worker 的 origin 完全一致，检查 `CMS_ORIGIN` 是否为网站的实际 origin。
- 登录账号被拒绝：当前管理账号限定为 `oslemoncat`，并检查仓库写入权限。
- 长时间使用后 GitHub 返回 401：退出后台，再次登录以取得新的会话令牌。
- 点击发布后网站没更新：查看 Actions 构建结果。文章地址、分类或日期无效会阻止新版本部署，原网站保留最近成功部署的版本。
- 原有批量导入脚本新增文章后：运行 `cms:migrate` 将它带入新的编辑源，再提交。

后台编辑与发布行为以 [Decap GitHub backend](https://decapcms.org/docs/github-backend/) 和 [Editorial workflow](https://decapcms.org/docs/editorial-workflows/) 文档为依据。

# 喵喵屋统一登录与投稿审核

新版网站只有一个登录入口：`https://oslemoncat.github.io/login/`。所有人用自己的 GitHub 账号登录，不需要另外设置本站密码。登录后进入首页；右上角头像和“写一篇文章”打开同一个写作区。

## 上线顺序

1. 先在 Cloudflare 打开现有 **lemoncat-cms-auth → Edit code**，选择原来的入口 **worker.js**，完整覆盖为本目录 `auth/worker.mjs` 的内容，点击 **Deploy**。不要只新增一个未被入口引用的文件。
2. 原有 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`OAUTH_STATE_SECRET`、`CMS_ORIGIN`、`CALLBACK_URL`、`REPOSITORY`、`ALLOWED_GITHUB_LOGIN` 保留。`ALLOWED_GITHUB_LOGIN=oslemoncat` 现在表示管理员名单，不限制普通用户登录。回调地址仍以 `/callback` 结尾。
3. 可在 GitHub OAuth App 中把 Homepage URL 更新为 `https://oslemoncat.github.io/login/`；无需另建登录应用。
4. 登录服务更新成功后，再把网站源文件提交到 `main`，等待 GitHub Actions 的 `Publish website and admin` 部署成功。Pages 发布来源保持 **GitHub Actions**。
5. 访问本站完成真实 GitHub 登录，确认 `oslemoncat` 可以看到审核入口。普通 GitHub 用户只会看到写文章和自己的投稿。

`/health` 显示 `ok` 只说明 Worker 可访问。新版 `/api/session` 在 Origin 为 `https://oslemoncat.github.io` 且没有令牌时应返回 JSON 的 401“请先登录”；旧版会返回 404。

## 用户与管理员

普通用户：写正文、选择知识模块、添加图片或附件、预览正文、提交审核。待审核稿件可继续修改。普通用户不能直接发布文章；可以撤回自己的待审稿件，并在后台内容授权配置后删除自己的已发布文章。

管理员：编辑与发布文章、查看所有投稿、审核通过发布、退回投稿、删除已发布文章。身份由 Worker 每次向 GitHub 验证；必须同时位于 `ALLOWED_GITHUB_LOGIN` 名单中并拥有本站仓库写入权限。以后增加管理员可用逗号分隔名单，并在 GitHub 授予相应仓库权限；普通投稿用户无需加入名单。

普通用户提交时，服务用该用户的授权在其 GitHub 账号内创建本站的 fork 和投稿分支，然后建立 Pull Request。审核通过后才合并到本站 `main`，触发网站部署。首次建立 fork 可能需要稍等后重试。

审核页显示正文、图片、附件及修改文件清单。发布前检查指定稿件对应的网页构建运行及成功的 `build` 作业，并锁定审核时的提交版本；若用户修改了稿件，需要重新打开审核。首次外部投稿可能需要管理员在 GitHub Actions 批准运行检查；页面会提示检查未通过，此时不会发布。

## 图片与附件

图片：PNG、JPG/JPEG、GIF、WebP、AVIF，单张最多 10 MB。附件：PDF、Word、Excel、PPT、TXT、Markdown、CSV、ZIP，以及常见音频和视频格式，单个最多 20 MB。每次最多 12 个新文件，总计最多 20 MB。

图片存放在 `assets/images/uploads/`，其他文件在 `assets/files/uploads/`。资源随稿件一起提交；移除共享附件引用或删除文章不会自动删除其他文章可能使用的文件。长视频仍可使用外部视频链接。

正文支持原有 Markdown、数学公式、代码、提示块、定理块和视频卡片。浏览器会自动保存新文章的文字草稿；未提交文件的二进制内容不会保存，刷新后需要重新选择这些文件。

## DeepSeek 助手

在 Cloudflare **Settings → Runtime variables and secrets → Add variable** 添加 `DEEPSEEK_API_KEY`，勾选 **Secret**，填入自己的 Key 后 Deploy。密钥不要写进网页、仓库或聊天。

助手位于管理员写作区，普通投稿用户不能调用它消耗管理员额度。默认模型 `deepseek-flash`，可以用普通变量 `DEEPSEEK_MODEL` 改为账号支持的模型。接口为官方 `https://api.deepseek.com/chat/completions`，输出设计、代码或写作建议；不会自动执行返回的代码或擅自发布改动。参考 [DeepSeek API 文档](https://api-docs.deepseek.com/en/)。

## 地址与实现边界

首页 `/`、模块总览 `/modules/`、模块 `/module/<slug>/`、文章列表 `/articles/`、正文 `/article/<slug>/`、关于 `/about/`、写作区 `/workspace/`。顶部四项导航、品牌首页链接和写作区并列目录在当前标签页跳转，地址仍显示对应路径。列表中的文章、知识模块详情可在新标签页打开；GitHub 检查详情与外部媒体保持新标签页。已发布文章列表的编辑、删除使用块状按钮。

页面、文章显示、搜索筛选、主题、背景与桌宠都是静态内容。登录验证、稿件写入、审核合并、删除和 DeepSeek 调用由 Worker 连接 GitHub/DeepSeek 服务完成。旧版 Decap `/admin/` 保留供管理员使用，首页不再另设该入口。

本站和仓库是公开的；进入界面的登录要求不把 GitHub Pages 静态文件变成私密内容。待审稿件和附件也位于公开 GitHub 仓库/PR 中，提交界面会说明这一点。

本地预览展示界面和桌宠；实际 OAuth 回调固定返回线上域名。角色、上传、审核和助手的本地验证使用隔离模拟接口，不会产生正式文章。上线后仍需完成真实登录验证。
## 删除与检查提示更新

文章详情页新增删除按钮，普通用户有“我的文章”列表。新版本及后台授权步骤见 [DELETE_REVIEW_SETUP.md](DELETE_REVIEW_SETUP.md)。邮箱注册暂缓，本次保留 GitHub 登录。

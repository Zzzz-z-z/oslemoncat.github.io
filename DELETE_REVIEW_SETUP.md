# 删除与审核提示更新（2026-10-09）

本次只更新删除功能和审核检查提示。邮箱注册按用户要求暂缓；GitHub 登录方式保留。

## 管理员现在在哪里删除

登录后打开任何文章，标题下方出现“编辑文章”和“删除文章”。也可以到写作区 → 已发布文章删除。
删除前有确认弹窗。操作仅删除该文章的 Markdown 源文件；共享图片和附件保留。GitHub Pages 部署后网页更新。

## 普通用户

写作区增加“我的文章”，仅列出后台作者记录属于该账号的文章；文章详情页也只在本人文章上显示删除按钮。
待审核稿件可以撤回，撤回会关闭 GitHub 投稿 PR，保留历史记录。
作者身份使用 GitHub 不变的数字账号 ID，不用昵称判断。

公开文章的作者记录保存在 content/ownership.json，由后台在审核发布后生成，同时给文章补入 author_id。
投稿文件白名单不允许修改此作者记录文件。无作者记录的旧文章暂时只允许管理员删除。

## 上线步骤

1. Cloudflare → lemoncat-cms-auth → Edit code，选择当前真正入口 worker.js。
2. 完整覆盖为 D:\lemoncat_hub\auth\worker.mjs 的内容，点击 Deploy。所有旧变量和 Secret 保留。
3. 管理员删除使用管理员自己的 GitHub 登录授权，不需要新变量。
4. 要启用“普通作者删除本人正式文章”，需要一个后台仓库授权：
   - GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
   - Resource owner 选择 oslemoncat；Only select repositories 只选择 oslemoncat.github.io。
   - Repository permissions 的 Contents 设为 Read and write。Metadata 自动为 Read-only。
   - 设置合适的到期时间，并在到期前更新。
   - 把生成的值仅保存到 Cloudflare Secret：GITHUB_CONTENT_TOKEN，然后 Deploy。
   - 无需给普通用户仓库协作者权限；不要把令牌写进网页、仓库或聊天。
5. 网站前端通过 GitHub main 的正常部署上线；随后验证管理员删除入口和审核提示。

## 自动检查

保留自动检查。读取指定投稿 head_sha 对应的 .github/workflows/pages.yml 的最新 pull_request 运行，并确认其 build 作业成功。
GitHub PR 检查实际会针对临时合并版本运行，所以不能仅查询作者 head_sha 的 check-runs。
审核时仍锁定阅读过的稿件 SHA，禁止未审核的新版本或脚本、工作流改动发布。

审核区区分：
- 等待批准：外部投稿需要管理员在 GitHub 点 Approve and run workflows，批准前没有开始。
- 排队/运行中：通常几十秒，可以刷新状态。
- 失败：链接到日志。
- 成功：允许审核发布。

2026-10-09 查询时，“趣题一则”PR #2 的运行 37900840963 为 action_required。
此前一次完整部署用了约 31 秒，其中 build 约 10 秒。这是历史耗时，不是未来运行的保证。

## 验证边界

后台测试使用模拟 GitHub API，浏览器测试使用模拟角色与接口；未删改任何正式文章。
Cloudflare 手工部署及真实作者删除，仍需实际配置后台仓库授权后验证。

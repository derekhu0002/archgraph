---
name: create-github-repository-page
description: "基于 GitHub 仓库创建 GitHub Pages 主页（home web site），把仓库内容通过静态网页对外发布。Use when the user asks to create a home website for a repository, publish repo content via GitHub Pages, or add an index.html entry page. Reference: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site"
argument-hint: publishing-source-or-repo-root
disable-model-invocation: true
---

# CREATE GITHUB REPOSITORY PAGE

`create-github-repository-page` 负责为当前 GitHub 仓库创建一个可通过浏览器访问的主页（GitHub Pages project site），用静态文件（首选 `index.html`）呈现项目内容。

- 站点入口文件：GitHub Pages 会在发布源根目录查找 `index.html`、`index.md` 或 `README.md` 作为入口。
- 发布源为分支 + 文件夹时，入口文件必须位于该源文件夹的顶层（例如 `main` 分支的根目录）。
- Project site 的访问地址固定为 `https://<owner>.github.io/<repository>/`。
- GitHub Pages 只支持静态内容，不支持 PHP/Ruby/Python 等服务端语言。

## Rules

- **MUST** 在发布源根目录创建 `index.html` 作为主页入口（纯静态站点）。
- **MUST** 在纯静态 HTML 且不想走 Jekyll 构建时，在发布源根目录放置一个空的 `.nojekyll` 文件。
- **MUST** 确保仓库对 Pages 可见：GitHub Free 账户下仓库必须是 public。
- **MUST** 提交并推送到发布源分支后，站点才会构建/发布（首次发布最长约 10 分钟）。
- **MUST NOT** 在站点内容中暴露密钥或敏感信息（Pages 站点对互联网公开）。
- **MUST** 通过 `gh` CLI 或 GitHub API 检查/启用 Pages 发布源；若 `gh` 不可用或无权限，则以文档形式给出 Settings → Pages 的手动配置步骤。

## Workflow

### 1. Confirm Repository And Target

确认远程仓库与发布源：

```powershell
git remote -v
git branch --show-current
```

项目站点地址：`https://<owner>.github.io/<repository>/`。

### 2. Create The Entry Page

在发布源根目录创建 `index.html`，内容为项目主页：项目名、一句话简介、核心内容说明、仓库链接。保持纯静态、可离线打开。

### 3. Disable Jekyll For Plain Static Sites

发布源根目录放置空文件 `.nojekyll`，避免 GitHub Pages 对纯 HTML 做 Jekyll 处理。

### 4. Enable Pages Publishing Source

优先使用 `gh` CLI（若已认证）：

```powershell
gh api repos/{owner}/{repo}/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

若 `gh` 不可用，则引导用户在仓库 Settings → Pages 下选择：
- Source: Deploy from a branch
- Branch: `main`
- Folder: `/ (root)`

### 5. Commit And Push

```powershell
git add index.html .nojekyll
git commit -m "docs: add GitHub Pages home site"
git push
```

### 6. Verify

- 本地：直接打开 `index.html` 或用静态服务器验证渲染与内容可读。
- 线上：访问 `https://<owner>.github.io/<repository>/`，确认内容可查看（首次发布等待构建完成）。

## Output

- 站点入口文件路径
- 是否放置 `.nojekyll`
- Pages 发布源配置结果（API 已启用 / 需手动配置）
- 站点访问 URL
- 验收结果：内容是否可通过网站查看

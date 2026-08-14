# KGlibrary Info Format (global rule)

KGlibrary 是本项目积累的参考项目知识库。每个参考项目位于 `KGlibrary/<project>/`，并必须提供一份 `info.md`，供网站主页、Agent 与自动化脚本统一消费。

## Rules

- **MUST** 每个参考项目在 `KGlibrary/<project>/info.md` 顶部使用 YAML frontmatter，且至少包含以下键：
  - `name`：项目名（字符串）
  - `description`：一句话简介（字符串，建议加引号）
  - `repo`：GitHub 仓库完整 URL（https://github.com/<owner>/<repo>）
- **SHOULD** 额外提供：
  - `branch`：主分支名（默认 `main`）
  - `commit_id`：被收录时的提交 SHA
- **MUST** frontmatter 之后可以书写正文（如该项目 SystemArchitecture.json 的摘要），正文不影响机器消费。
- **MUST** 当新增或修改 `KGlibrary/*/info.md` 时，同步刷新网站主页 `index.html` 中的 `#kglibrary` 区域，并运行 `node --test tests/website.test.js` 验证同步。

## Example

```markdown
---
name: XKG-TEST
description: "a test repo which created a online mindmapping draft panel"
repo: https://github.com/derekhu0002/XKG-TEST
branch: main
commit_id: 1372c4e528f1ae93538af37272f0937fa52bdfee
---

正文摘要…
```

// Build a portable export package for the 媒体艺术家 Actor.
// Output: <workspace>/export/media-artist-package/
//   - media-artist.package.json          (graph fragment: elements/relationships/views)
//   - argo/agents/media-artist.agent.md
//   - argo/skills/dashscope-media-generator/SKILL.md
//   - argo/skills/qwen3-vl-visual-inspection/SKILL.md
//   - tests/media-artist-actor.test.js
//   - README-IMPORT.md
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'export', 'media-artist-package');
const GRAPH = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'KG', 'SystemArchitecture.json'), 'utf8'));

const ELEMENTS = ['media-artist-001', 'media-role-001', 'media-skill-001', 'media-vl-skill-001'];
const RELS = ['media-assign-001', 'media-use-skill-001', 'media-use-vl-001'];
const VIEWS = ['media-team-001'];

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function copy(srcRel, destRel) {
  mkdirp(path.dirname(path.join(OUT_DIR, destRel)));
  fs.copyFileSync(path.join(ROOT, srcRel), path.join(OUT_DIR, destRel));
}

function buildGraphFragment() {
  const elements = GRAPH.elements.filter((e) => ELEMENTS.includes(e.id));
  const relationships = GRAPH.relationships.filter((r) => RELS.includes(r.id));
  const views = GRAPH.views.filter((v) => VIEWS.includes(v.view_id));

  // strip commit attributes (source-repo specific)
  const cleanElements = elements.map((e) => {
    const { attributes, ...rest } = e;
    const cleanAttrs = (attributes || []).filter((a) => a.name !== 'commit');
    return cleanAttrs.length ? { ...rest, attributes: cleanAttrs } : rest;
  });

  // required source parents that must exist in the target graph
  const requiredParents = [
    { id: '1962', name: 'AgentOrganization', type: 'Grouping', note: 'Business Actor/Role 挂载点' },
    { id: '1249', name: 'Implementation and Migration Viewpoint', type: 'Grouping', note: 'Skill 挂载点（若无则改为目标项目对应 Skill 容器）' },
  ];

  return {
    packageName: 'media-artist-actor',
    version: '1.0.0',
    exportedFrom: {
      repo: 'archgraph',
      commit: 'b0ae5a9',
      file: 'design/KG/SystemArchitecture.json',
    },
    description: '媒体艺术家 Business Actor：负责图片与视频生成任务。包含 Actor、Business Role、2 个 Skill、媒体创作团队视图及 3 条关系。',
    requiredParents,
    elements: cleanElements,
    relationships,
    views,
  };
}

function buildReadme(pkg) {
  return `# 媒体艺术家 Actor 可移植包

将「媒体艺术家」Business Actor（负责图片/视频生成）从源项目导出，供目标 ARGO 项目导入。

## 包内容

| 路径 | 说明 |
|---|---|
| \`media-artist.package.json\` | 图谱片段（4 元素 + 3 关系 + 1 视图），目标图谱合并源 |
| \`argo/agents/media-artist.agent.md\` | Agent 定义（VS Code custom agent） |
| \`argo/skills/dashscope-media-generator/SKILL.md\` | 图像生成 Skill |
| \`argo/skills/qwen3-vl-visual-inspection/SKILL.md\` | 视觉验收 Skill |
| \`tests/media-artist-actor.test.js\` | 验收测试（GIVEN-WHEN-THEN 可执行） |

## 图谱片段包含

- 元素：
  - ${pkg.elements.map((e) => e.name).join('、')}
- 关系：${pkg.relationships.map((r) => r.statement).join('；')}
- 视图：${pkg.views[0].view_name}（view_id=${pkg.views[0].view_id}）

## 前置条件（目标项目图谱必须已有）

- \`AgentOrganization\`（id=1962）Grouping 元素——Actor/Role 挂载点。
- \`Implementation and Migration Viewpoint\`（id=1249）Grouping 元素——Skill 挂载点。
  若目标项目 id 不同，请按目标项目实际 id 替换 package.json 中元素的 \`parent\` 与视图的 \`parent_element_id\`。

## 导入步骤

### 1. 复制文件
\`\`\`powershell
# 将 agent 与 skills 复制到目标项目
Copy-Item -Recurse argo\agents\media-artist.agent.md      <目标>/argo/agents/
Copy-Item -Recurse argo\skills\dashscope-media-generator  <目标>/argo/skills/
Copy-Item -Recurse argo\skills\qwen3-vl-visual-inspection <目标>/argo/skills/
Copy-Item tests\media-artist-actor.test.js                 <目标>/tests/
\`\`\`

### 2. 合并图谱片段（通过 ARGO MCP，禁止直接编辑 JSON）
在目标项目中，通过 ARGO MCP 依次执行：

\`\`\`
addArchitectureView {
  view: {
    view_id: "media-team-001",
    view_name: "媒体创作团队",
    parent_element_id: "1962",
    description: "负责图片与视频生成任务的团队视图。"
  }
}

addArchitectureElement { element: <package.json.elements[0]>, view_ids: ["media-team-001"] }
addArchitectureElement { element: <package.json.elements[1]>, view_ids: ["media-team-001"] }
addArchitectureElement { element: <package.json.elements[2]>, view_ids: ["media-team-001"] }
addArchitectureElement { element: <package.json.elements[3]>, view_ids: ["media-team-001"] }

addArchitectureRelationship { relationship: <package.json.relationships[0]>, view_ids: ["media-team-001"] }
addArchitectureRelationship { relationship: <package.json.relationships[1]>, view_ids: ["media-team-001"] }
addArchitectureRelationship { relationship: <package.json.relationships[2]>, view_ids: ["media-team-001"] }
\`\`\`

或用 \`applySystemArchitectureMutation\` 一次性原子提交全部 mutation。

> 若目标项目已有同名元素/关系/视图（id 冲突），请先删除或改 id。

### 3. 登记 agent 属性
\`\`\`
updateArchitectureElement {
  id: "media-artist-001",
  patch: { attributes: [{ name: "agent", value: "media-artist" }] }
}
\`\`\`

### 4. 运行验收测试
\`\`\`powershell
node --test tests/media-artist-actor.test.js
\`\`\`

### 5. 校验图谱
\`\`\`
validateSystemArchitecture
\`\`\`

## 凭据说明
图像生成与视觉验收均需 \`argo/.env\` 中的 \`QWEN_KEY\`（阿里云 DashScope）。目标项目需自行配置，包内不含任何密钥。
`;
}

function main() {
  mkdirp(OUT_DIR);
  const pkg = buildGraphFragment();
  fs.writeFileSync(path.join(OUT_DIR, 'media-artist.package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'README-IMPORT.md'), buildReadme(pkg), 'utf8');
  copy('argo/agents/media-artist.agent.md', 'argo/agents/media-artist.agent.md');
  copy('argo/skills/dashscope-media-generator/SKILL.md', 'argo/skills/dashscope-media-generator/SKILL.md');
  copy('argo/skills/qwen3-vl-visual-inspection/SKILL.md', 'argo/skills/qwen3-vl-visual-inspection/SKILL.md');
  copy('tests/media-artist-actor.test.js', 'tests/media-artist-actor.test.js');
  console.log('package written to:', OUT_DIR);
  const entries = [];
  function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) walk(full);
      else entries.push(path.relative(OUT_DIR, full));
    }
  }
  walk(OUT_DIR);
  console.log(entries.join('\n'));
}

main();

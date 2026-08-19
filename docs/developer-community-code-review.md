# ArchGraph 开发者社区 — 代码检视报告

> 工作包：开发者社区开发交付（2751）
> 检视对象：Developer（Xiaoming）提交 8c02b85（发布辅助与导入校验脚本）
> 评审人：Reviewer（adam，sessionId 4080fecb-0190-488c-83d7-9bc2c9cf72ba）

## 检视对象

- `scripts/developer-community-publish.js`（scanSensitiveInfo 敏感扫描 + generatePostTemplate 帖子模板 + CLI）
- `scripts/developer-community-validate.js`（validateSubgraph 格式/大小校验 + CLI）
- `tests/developer-community.test.js`（11 项测试，已本地回归，11/11 通过）

## 结论

**需修改**。架构分层与模块职责清晰、测试覆盖良好，但存在 1 项高危二次泄露问题（脱敏工具自身把命中的敏感值原样打印到输出）与若干安全/健壮性缺陷，需修复后复检。

## 架构检视结果

1. **模块划分清晰**：发布辅助与导入校验各自成文件，`scanSensitiveInfo → walk/checkField`、`validateSubgraph` 职责单一，`main()` 与可复用导出函数（`module.exports`）分离，符合方案设计的交付物清单。
2. **脱敏清单覆盖**：对照贡献指南「发布前脱敏检查清单」五项，扫描器覆盖其中四项（密钥/token/密码、内部绝对路径、commit 详情、个人信息），**「内部备注」未覆盖**（属启发式难点，可接受，但应在指南/脚本输出中明示该辅助脚本为「辅助」而非「必做」的兜底）。
3. **格式校验覆盖不足**：`validateSubgraph` 仅校验顶层 `elements/relationships/views` 为数组，**未校验数组内条目结构**（element 的 `id/name/type`、relationship 的 `source_id/target_id/type`、view 的 `view_id/included_elements` 等，均与 `export-to-kg.js` 导出格式不符）。含 `elements: [null, "x"]` 的子图仍会通过校验，未达到「符合 export-to-kg.js 导出格式」的设计约定。
4. **CLI 设计合理**：usage 提示、退出码（0 通过 / 1 校验失败 / 2 用法或读文件错误）区分明确，sizeLimit 入参经 `Number.isFinite && > 0` 校验后回退默认值。
5. **错误处理不完整**：两脚本的 `JSON.parse`/`readFileSync` 均已 try/catch，但 publish 的 `scanSensitiveInfo`（递归 walk）与 validate 的 `JSON.stringify`（在 `validateSubgraph` 内）**未纳入异常保护**，遇超深嵌套会以未捕获 RangeError 崩溃。

## 安全性检视结果

### 高危

- **S1（二次泄露，最严重）**：`developer-community-publish.js` `main()` 在命中时执行 `console.error(`- [${hit.type}] ${hit.path}: ${hit.value}`)`，**将命中的敏感原文（token、密码、邮箱、绝对路径等）原样输出到 stderr**。脱敏工具的作用是阻止密钥泄露，但其自身把密钥复写进终端/日志（CI 日志、`tee`、问题截图等场景即构成二次泄露），与目标自相矛盾。必须脱敏展示（如仅输出 `type` + `path`，或对 `value` 打码如 `sk-1234****`）。

### 中危

- **S2（大小校验时序错误，DoS 风险）**：`validate.js` 先 `readFileSync` 全量读入再 `JSON.parse`，最后才在 `validateSubgraph` 内做大小校验。恶意/超大文件会在大小上限生效前耗尽内存（OOM）。应在读取前用 `fs.statSync` 检查文件字节数并提前拒绝。
- **S3（深遍历栈溢出，DoS 风险）**：`walk` 为无深度上限的递归，超深嵌套 JSON 会触发 `Maximum call stack size exceeded`（未捕获）；validate 的 `JSON.stringify` 同理。应改用迭代遍历或加最大深度保护。
- **S4（敏感扫描易被绕过）**：
  - 凭据键名仅匹配 `token/password/secret/api[-_]?key/credential/pwd` 等，**漏掉** `private_key`、`access_key`、`connection`/`connectionString`、`auth`、`bearer`、`jwt` 等常见凭据键；
  - 凭据值 `CREDENTIAL_VALUE_PATTERN` 仅按已知前缀（`sk/pk/AKIA/ghp/xox/eyJ…`）且部分大小写敏感（`AKIA`），**漏掉** base64 编码值、拼接值、无已知前缀的通用密码；
  - 绝对路径**漏掉**环境变量风格（`$HOME`、`%USERPROFILE%`、`~/`）、Git Bash 风格（`/c/Users/`）、以及 `/data`、`/apps`、`/projects` 等不在白名单内的绝对路径；
  - commit 仅识别 40 位十六进制，漏掉短哈希与分支名；phone 仅识别 11 位数字，漏掉 `+86`/分隔符格式，且对任意 11 位数字串产生误报。
  - 上述为启发式「辅助」能力，可接受，但应（a）扩充常见模式，（b）在输出/文档中明确提示「扫描通过 ≠ 绝对安全，须仍按清单人工核对」。

### 低危 / 已确认安全

- **原型污染**：`validateSubgraph` 仅做只读校验、无对象合并/赋值，`JSON.parse` 的 `__proto__` 为普通自有属性，不构成原型污染。安全。
- **大小单位**：`Buffer.byteLength(JSON.stringify(obj), 'utf8')` 以**字节**计，单位正确（非字符数）。备注：测得的是重新序列化后的大小，与磁盘原始文件字节存在微小差异（含空白/缩进时偏小），建议以 `statSync` 的磁盘大小为准（见 S2）。
- **CLI 文件读取异常**：路径不存在、非 JSON 均已捕获并输出可读错误，错误信息不含文件内容，无泄露。安全。
- **`generatePostTemplate`**：作者取自 `GITHUB_ACTOR/USER/USERNAME`（仅用户名，非密钥），无泄露。安全。

## 问题清单与修改建议（反馈 Developer Xiaoming）

| 编号 | 级别 | 位置 | 问题 | 修改建议 |
| --- | --- | --- | --- | --- |
| S1 | 高 | publish.js:117-121 | 命中敏感值原文打印到 stderr，二次泄露 | 仅输出 `type`+`path`，对 `value` 打码（保留前 4 位 + `****`） |
| S2 | 中 | validate.js:44-52 | 先读入并解析、后校验大小，超大文件 OOM | 读取前 `fs.statSync(filePath).size` 校验，超限直接拒绝 |
| S3 | 中 | publish.js:22-40 / validate.js:23 | 无深度上限递归 + `JSON.stringify` 深嵌套栈溢出 | 迭代遍历或加最大深度（如 10000）保护并捕获 RangeError |
| S4 | 中 | publish.js:6-14 | 敏感模式覆盖不全、易绕过 | 扩充键名（private_key/access_key/connection/auth/bearer/jwt）、值（base64、大小写）、路径（`$HOME`/`%VAR%`/`~/`/`/c/`）、commit（短哈希）；输出明示「辅助性质」 |
| A1 | 中 | validate.js:17-21 | 仅校验顶层字段为数组，未校验条目结构 | 增加元素（id/name/type）、关系（source_id/target_id/type）、视图（view_id）结构校验 |
| A2 | 低 | 两脚本 | 扫描/字符串化未纳入异常保护 | 将 `scanSensitiveInfo`/`JSON.stringify` 纳入 try/catch，输出友好错误 |
| A3 | 低 | 指南/输出 | 「内部备注」无启发式覆盖 | 输出中提示该项需人工核对 |

> 说明：S4 属「辅助」启发式，可结合 A3 以文档/提示缓解；S1 为本次必须修复项，S2/S3/A1 建议一并修复后复检。

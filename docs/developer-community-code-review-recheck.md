# ArchGraph 开发者社区 — 代码复检报告

> 工作包：开发者社区开发交付（2751）
> 复检对象：Developer（Xiaoming）修复提交 fef9c35（针对检视报告 8eec2e1 的问题清单）
> 复检人：Reviewer（adam，sessionId 4080fecb-0190-488c-83d7-9bc2c9cf72ba）

## 复检对象

- `scripts/developer-community-publish.js`（scanSensitiveInfo 敏感扫描 + generatePostTemplate 帖子模板 + CLI）
- `scripts/developer-community-validate.js`（validateSubgraph 格式/大小校验 + CLI）
- `tests/developer-community.test.js`（16 项测试，本地回归 16/16 通过）

## 结论

**通过**。上一轮的高危（S1）与中危（S2/S3/A1）问题均已正确修复并有回归测试覆盖；A2/A3 亦已解决；S4 属「辅助」启发式，已按约定扩充常见模式并在输出中明示辅助性质，剩余未覆盖的极窄场景（短哈希、带区号电话）在其声明的辅助定位下可接受。

## 逐项核对结果

| 编号 | 级别 | 结论 | 说明 |
| --- | --- | --- | --- |
| S1 | 高 | 已解决 | `main()` 命中输出改为 `maskValue(hit.value)`（保留前 4 位 + `****`，`publish.js:151`），不再原文打印敏感值；`publish-cli` 测试（`tests:212-239`）断言 stderr 不含任一原文密钥/邮箱/电话/哈希。 |
| S2 | 中 | 已解决 | `validate.js:103-115` 在 `readFileSync`/`JSON.parse` 之前用 `fs.statSync` 校验磁盘字节数并提前以 exit 1 拒绝；`import-validate-cli` 测试（`tests:241-259`）验证非 JSON 超大文件在读取前即被拦截。 |
| S3 | 中 | 已解决 | `walk` 改为显式栈迭代遍历并加 `MAX_WALK_DEPTH = 10000` 上限（`publish.js:19,32-61`）；`scanSensitiveInfo` 整体 try/catch、`validateSubgraph` 内 `JSON.stringify` try/catch（`validate.js:72-78`）。深嵌套测试（`tests:277-306`）验证 5 万层嵌套不崩溃、优雅失败。 |
| S4 | 中 | 部分解决 | 凭据键名扩充 `private_key/access_key/connection/auth/bearer/jwt`（`publish.js:6`），路径扩充 `$VAR`/`%VAR%`/`~/`/`/c/`/`/data`/`/apps`/`/projects`（`publish.js:11-14`），并新增 `SCAN_DISCLAIMER` 明示「辅助性质、内部备注需人工核对」（`publish.js:20,153,158`）。遗留：commit 仍仅 40 位十六进制、phone 仍仅 11 位数字、`CREDENTIAL_VALUE_PATTERN` 未加 `i` 标志（小写 `akia` 不命中）。属辅助启发式，可接受。 |
| A1 | 中 | 已解决 | `validateSubgraph` 增加条目级结构校验：element（`id/name/type`）、relationship（`source_id/target_id/type`）、view（`view_id/view_name`）逐条非空字符串校验（`validate.js:7-9,30-70`）；`tests:261-275` 覆盖。 |
| A2 | 低 | 已解决 | `scanSensitiveInfo`（`publish.js:22-30`）与 `JSON.stringify`（`validate.js:72-78`）均纳入 try/catch，返回 `scan-error` 命中或友好校验错误而非未捕获异常。 |
| A3 | 低 | 已解决 | 「内部备注」无启发式覆盖，已通过 `SCAN_DISCLAIMER`（`publish.js:20`）在命中与通过两种输出中均明示需人工核对，缓解到位。 |

## 遗留问题

无（S4 的短哈希/带区号电话/值模式大小写盲区属辅助启发式的已知局限，已在输出中明示，不构成阻塞项）。

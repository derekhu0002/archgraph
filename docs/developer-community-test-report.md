# ArchGraph 开发者社区 — 测试验证报告

> 工作包：开发者社区开发交付（2751）
> 验证人：chenlin（验证测试工程师）
> sessionId：227b990c-c703-4283-a1f5-368672587ecb

## 1. 验证对象

- 设计文档：`docs/developer-community-design.md`
- 需求文档：`docs/developer-community-requirements.md`
- 贡献指南：`docs/developer-community-guide.md`
- 发布辅助脚本：`scripts/developer-community-publish.js`
- 下载校验脚本：`scripts/developer-community-validate.js`
- 验收测试：`tests/developer-community.test.js`

## 2. 测试运行结果

命令：`node --test tests/developer-community.test.js`

```
ℹ tests 16
ℹ pass 16
ℹ fail 0
ℹ skipped 0
```

- 通过数：16
- 失败数：0
- 结论：全部通过。

## 3. CLI 实跑结果

| 场景 | 命令 | 结果 |
| --- | --- | --- |
| 发布脚本无参数 | `node scripts/developer-community-publish.js` | 打印 `Usage: node scripts/developer-community-publish.js <subgraph.json>`，退出码 2 |
| 校验脚本无参数 | `node scripts/developer-community-validate.js` | 打印 `Usage: node scripts/developer-community-validate.js <subgraph.json> [sizeLimitBytes]`，退出码 2 |
| 发布含敏感信息 JSON | `node scripts/developer-community-publish.js <临时文件>` | 命中即告警，退出码 1；敏感值打码展示（如 `sk-1****`、`pass****`、`1380****`），未泄露原文 |
| 校验缺 `views` JSON | `node scripts/developer-community-validate.js <临时文件>` | 判 invalid（`missing required array field 'views'`），退出码 1 |

说明：临时 JSON 均置于系统临时目录，测试后已删除，未留在仓库。

## 4. 验收用例逐项核对

| 用例 | 验收内容 | 对应测试 | 结果 | 依据 |
| --- | --- | --- | --- | --- |
| AT-2751-01 需求文档 | 需求文档含用户场景与用户故事（「作为一个开发者」表述） | `requirements-ready` | 通过 | 断言 `用户场景`、`用户故事`、`作为一个开发者` 均匹配，测试通过 |
| AT-2751-02 GIVEN-WHEN-THEN | 验收标准采用 GIVEN-WHEN-THEN，覆盖浏览/发布/详情/下载/讨论 | `requirements-acceptance` | 通过 | 断言 `GIVEN`/`WHEN`/`THEN` 及 `浏览`/`发布`/`详情`/`下载`/`评论` 均匹配，测试通过 |
| AT-2751-03 GitHub Discussions | 文档要求采用 GitHub Discussions（零成本、零运维），不自研 | `requirements-github-discussions` | 通过 | 断言 `GitHub Discussions`、`零成本`、`不自研` 均匹配，测试通过 |
| AT-2751-04 发布前脱敏 | 敏感信息被脱敏或发布被拦截（命中即告警） | `requirements-desensitization`、`publish-scan` ×2、`publish-cli` | 通过 | 指南含脱敏清单；扫描命中凭据/绝对路径/个人信息/commit；干净子图无命中；CLI 打码且退出码 1 |
| AT-2751-05 下载导入格式校验 | 子图 JSON 通过格式与大小上限校验，不符则拒绝导入 | `requirements-import-validation`、`import-validate` ×4、`import-validate-cli` | 通过 | 指南要求格式校验/大小上限/拒绝导入；缺 `views`、超限、缺字段、深层嵌套均判 invalid；合规子图判 valid |

## 5. 最终结论

**通过**。验收测试 16/16 通过（0 失败），五条验收用例（AT-2751-01~05）均被 `tests/developer-community.test.js` 覆盖且通过；两个脚本 CLI 实跑行为符合预期（无参数打印用法、敏感信息打码、缺 `views` 判 invalid 并均以非零码退出）。

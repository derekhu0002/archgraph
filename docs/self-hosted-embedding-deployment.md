# 内网自建 Embedding 部署指南（Self-hosted Embedding Server）

> 本文件是便于交付/运维的仓库副本；**权威来源**为意图图（KG）元素
> `offline-embedding-deployment-001`。相关框架能力见组件
> `configurable-embedding-provider-001`。
>
> 适用场景：内网无法直接访问云端 embedding 服务（或不愿依赖云端），希望在本机
> 自建一个 OpenAI 兼容的 embedding 端点，供 ArchGraph 的语义检索使用。
> 内网可联网（可经代理）下载依赖与模型；**不使用容器**，纯原生运行。

---

## 1. 工作原理

ArchGraph 的语义检索分两层：**向量索引在 Neo4j 内**（原生 vector index，cosine），
**嵌入计算走 HTTP**。云端方案把嵌入指向阿里云百炼；本方案把嵌入指向本机自建服务，
索引维度与写入/查询协议保持不变。

```
defaultSemanticRetrieval
   │  resolveApprovedLiveConfiguration  (ARGO_EMBEDDING_PROFILE=openai-compatible)
   ▼
createLiveEmbeddingProviderClient
   │  POST {ARGO_EMBEDDING_BASE_URL}/embeddings
   │  body { input, model, dimensions }   ← 查询侧自动加 ARGO_EMBEDDING_QUERY_INSTRUCTION
   ▼
自建服务 (FastAPI + sentence-transformers, CPU)
   │  返回 { data:[{ embedding:[...1536] }] }
   ▼
Neo4j vector index (cosine, 1536)
```

要点：

- 协议是 **OpenAI 兼容** `POST /v1/embeddings`：请求 `{input, model, dimensions}`，
  响应 `data[].embedding`。
- **文档侧**（建索引）用策展文本原样嵌入；**查询侧**才加指令前缀。指令前缀用于
  gte-Qwen2 这类 instruction 模型，配置在 `ARGO_EMBEDDING_QUERY_INSTRUCTION`。
- 维度锁定 **1536**（`ARGO_EMBEDDING_DIMENSIONS`）；它与 Neo4j 向量索引维度一致。

---

## 2. 前置条件

| 项 | 要求 |
|---|---|
| 操作系统 | Windows（脚本为 PowerShell 5.1+）。Linux/macOS 参照「附录 A 手动步骤」 |
| Python | **3.10 – 3.12**（3.12 已验证；**3.14 无 PyTorch 轮子**，不可用） |
| Node.js | ≥ 18（仅用于 `probe`/`verify` 脚本；框架本身也需要） |
| ArchGraph 框架 | **需包含提交 `44e2739`（openai-compatible profile）的构建**；npm `archgraph-argo@0.23.0` 尚未包含该特性，请使用本仓库或后续发布版 |
| Neo4j | 框架既有实例（支持向量索引，Neo4j ≥ 5.11） |
| 网络 | 可联网，必要时经代理；HF 直连慢/被墙时用镜像 `https://hf-mirror.com` |
| 硬件 | CPU 可跑（1.5B 模型约需 6 GB 内存）；显存非必需 |

---

## 3. 文件清单

均位于 `sandbox/local-embedding/`：

| 文件 | 作用 |
|---|---|
| `server.py` | FastAPI 服务：`POST /v1/embeddings`、`GET /health` |
| `requirements.txt` | 钉版依赖（`transformers==4.44.2` 等） |
| `setup.ps1` | **一键引导**：建 venv → 装依赖 → 装 `flash_attn` CPU stub → 下载模型 |
| `run_server.ps1` | 启动服务（离线、512 token、`127.0.0.1:8080`） |
| `stop.ps1` | 停止服务（按端口） |
| `download_model.py` | 下载模型（可续传、自动重试） |
| `probe.ps1` / `probe_http.js` | 验证 OpenAI 协议与向量维度/语义健全性 |
| `verify_framework_client.js` | 验证**框架真实 client + `openai-compatible` profile** 端到端 |
| `eval_local_vs_cloud.js` / `eval-report.json` | 召回 A/B 评测（同 golden set 对比云端） |

---

## 4. 快速开始

在仓库根目录执行（或先 `cd sandbox\local-embedding`）：

### 4.1 一键引导

```powershell
# 有代理（并走 HF 镜像）：
powershell -ExecutionPolicy Bypass -File .\setup.ps1 `
    -Proxy http://127.0.0.1:7890 -HfEndpoint https://hf-mirror.com

# 能直连 huggingface.co 时：
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

`setup.ps1` 是幂等的，可重复执行。常用参数：`-PythonExe`（指定 Python 3.10–3.12）、
`-PipIndex`（内网 pip 镜像）、`-SkipModel`（只建环境）。

> 首次会下载约 7 GB 权重到 `sandbox/local-embedding/hf/`。若下载中断，直接重跑
> `setup.ps1`（`download_model.py` 会续传）。

### 4.2 启动服务

```powershell
# 前台：
powershell -ExecutionPolicy Bypass -File .\run_server.ps1

# 或后台：
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','.\run_server.ps1' -WindowStyle Hidden
```

### 4.3 健康检查

```powershell
Invoke-WebRequest http://127.0.0.1:8080/health -UseBasicParsing
# => {"status":"ok","model":"Alibaba-NLP/gte-Qwen2-1.5B-instruct","dimensions":1536}
```

---

## 5. 配置 ArchGraph

编辑 `~/.argo/.env`（Windows：`%USERPROFILE%\.argo\.env`）：

```dotenv
# --- 自建 embedding profile ---
ARGO_EMBEDDING_PROFILE=openai-compatible
ARGO_EMBEDDING_BASE_URL=http://127.0.0.1:8080/v1
ARGO_EMBEDDING_MODEL=Alibaba-NLP/gte-Qwen2-1.5B-instruct
ARGO_EMBEDDING_PROVIDER=self-hosted-openai-compatible
ARGO_EMBEDDING_MODEL_VERSION=local-2026-09-19
ARGO_EMBEDDING_DIMENSIONS=1536
# 指令前缀：单行 .env 里用 \n 转义，框架会解码成真正的换行；只作用于查询侧
ARGO_EMBEDDING_QUERY_INSTRUCTION=Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:
# 自建端点通常不校验鉴权；给占位值即可
ARGO_EMBEDDING_API_KEY=local-placeholder
QWEN_KEY=local-placeholder

# --- Neo4j（沿用既有值）---
ARGO_NEO4J_DATABASE_URL=neo4j://127.0.0.1:7687
ARGO_NEO4J_DATABASE_USERNAME=neo4j
ARGO_NEO4J_DATABASE_PASSWORD=<your-password>
```

注意：

- `QWEN_KEY` 是**预检必填项**（即便本地端点不用它），放非空占位值即可。
- `.env` 仍须满足框架的 ACL 预检：文件在 git 中被忽略且未跟踪、当前用户可读、
  `Everyone`/`BUILTIN\Users` 等无读权限；只允许白名单键。
- 改 `.env` 后**必须重启宿主/MCP 进程**（运行中的 MCP 会缓存配置），再执行下一步。

---

## 6. 重建语义索引

provider/model/version 变化后，已持久化的语义记录与当前配置不匹配，需要**重新嵌入**
以刷新索引与 readiness（维度不变，无需改索引结构）。

1. 重启宿主/MCP 进程（加载新 `.env`）。
2. 运行 `argo-init`（初始化工作区 / 语义生命周期），触发全量语义回填。
3. 确认语义生命周期达到 `Aligned`。

重建完成后，检索即使用本地模型产出的向量。

---

## 7. 验证

```powershell
# 协议 + 维度 + 语义健全性 + 框架 client 端到端
powershell -ExecutionPolicy Bypass -File .\probe.ps1
```

预期：

- `/health` 返回 `dimensions: 1536`；
- 相关文本 cosine 明显高于不相关文本；
- `framework client vector length: 1536`。

随后可在 MCP 侧做一次语义检索（如 `memory_search` / `getSystemArchitecture`）确认可用。

---

## 8. 已知权衡（召回对比）

同 golden set（705 查询）、同策展嵌入文本、精确 per-channel cosine 的 A/B：

| 指标 | 云端 qwen3.7 | 本地 gte-Qwen2-1.5B | Δ |
|---|---|---|---|
| ALL recall@1 | 95.3 | **93.6** | −1.7 |
| ALL recall@5 | 99.6 | 99.1 | −0.5 |
| ALL MRR | 0.973 | 0.959 | −0.014 |
| name recall@1 | 92.9 | 89.5 | −3.4 |
| desc recall@1 | 98.9 | **99.6** | **+0.7** |
| Element recall@1 | 93.7 | 93.3 | −0.4 |
| Relationship recall@1 | 100 | 99.0 | −1.0 |
| **View recall@1** | 98.1 | **89.7** | **−8.4** |

结论：本地模型可用，但相对云端存在**真实召回退化**，主要缺口在 **View** 与 **name**；
`desc` 反而略优。已核实 View 文本都很短，故缺口是模型质量而非截断（**已知并接受**，
2026-09-19 人类裁决）。若要缩窄缺口，可选：启用 hybrid（向量+BM25，无需新模型，
利好 name）、二阶段 rerank（需本地 reranker）、或换更强模型。

---

## 9. 回滚

把 `.env` 改回云端 approved profile，重启 MCP，再跑一次 `argo-init`：

```dotenv
ARGO_EMBEDDING_PROFILE=approved
```

`approved` 为默认值，也可直接删除 `ARGO_EMBEDDING_PROFILE` 行。

---

## 10. 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `pip install torch` 找不到轮子 | Python 版本过新（3.14 无 torch 轮子）→ 用 3.10–3.12；`setup.ps1 -PythonExe <path>` |
| 报 `'DynamicCache' object has no attribute 'get_usable_length'` | gte-Qwen2 远程码与新版 transformers 不兼容 → 必须 `transformers==4.44.2`（已在 `requirements.txt` 钉死） |
| 报缺少 `flash_attn` | CUDA-only 包被静态 import → `setup.ps1` 已装 CPU stub；若手建 venv 需补 `flash_attn` stub |
| 下载 huggingface.co 超时 | 用代理 `-Proxy`，或镜像 `-HfEndpoint https://hf-mirror.com` |
| 大文件下载中断 | 重跑 `setup.ps1` 续传；不要启用 `hf_transfer`（不支持续传） |
| 首次请求很慢 | 模型加载 + 首次前向；`EMBED_MAX_SEQ` 默认 512 以控 CPU 时延 |
| `.env` 被拒（ACL / unknown key） | 修 ACL（去 Everyone/Users 读权限、保持 ignored+untracked）；只用白名单键 |
| 检索仍走云端 | 未重启 MCP，或 `ARGO_EMBEDDING_PROFILE` 未生效；重启后再跑 `argo-init` |
| 改配置后向量没更新 | 未重建索引；运行 `argo-init` 直到 `Aligned` |

---

## 11. 配置参考

| 变量 | 取值 | 说明 |
|---|---|---|
| `ARGO_EMBEDDING_PROFILE` | `approved`（默认）/ `openai-compatible` | 选 `openai-compatible` 才读取下列自建端点值 |
| `ARGO_EMBEDDING_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI 兼容端点，无尾斜杠 |
| `ARGO_EMBEDDING_MODEL` | `Alibaba-NLP/gte-Qwen2-1.5B-instruct` | 须 1536 维 |
| `ARGO_EMBEDDING_PROVIDER` | `self-hosted-openai-compatible` | 记录在证据中的标签 |
| `ARGO_EMBEDDING_MODEL_VERSION` | `local-2026-09-19` | 版本/限定标签（仅证据） |
| `ARGO_EMBEDDING_DIMENSIONS` | `1536` | 与向量索引一致 |
| `ARGO_EMBEDDING_QUERY_INSTRUCTION` | 指令前缀（单行，`\n` 转义） | 仅查询侧；文档侧不加 |
| `ARGO_EMBEDDING_API_KEY` | 占位/可选 | 作为 Bearer；缺省回落 `QWEN_KEY` |
| `QWEN_KEY` | 占位 | 预检必填；本地端点不用 |
| `EMBED_MODEL_ID` / `EMBED_MAX_SEQ` | 服务端环境变量 | 覆盖模型 / 最大序列长度（默认 512） |

---

## 附录 A：手动步骤（等价于脚本）

```powershell
# 1) venv（用 Python 3.12）
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2) flash_attn CPU stub（写入 .venv\Lib\site-packages\flash_attn\）
#    __init__.py / bert_padding.py   —— 见 setup.ps1 中的内容

# 3) 下载模型（可加代理 / 镜像）
$env:HF_HOME = "$PWD\hf"
$env:HF_ENDPOINT = "https://hf-mirror.com"
.\.venv\Scripts\python.exe download_model.py

# 4) 启动
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8080
```

服务端环境变量：`HF_HOME`、`HF_HUB_OFFLINE=1`、`EMBED_MODEL_ID`、`EMBED_MAX_SEQ`。

#!/usr/bin/env python3
"""LightRAG MCP server — exposes lightrag_query / lightrag_insert over MCP stdio.

Runs inside the sandbox container. Config comes from the environment (the mounted
argo/.env loaded by smoke.js into process.env, inherited by this server):
  DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL   -> LLM (DeepSeek)
  QWEN_KEY / ARGO_EMBEDDING_BASE_URL / ARGO_EMBEDDING_MODEL -> embedding (QWEN)

Key integration notes (LightRAG 1.5.6):
  * embedding dim is hardcoded 1536 by LightRAG -> QWEN must output 1536 via
    `openai_embed(..., embedding_dim=1536)` (QWEN supports the `dimensions` param).
  * EmbeddingFunc wrapper + vector_db_storage_cls_kwargs={"dim":1536} must match.
"""
import os
import sys
import re
import asyncio

# ── MCP transport safety: keep fd-1 stdout clean (JSON-RPC frames only) ──────
# LightRAG's llm/openai.py uses pipmaster (pm.is_installed -> pm.install), which
# shows an ascii_colors spinner ("Updating package: openai") on STDOUT — that
# corrupts the MCP stdio framing. openai is pre-installed in the image, so:
#   * neutralise pipmaster: never check/install at runtime,
#   * force any ascii_colors progress bar to stderr as a belt-and-suspenders.
def _neutralise_pipmaster():
    try:
        import pipmaster as _pm
        _pm.is_installed = lambda pkg, *a, **k: True  # all deps pre-installed
        _pm.install = lambda *a, **k: None            # never pip-install at runtime
    except Exception:
        pass


def _ascii_colors_progress_to_stderr():
    try:
        from ascii_colors import progress as _acp
        _orig_init = _acp.ProgressBar.__init__

        def _safe_init(self, *a, **k):
            k['file'] = sys.stderr
            _orig_init(self, *a, **k)

        _acp.ProgressBar.__init__ = _safe_init
    except Exception:
        pass


_neutralise_pipmaster()
_ascii_colors_progress_to_stderr()

from mcp.server.fastmcp import FastMCP

from lightrag import LightRAG, QueryParam
from lightrag.base import EmbeddingFunc
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import wrap_embedding_func_with_attrs

# Fallback: if the spawning process filtered our env (the mcp SDK and some MCP
# hosts forward only an allowlist), load the keys from the mounted argo/.env.
_ENV_FILE = os.environ.get('LIGHTRAG_ENV_FILE', '/env/argo.env')
if not os.environ.get('DEEPSEEK_API_KEY') or not os.environ.get('QWEN_KEY'):
    try:
        with open(_ENV_FILE, encoding='utf-8', errors='replace') as _f:
            for _line in _f.read().splitlines():
                _m = re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$', _line)
                if _m:
                    os.environ.setdefault(_m.group(1), _m.group(2).strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass

WORKING = os.environ.get('LIGHTRAG_WORKING_DIR', '/opt/lightrag/rag_storage')
DEEPSEEK_MODEL = os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')
DEEPSEEK_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
DEEPSEEK_URL = os.environ.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')
QWEN_KEY = os.environ.get('QWEN_KEY', '')
QWEN_URL = os.environ.get('ARGO_EMBEDDING_BASE_URL', '')
QWEN_MODEL = os.environ.get('ARGO_EMBEDDING_MODEL', 'qwen3.7-text-embedding')

# Some LightRAG code paths (e.g. the default OpenAI-compatible client helper in
# llm/openai.py) read OPENAI_API_KEY straight from the environment when no
# api_key arg is passed. Point those at DeepSeek too so no call ever KeyErrors
# on a missing OPENAI_API_KEY.
os.environ.setdefault('OPENAI_API_KEY', DEEPSEEK_KEY)
os.environ.setdefault('OPENAI_BASE_URL', DEEPSEEK_URL)

# Neo4j 作为 LightRAG 的图存储（Neo4JStorage）：复用宿主 Neo4j 实例，但用独立库
# 'lightrag'（与 archgraph/sandbox 库隔离，存的是 LightRAG 自己抽取的实体/关系图）。
# 容器内经 host.docker.internal 访问宿主；Neo4JStorage 会自动 CREATE DATABASE IF NOT EXISTS
# （宿主为 Enterprise，支持多库）。
_N4J_RAW_URL = os.environ.get('ARGO_NEO4J_DATABASE_URL', 'neo4j://127.0.0.1:7687') \
    .replace('127.0.0.1', 'host.docker.internal') \
    .replace('localhost', 'host.docker.internal')
os.environ.setdefault('NEO4J_URI', _N4J_RAW_URL)
os.environ.setdefault('NEO4J_USERNAME', os.environ.get('ARGO_NEO4J_DATABASE_USERNAME', 'neo4j'))
os.environ.setdefault('NEO4J_PASSWORD', os.environ.get('ARGO_NEO4J_DATABASE_PASSWORD', ''))
os.environ.setdefault('NEO4J_DATABASE', 'lightrag')

print(f'[LIGHTRAG-MCP-START] DEEPSEEK_KEY={len(DEEPSEEK_KEY)} '
      f'OPENAI_API_KEY={bool(os.environ.get("OPENAI_API_KEY"))} '
      f'QWEN_KEY={bool(QWEN_KEY)} NEO4J_URI={os.environ.get("NEO4J_URI", "")} '
      f'NEO4J_DATABASE={os.environ.get("NEO4J_DATABASE", "")}', file=sys.stderr, flush=True)

mcp = FastMCP('lightrag')

_rag = None
_ready = False


async def llm(prompt, system_prompt=None, history_messages=None, keyword_extraction=False, **kwargs):
    return await openai_complete_if_cache(
        DEEPSEEK_MODEL, prompt, system_prompt=system_prompt,
        history_messages=history_messages, base_url=DEEPSEEK_URL, api_key=DEEPSEEK_KEY, **kwargs)


@wrap_embedding_func_with_attrs(embedding_dim=1536, max_token_size=8192)
async def embed(texts):
    return await openai_embed(texts, model=QWEN_MODEL, base_url=QWEN_URL,
                              api_key=QWEN_KEY, embedding_dim=1536)


def get_rag():
    global _rag
    if _rag is None:
        os.makedirs(WORKING, exist_ok=True)
        _rag = LightRAG(
            working_dir=WORKING,
            llm_model_func=llm,
            embedding_func=EmbeddingFunc(embedding_dim=1536, max_token_size=8192, func=embed),
            vector_db_storage_cls_kwargs={'dim': 1536},
            # 图存储用 Neo4j（Neo4JStorage）：实体/关系存到宿主 Neo4j 独立库 'lightrag'，
            # 而非默认的 GraphML 文件（graph_chunk_entity_relation.graphml）。
            # 1.5.6 的字段名是 graph_storage（字符串，经 get_storage_class 解析），
            # 不是 graph_storage_cls（那在 __init__ 里派生，不接受构造参数）。
            graph_storage='Neo4JStorage',
            llm_model_name=DEEPSEEK_MODEL,
            # JSON extraction: DeepSeek outputs clean JSON, which the row-based
            # default extraction format parses poorly (observed: 1 stray entity,
            # 0 relations). JSON mode requests response_format=json_object and
            # parses {"entities":[...],"relationships":[...]} reliably.
            entity_extraction_use_json=True,
            addon_params={'language': 'en'},
        )
    return _rag


async def ensure_ready():
    global _ready
    rag = get_rag()
    if not _ready:
        await rag.initialize_storages()
        _ready = True


@mcp.tool()
async def lightrag_query(query: str, mode: str = 'hybrid') -> str:
    """Query LightRAG memory and return a grounded answer.

    Args:
        query: the question to answer from memory.
        mode: retrieval mode — hybrid (graph+keyword+vector), global, or local.
    """
    await ensure_ready()
    rag = get_rag()
    return str(await rag.aquery(query, param=QueryParam(mode=mode)))


@mcp.tool()
async def lightrag_insert(doc_id: str, content: str) -> str:
    """Index a document into LightRAG memory.

    Args:
        doc_id: a unique identifier for the document.
        content: the document text to index (entities/relations are extracted).
    """
    await ensure_ready()
    rag = get_rag()
    # ainsert(input, ids=...): the FIRST positional arg is the document CONTENT,
    # ids is the doc id. Passing (doc_id, content) backwards made LightRAG index
    # the doc_id string itself (extraction saw "probe" instead of the text).
    await rag.ainsert(content, ids=doc_id)
    return f'inserted {doc_id}'


if __name__ == '__main__':
    mcp.run()

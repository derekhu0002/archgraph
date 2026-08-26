#!/usr/bin/env python3
"""MCP client probe for the lightrag MCP server (sandbox).

Connects over stdio, lists tools, inserts a small probe document, queries it,
and prints a JSON summary. Exits 0 only if both tools exist and query returned
a non-empty answer (pipeline ran end-to-end).
"""
import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = '/opt/sandbox/lightrag-mcp.py'
# English probe content: LightRAG's entity/relation extraction runs in English
# (addon_params language='en'), so an English doc yields real entities + a chunk
# that hybrid retrieval can ground the answer on. The query must return '1249'.
PROBE_DOC = ('probe',
             'The ArchGraph knowledge graph contains element 1249 named '
             "'Implementation and Migration Viewpoint', of type Grouping, mounted "
             'under view 174. The project vision is to provide long-term memory '
             'for AI agents. The sandbox embeds via QWEN and answers via DeepSeek.')
PROBE_Q = 'What is the id of the Implementation and Migration Viewpoint element?'


async def main() -> int:
    # CRITICAL: the mcp SDK's get_default_environment() only forwards a small
    # allowlist of env vars (PATH/HOME/...) — it drops DEEPSEEK_*/QWEN_KEY etc.
    # Pass the full parent environment explicitly so the server sees the API keys.
    ok = False
    try:
        params = StdioServerParameters(command=sys.executable, args=[SERVER], env=dict(os.environ))
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = sorted(t.name for t in tools.tools)

                ins = await session.call_tool('lightrag_insert', {'doc_id': PROBE_DOC[0], 'content': PROBE_DOC[1]})
                ins_text = ''.join(p.text for p in ins.content if p.type == 'text')

                qres = await session.call_tool('lightrag_query', {'query': PROBE_Q, 'mode': 'hybrid'})
                q_text = ''.join(p.text for p in qres.content if p.type == 'text') if qres.content else ''

                grounded = '1249' in q_text  # query must actually retrieve the id
                summary = {
                    'tools': names,
                    'insert': ins_text,
                    'answer': q_text,
                    'has_answer': grounded,
                }
                print(json.dumps(summary, ensure_ascii=False), flush=True)

                ok = ('lightrag_insert' in names
                      and 'lightrag_query' in names
                      and grounded)
    except BaseException as e:  # noqa: BLE001 — cleanup may raise; still exit cleanly
        print(f'PROBE-ERROR: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))

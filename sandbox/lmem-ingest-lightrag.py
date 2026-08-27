#!/usr/bin/env python3
"""Insert the LongMemEval haystack docs into the lightrag MCP (B-side ingestion).

Connects to lightrag-mcp.py over stdio, reads /opt/lmem-selection.json and calls
lightrag_insert for every question's serialized haystack (one doc per question).
Exits 0 only if all inserts succeeded.

NOTE: env is passed explicitly — the mcp SDK forwards only an allowlist by
default (see test-lightrag-mcp.py for the same workaround).
"""
import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = '/opt/sandbox/lightrag-mcp.py'
SEL = os.environ.get('SEL_PATH', '/opt/lmem-selection.json')


async def main() -> int:
    docs = json.load(open(SEL, encoding='utf-8'))
    params = StdioServerParameters(command=sys.executable, args=[SERVER], env=dict(os.environ))
    ok = False
    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = sorted(t.name for t in tools.tools)
                if 'lightrag_insert' not in names:
                    print(f'NO_INSERT_TOOL tools={names}', file=sys.stderr, flush=True)
                    return 1
                ok = True
                for d in docs:
                    res = await session.call_tool('lightrag_insert', {'doc_id': d['doc_id'], 'content': d['haystack']})
                    txt = ''.join(p.text for p in res.content if p.type == 'text') if res.content else ''
                    print(f"insert {d['doc_id']} -> {txt}", flush=True)
                    if 'inserted' not in txt:
                        ok = False
    except BaseException as e:  # noqa: BLE001
        print(f'INGEST-ERROR: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        return 1
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))

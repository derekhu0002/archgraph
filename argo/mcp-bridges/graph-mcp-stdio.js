#!/usr/bin/env node
'use strict';

// graph-mcp stdio bridge for hosts that dial remote MCP servers over SSE GET
// and fail on Streamable HTTP-only endpoints (CURSOR remote url entries GET
// /mcp -> 404). This bridge translates stdio JSON-RPC lines into POST
// Streamable HTTP requests against GRAPH_MCP_URL so the remote graph-mcp
// server loads as an ordinary stdio MCP server.
//
// Deployed by install-argo.ps1 to ~/.cursor/mcp-bridges/graph-mcp-stdio.js
// and registered as:
//   "graph-mcp": { type: stdio, command: node,
//                  args: [<bridge path>],
//                  env: { GRAPH_MCP_URL: "https://.../mcp" } }

const readline = require('node:readline');

const endpoint = process.env.GRAPH_MCP_URL;
if (!endpoint) {
  console.error('GRAPH_MCP_URL is required');
  process.exit(1);
}

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseSse(body) {
  const messages = [];
  // SSE frames are separated by a blank line (\r\n\r\n or \n\n).
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) {
      messages.push(JSON.parse(data));
    }
  }
  return messages;
}

async function forward(message) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error(`Remote MCP returned HTTP ${response.status}`);
  }

  // 202 Accepted means the server will stream the result over a separate SSE
  // connection; there is nothing to return on this POST. Notifications
  // (id === undefined) carry no response either.
  if (response.status === 202 || message.id === undefined) return;

  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    for (const item of parseSse(body)) emit(item);
    return;
  }
  if (body.trim()) emit(JSON.parse(body));
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    console.error(`Invalid JSON-RPC input: ${error.message}`);
    return;
  }

  forward(message).catch((error) => {
    if (message.id !== undefined) {
      emit({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: error.message },
      });
    } else {
      console.error(error.message);
    }
  });
});

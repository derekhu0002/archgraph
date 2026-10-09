'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'argo', 'scripts', 'argo-mcp-server.js');

function readViews(viewIds) {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'coding-agent-model-at', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...viewIds.map((view_id, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params: { name: 'getArchitectureViewContext', arguments: { view_id, includeTestcases: true } } })),
  ];
  const result = spawnSync(process.execPath, [SERVER_PATH], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ARGO_REPO_ROOT: ROOT }, input: `${requests.map(x => JSON.stringify(x)).join('\n')}\n`, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split(/\r?\n/).filter(Boolean).map(JSON.parse).slice(1).map(r => JSON.parse(r.result.content[0].text));
}

test('AT coding-agent-architecture-model-01: canonical business and application views describe the generic flow and ArchGraph position', () => {
  // GIVEN the project intent graph stores the generic Coding Agent business flow and application architecture
  const [business, operatingMetrics, deliveryMetrics, benchmarkMetrics1, benchmarkMetrics2, application, implementation, graphRag, federation] = readViews([
    'coding-agent-business-value-flow-001', 'coding-agent-business-metrics-operations-001',
    'coding-agent-business-metrics-delivery-001', 'coding-agent-business-benchmarks-1-001',
    'coding-agent-business-benchmarks-2-001', 'coding-agent-application-architecture-001', 'archgraph-internal-read-write-001', 'generic-graph-rag-end-to-end-001', 'federated-intent-graph-architecture-001',
  ]);
  for (const v of [business, operatingMetrics, deliveryMetrics, benchmarkMetrics1, benchmarkMetrics2, application, implementation, graphRag, federation]) assert.equal(v.status, 'passed');
  assert.equal(application.status, 'passed');

  // WHEN checking the model's layer boundaries, shared ontology access and retrieval choices
  const b = new Map(business.elements.map(e => [e.id, e]));
  const a = new Map(application.elements.map(e => [e.id, e]));
  for (const name of ['Coding Agent 业务价值流程', '明确任务与验收目标', '获取相关项目上下文', '规划并执行代码变更', '验证并评审结果', '交付可验收结果', '沉淀可复用项目知识']) {
    assert.ok([...b.values()].some(e => e.name === name), `business flow is missing ${name}`);
  }
  for (const name of ['通用 Coding Agent Harness', '上下文访问', '普通检索', 'RAG 检索', 'Graph RAG 检索', 'ArchGraph MCP Provider', 'Graph MCP Tool Interface', '项目意图图谱']) {
    assert.ok([...a.values()].some(e => e.name === name), `application view is missing ${name}`);
  }

  // THEN Graph MCP serves the Harness context-access capability and RAG modes remain app-layer options
  const edgeNames = new Set(application.relationships.map(r => `${r.source_id}|${r.type}|${r.target_id}`));
  const provider = [...a.values()].find(e => e.name === 'ArchGraph MCP Provider');
  const context = [...a.values()].find(e => e.name === '上下文访问');
  const service = [...a.values()].find(e => e.name === '项目图谱上下文服务');
  assert.ok(provider && context && service);
  assert.ok(edgeNames.has(`${service.id}|Serving|${context.id}`));
  assert.ok(application.relationships.some(r => r.type === 'Composition' && r.source_id === provider.id));
  const writePath = ['graph-semantics-validation-001', 'graph-write-dedup-gate', 'lossless-write-gate', 'neo4j-semantic-projection-store'];
  const readPath = ['default-semantic-retrieval-001', 'hybrid-semantic-retrieval-001', 'semantic-rerank-001'];
  for (const id of [...writePath, ...readPath]) assert.ok(implementation.elements.some(e => e.id === id), `ArchGraph implementation view is missing ${id}`);
  assert.ok(implementation.relationships.some(r => r.id === 'harness-write-validate-to-dedup-001'));
  assert.ok(implementation.relationships.some(r => r.id === 'harness-read-hybrid-to-rerank-001'));
  for (const phrase of ['知识写入与解析', '实体关系抽取', '图谱与索引构建', '查询解析与改写', '向量词法图遍历召回', '结果融合与重排', '上下文组装与溯源', '生成回答与反馈']) assert.ok(graphRag.elements.some(e => e.name === phrase), `generic Graph RAG flow is missing ${phrase}`);
  assert.equal(graphRag.relationships.filter(r => r.type === 'Triggering').length, 7);
  for (const id of ['federation-center-app-v5-001', 'federation-broker-service-v5-001', 'federation-member-metadata-v5-001', 'federated-graph-reference-v5-001', 'federation-member-graph-a-v5-001', 'federation-member-graph-b-v5-001']) assert.ok(federation.elements.some(e => e.id === id));
  assert.ok(federation.relationships.some(r => r.id === 'fed-service-returns-reference-v5-001'), 'federation returns a reference object');
  const metricIds = [operatingMetrics, deliveryMetrics, benchmarkMetrics1, benchmarkMetrics2].flatMap(v => v.elements.map(e => e.id));
  assert.equal(new Set(metricIds.filter(id => id.startsWith('aos-as-'))).size, 20, 'the stage mapping views should contain the complete metric set');
  assert.ok(operatingMetrics.relationships.some(r => r.id === 'app-serves-business-context-v5-001'), 'application functions must map to business activities');
  assert.ok(operatingMetrics.relationships.some(r => r.id === 'app-metric-map-aos-as-retrieve-v5-001'), 'application capability-to-metric mapping must be explicit');
  assert.ok(benchmarkMetrics1.relationships.some(r => r.id === 'harness-metric-map-aos-as-swebench-v5-001'), 'whole-task metrics must map to the Harness');
});

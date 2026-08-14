const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ARCHITECTURE_PATH = 'design/KG/SystemArchitecture.json';
const DEFAULT_OUTPUT_DIR = '.argo/temp/architecture_analysis';

const ELEMENT_TYPE_BASE_G = {
  Goal: 15,
  Requirement: 15,
  Constraint: 1.5,
  'Business Process': 15,
  'Application Component': 2,
  'Application Function': 1.5,
  'Application Interface': 2,
  'Data Object': 1.5,
  Assessment: 1.5,
  Principle: 1.5,
};

const RELATIONSHIP_TYPE_BASE_G = {
  Realization: 15,
  Influence: 1.5,
  Assignment: 3,
  Serving: 1.5,
  Access: 1.5,
  Association: 2,
  Composition: 10,
};

// Keep dependency direction aligned with runArchitectureTests.js delivery semantics.
const DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET = new Set(['Access', 'Assignment', 'Specialization', 'Composition', 'Aggregation']);
const DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE = new Set(['Serving', 'Realization', 'Flow', 'Triggering', 'Influence']);

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const architecturePath = normalizeRelativePath(options.architecturePath || DEFAULT_ARCHITECTURE_PATH);
  const outputDir = normalizeRelativePath(options.outputDir || DEFAULT_OUTPUT_DIR);

  const result = generateArchitectureDiffPlantuml({
    workspaceRoot,
    architecturePath,
    outputDir,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.status === 'passed' ? 0 : 1);
}

function generateArchitectureDiffPlantuml({ workspaceRoot, architecturePath, outputDir }) {
  const normalizedArchitecturePath = normalizeRelativePath(architecturePath || DEFAULT_ARCHITECTURE_PATH);
  const normalizedOutputDir = normalizeRelativePath(outputDir || DEFAULT_OUTPUT_DIR);
  const absoluteArchitecturePath = resolveWorkspacePath(workspaceRoot, normalizedArchitecturePath);
  const currentDocument = readJsonFile(absoluteArchitecturePath);
  const baseDocument = readHeadJson(workspaceRoot, normalizedArchitecturePath);
  const diff = diffArchitecture(baseDocument, currentDocument);

  const totalG = estimateTotalG(diff, currentDocument, baseDocument);
  const markdown = buildMarkdown({
    architecturePath: normalizedArchitecturePath,
    diff,
    currentDocument,
    baseDocument,
    totalG,
  });

  const timestamp = buildTimestamp(new Date());
  const relativeOutputPath = normalizeRelativePath(path.posix.join(normalizedOutputDir, `architecture-diff-${timestamp}.md`));
  const absoluteOutputPath = resolveWorkspacePath(workspaceRoot, relativeOutputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(absoluteOutputPath, markdown, 'utf8');

  return {
    status: 'passed',
    architecturePath: normalizedArchitecturePath,
    outputPath: relativeOutputPath,
    changedElementIds: diff.changedElements.map(entry => entry.id),
    changedRelationshipIds: diff.changedRelationships.map(entry => entry.id),
    totalGranularity: `${formatG(totalG)}G`,
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--architecturePath') {
      options.architecturePath = args[index + 1];
      index += 1;
    } else if (arg === '--outputDir') {
      options.outputDir = args[index + 1];
      index += 1;
    } else if (arg === '--workspaceRoot') {
      options.workspaceRoot = args[index + 1];
      index += 1;
    }
  }
  return options;
}

function resolveWorkspaceRoot(input) {
  return path.resolve(input || process.env.ARGO_REPO_ROOT || process.env.WORKSPACE_FOLDER || path.resolve(__dirname, '..', '..'));
}

function resolveWorkspacePath(workspaceRoot, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(workspaceRoot, normalized);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes workspace root: ${relativePath}`);
  }
  return absolutePath;
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function readJsonFile(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readHeadJson(workspaceRoot, architecturePath) {
  try {
    const content = execFileSync('git', ['show', `HEAD:${architecturePath}`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(content);
  } catch (error) {
    return { elements: [], relationships: [], views: [] };
  }
}

function diffArchitecture(baseDocument, currentDocument) {
  const baseElements = mapById(baseDocument.elements || []);
  const currentElements = mapById(currentDocument.elements || []);
  const baseRelationships = mapById(baseDocument.relationships || []);
  const currentRelationships = mapById(currentDocument.relationships || []);

  const changedElements = diffCollection(baseElements, currentElements);
  const changedRelationships = diffCollection(baseRelationships, currentRelationships);

  return {
    changedElements,
    changedRelationships,
  };
}

function mapById(items) {
  const map = new Map();
  for (const item of items) {
    if (item && item.id) {
      map.set(String(item.id), item);
    }
  }
  return map;
}

function diffCollection(baseMap, currentMap) {
  const ids = new Set([...baseMap.keys(), ...currentMap.keys()]);
  const entries = [];
  for (const id of Array.from(ids).sort(compareIds)) {
    const before = baseMap.get(id);
    const after = currentMap.get(id);
    if (!before && after) {
      entries.push({ id, status: 'added', item: after });
    } else if (before && !after) {
      entries.push({ id, status: 'removed', item: before });
    } else if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
      entries.push({ id, status: 'affected', item: after, before });
    }
  }
  return entries;
}

function compareIds(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return String(left).localeCompare(String(right));
}

function estimateTotalG(diff, currentDocument, baseDocument) {
  const changedBusinessProcesses = diff.changedElements
    .map(entry => entry.item)
    .filter(element => element.type === 'Business Process');
  const fpCount = changedBusinessProcesses
    .map(countFunctionalPoints)
    .reduce((sum, count) => sum + count, 0);
  const interfaceCount = diff.changedElements
    .map(entry => entry.item)
    .filter(element => element.type === 'Application Interface')
    .length;
  const externalServiceInterfaceCount = diff.changedElements
    .map(entry => entry.item)
    .filter(element => element.type === 'Application Component')
    .filter(element => /W3|IDASS|SSO/i.test(element.name || ''))
    .length;
  const calculated = (fpCount * 1.5) + ((interfaceCount + externalServiceInterfaceCount) * 2);
  if (calculated > 0) {
    return calculated;
  }

  const elementTotal = diff.changedElements.reduce((sum, entry) => sum + estimateElementG(entry.item), 0);
  const relationshipTotal = diff.changedRelationships.reduce((sum, entry) => sum + estimateRelationshipG(entry.item), 0);
  return Math.max(elementTotal, relationshipTotal, 1.5);
}

function countFunctionalPoints(element) {
  const texts = [];
  for (const attribute of element.attributes || []) {
    if (attribute.name === 'functionalPoints' || /functional/i.test(attribute.name || '')) {
      texts.push(attribute.description || '');
    }
  }
  texts.push(element.description || '');
  const joined = texts.join(' ');
  const matches = joined.match(/\bFP(?:-\w+)?-\d+|\bFP\d+\b/g);
  return matches ? new Set(matches).size : 0;
}

function estimateElementG(element) {
  if (!element) {
    return 1.5;
  }
  const fpCount = countFunctionalPoints(element);
  if (fpCount > 0) {
    return fpCount * 1.5;
  }
  return ELEMENT_TYPE_BASE_G[element.type] || 1.5;
}

function estimateRelationshipG(relationship) {
  if (!relationship) {
    return 1.5;
  }
  return RELATIONSHIP_TYPE_BASE_G[relationship.type] || 1.5;
}

function buildMarkdown({ architecturePath, diff, currentDocument, baseDocument, totalG }) {
  const elementEntries = enrichElements(diff.changedElements, diff.changedRelationships, currentDocument, baseDocument, totalG);
  const relationshipEntries = enrichRelationships(diff.changedRelationships, elementEntries);
  const treeEdges = buildTreeEdges(elementEntries, relationshipEntries);
  const plantuml = buildPlantuml(elementEntries, relationshipEntries, treeEdges, totalG);

  return [
    '# SystemArchitecture Diff PlantUML',
    '',
    `- Source: \`${architecturePath}\``,
    `- Generated: \`${new Date().toISOString()}\``,
    '- Color: added=pink, affected=blue, context=light yellow.',
    '- Tree direction: root dependency -> depended-on elements; `G传递` means the child contributes granularity to its parent.',
    '',
    '```plantuml',
    plantuml,
    '```',
    '',
  ].join('\n');
}

function enrichElements(changedElements, changedRelationships, currentDocument, baseDocument, totalG) {
  const currentElements = mapById(currentDocument.elements || []);
  const baseElements = mapById(baseDocument.elements || []);
  const byId = new Map();

  for (const entry of changedElements) {
    byId.set(entry.id, {
      id: entry.id,
      status: entry.status,
      item: entry.item,
      g: ['Goal', 'Requirement', 'Business Process'].includes(entry.item.type)
        ? totalG
        : estimateElementG(entry.item),
    });
  }

  for (const relationshipEntry of changedRelationships) {
    const relationship = relationshipEntry.item;
    for (const id of [relationship.source_id, relationship.target_id].filter(Boolean).map(String)) {
      if (!byId.has(id)) {
        const item = currentElements.get(id) || baseElements.get(id);
        if (item) {
          byId.set(id, {
            id,
            status: 'context',
            item,
            g: estimateElementG(item),
          });
        }
      }
    }
  }

  return Array.from(byId.values()).sort((left, right) => {
    if (right.g !== left.g) {
      return right.g - left.g;
    }
    return compareIds(left.id, right.id);
  });
}

function enrichRelationships(changedRelationships, elementEntries) {
  const knownElementIds = new Set(elementEntries.map(entry => entry.id));
  return changedRelationships
    .filter(entry => knownElementIds.has(String(entry.item.source_id)) && knownElementIds.has(String(entry.item.target_id)))
    .map(entry => ({
      id: entry.id,
      status: entry.status,
      item: entry.item,
      g: estimateRelationshipG(entry.item),
    }))
    .sort((left, right) => compareIds(left.id, right.id));
}

function buildTreeEdges(elementEntries, relationshipEntries) {
  const entriesById = new Map(elementEntries.map(entry => [entry.id, entry]));
  const edges = [];
  const connectedElementIds = new Set();

  for (const relationshipEntry of relationshipEntries) {
    const source = entriesById.get(String(relationshipEntry.item.source_id));
    const target = entriesById.get(String(relationshipEntry.item.target_id));
    if (!source || !target) {
      continue;
    }
    const dependencyEdge = orientDependencyEdge(relationshipEntry.item, source, target);
    if (!dependencyEdge) {
      continue;
    }
    const { parent, child } = dependencyEdge;
    edges.push({
      kind: 'relationship',
      relationship: relationshipEntry,
      parent,
      child,
      g: child.g,
    });
    connectedElementIds.add(parent.id);
    connectedElementIds.add(child.id);
  }

  const root = elementEntries[0];
  if (root) {
    for (const entry of elementEntries) {
      if (entry.id === root.id || connectedElementIds.has(entry.id)) {
        continue;
      }
      edges.push({
        kind: 'impact',
        parent: root,
        child: entry,
        g: entry.g,
      });
      connectedElementIds.add(entry.id);
    }
  }

  return edges;
}

function orientDependencyEdge(relationship, source, target) {
  const relationshipType = String(relationship.type || '');
  if (DEPENDENCY_TYPES_SOURCE_DEPENDS_ON_TARGET.has(relationshipType)) {
    return { parent: source, child: target };
  }
  if (DEPENDENCY_TYPES_TARGET_DEPENDS_ON_SOURCE.has(relationshipType)) {
    return { parent: target, child: source };
  }
  return null;
}

function buildPlantuml(elementEntries, relationshipEntries, treeEdges, totalG) {
  const lines = [
    '@startuml',
    'title SystemArchitecture 当前 Git Diff 变化树',
    '',
    'top to bottom direction',
    'hide stereotype',
    'skinparam shadowing false',
    'skinparam linetype ortho',
    'skinparam defaultTextAlignment center',
    'skinparam wrapWidth 120',
    'skinparam ArrowFontSize 10',
    'skinparam nodesep 25',
    'skinparam ranksep 55',
    '',
    'skinparam rectangle {',
    '  RoundCorner 12',
    '  BackgroundColor<<added>> #F8BBD0',
    '  BorderColor<<added>> #AD1457',
    '  BackgroundColor<<affected>> #BBDEFB',
    '  BorderColor<<affected>> #1565C0',
    '  BackgroundColor<<context>> #FFF9C4',
    '  BorderColor<<context>> #F9A825',
    '}',
    '',
    'legend right',
    '  |= 颜色 |= 含义 |',
    '  | <back:#F8BBD0>新增</back> | Git diff 新增元素/关系 |',
    '  | <back:#BBDEFB>影响</back> | Git diff 修改既有元素/关系 |',
    '  | <back:#FFF9C4>上下文</back> | 被变更关系引用的上下文元素 |',
    `  | 估算 | 总计 ${formatG(totalG)}G |`,
    'endlegend',
    '',
  ];

  for (const entry of elementEntries) {
    lines.push(`rectangle "${escapePlantuml(entry.item.name || entry.id)}\\nid=${entry.id}\\n${escapePlantuml(entry.item.type || 'Element')}\\n${entry.status === 'affected' ? '影响粒度' : entry.status === 'context' ? '上下文粒度' : '任务粒度'}=${formatG(entry.g)}G" as E${sanitizeAlias(entry.id)} <<${entry.status}>>`);
  }

  lines.push('');

  for (const edge of treeEdges) {
    const color = edge.kind === 'impact' ? '#1565C0' : edge.relationship.status === 'affected' ? '#1565C0' : '#AD1457';
    const style = edge.kind === 'impact' ? ',dotted' : '';
    const label = edge.kind === 'impact'
      ? `影响项\\n非图谱关系\\nG传递=${formatG(edge.g)}G`
      : `${edge.relationship.id} ${escapePlantuml(edge.relationship.item.name || '')}\\n${escapePlantuml(edge.relationship.item.type || '')}\\nG传递=${formatG(edge.g)}G`;
    lines.push(`E${sanitizeAlias(edge.parent.id)} -[${color}${style}]-> E${sanitizeAlias(edge.child.id)} : ${label}`);
  }

  lines.push('', '@enduml');
  return lines.join('\n');
}

function escapePlantuml(value) {
  return String(value || '').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
}

function sanitizeAlias(value) {
  return String(value).replace(/[^A-Za-z0-9_]/g, '_');
}

function formatG(value) {
  return Number(value).toFixed(1).replace(/\.0$/, '');
}

function buildTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

if (require.main === module) {
  main();
}

module.exports = {
  generateArchitectureDiffPlantuml,
};

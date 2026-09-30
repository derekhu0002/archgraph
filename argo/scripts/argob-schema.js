'use strict';

// ARGO schema-bundle resolution and ontology construction.
//
// The toolchain is no longer hard-wired to a single modeling language. A
// "schema bundle" is a directory that carries the graph contract:
//
//   <bundle>/SystemArchitecture.schema.json   (required) JSON Schema of the graph
//   <bundle>/argob.config.json                (optional) bundle descriptor:
//                                               language, enum locations, guide,
//                                               rules file, invariant switches
//   <bundle>/argob-rules.json                 (optional) ontology rules data
//                                               (type metadata, relationship
//                                               categories, endpoint matrix)
//   <bundle>/ARGOB.md                         (optional) human-readable guide
//
// Resolution precedence (first bundle that has SystemArchitecture.schema.json):
//   1. ARGO_SCHEMA_DIR                     — explicit override (tests / hosts)
//   2. <workspaceRoot>/.argo/schema        — the repository's own schema
//   3. <argoRoot>/schema                   — the default ArgoBument schema
//
// The default bundle keeps the historical ArchiMate 3.2 + ARGO behaviour. A
// custom bundle may define its own element/relationship types and, optionally,
// its own endpoint rules and invariants.

const fs = require('node:fs');
const path = require('node:path');

const { getArgoRoot } = require('./argo-paths.js');

const SCHEMA_BASENAME = 'SystemArchitecture.schema.json';
const CONFIG_BASENAME = 'argob.config.json';
const RULES_BASENAME = 'argob-rules.json';
const GUIDE_BASENAME = 'ARGOB.md';
const DEFAULT_GUIDE_BASENAME = 'archimate3.2.md';
const DEFAULT_LANGUAGE = 'ArchiMate 3.2';
const DEFAULT_ROOT_VIEW_NAME = 'SystemArchitecture';
const DEFAULT_MAX_ELEMENTS_PER_VIEW = 15;
const DEFAULT_ACTOR_ELEMENT_TYPE = 'Business Actor';
const ELEMENT_ENUM_KEYS = ['archimateElementType', 'elementType', 'elementTypes'];
const RELATIONSHIP_ENUM_KEYS = ['archimateRelationshipType', 'relationshipType', 'relationshipTypes'];

function toPosix(value) {
  return String(value == null ? '' : value).replace(/\\/g, '/');
}

function readJsonFile(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function relativeLabel(workspaceRoot, absolutePath) {
  const workspaceRelative = path.relative(workspaceRoot, absolutePath);
  if (workspaceRelative && !workspaceRelative.startsWith('..') && !path.isAbsolute(workspaceRelative)) {
    return toPosix(workspaceRelative);
  }
  const argoRelative = path.relative(getArgoRoot(), absolutePath);
  if (argoRelative && !argoRelative.startsWith('..') && !path.isAbsolute(argoRelative)) {
    return `<argo>/${toPosix(argoRelative)}`;
  }
  return toPosix(absolutePath);
}

function buildBundle(kind, dir, workspaceRoot) {
  const schemaFile = path.join(dir, SCHEMA_BASENAME);
  const schema = readJsonFile(schemaFile);

  const configFile = path.join(dir, CONFIG_BASENAME);
  const fileConfig = isFile(configFile) ? readJsonFile(configFile) : {};
  const inlineConfig = schema && typeof schema['x-argob'] === 'object' && schema['x-argob'] !== null
    ? schema['x-argob']
    : {};
  const config = { ...inlineConfig, ...fileConfig };

  const rulesFile = typeof config.rules === 'string' && config.rules.trim() !== ''
    ? path.resolve(dir, config.rules)
    : path.join(dir, RULES_BASENAME);
  const rules = isFile(rulesFile) ? readJsonFile(rulesFile) : null;

  let guidePath = null;
  if (typeof config.guide === 'string' && config.guide.trim() !== '') {
    const candidate = path.resolve(dir, config.guide);
    if (isFile(candidate)) {
      guidePath = candidate;
    }
  } else if (kind === 'default') {
    const candidate = path.join(dir, DEFAULT_GUIDE_BASENAME);
    if (isFile(candidate)) {
      guidePath = candidate;
    }
  } else {
    const candidate = path.join(dir, GUIDE_BASENAME);
    if (isFile(candidate)) {
      guidePath = candidate;
    }
  }

  return {
    kind,
    dir,
    relativeDir: relativeLabel(workspaceRoot, dir),
    schema: {
      absolutePath: schemaFile,
      relativePath: relativeLabel(workspaceRoot, schemaFile),
    },
    schemaDocument: schema,
    config: {
      filePath: isFile(configFile) ? { absolutePath: configFile, relativePath: relativeLabel(workspaceRoot, configFile) } : null,
      ...config,
    },
    rulesPath: rules
      ? { absolutePath: rulesFile, relativePath: relativeLabel(workspaceRoot, rulesFile) }
      : null,
    rules,
    guidePath: guidePath
      ? { absolutePath: guidePath, relativePath: relativeLabel(workspaceRoot, guidePath) }
      : null,
  };
}

function resolveSchemaBundle(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot || process.cwd());
  const candidates = [];

  const envDir = options.schemaDir || process.env.ARGO_SCHEMA_DIR;
  if (typeof envDir === 'string' && envDir.trim() !== '') {
    candidates.push({ kind: 'override', dir: path.resolve(root, envDir.trim()) });
  }
  candidates.push({ kind: 'workspace', dir: path.join(root, '.argo', 'schema') });
  candidates.push({ kind: 'default', dir: path.join(getArgoRoot(), 'schema') });

  const seen = new Set();
  for (const candidate of candidates) {
    const key = path.resolve(candidate.dir).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (isFile(path.join(candidate.dir, SCHEMA_BASENAME))) {
      return buildBundle(candidate.kind, candidate.dir, root);
    }
  }

  throw new Error(
    `Unable to locate '${SCHEMA_BASENAME}'. Checked: ${candidates.map(c => c.dir).join(', ')}`,
  );
}

function resolveEnumFromSchema(schema, keys, configPathKey) {
  if (configPathKey && Array.isArray(configPathKey)) {
    let current = schema;
    for (const segment of configPathKey) {
      if (!current || typeof current !== 'object' || !(segment in current)) {
        current = undefined;
        break;
      }
      current = current[segment];
    }
    if (Array.isArray(current)) {
      return current.slice();
    }
  }
  const defs = schema && typeof schema.$defs === 'object' && schema.$defs !== null ? schema.$defs : {};
  for (const key of keys) {
    const node = defs[key];
    if (node && Array.isArray(node.enum)) {
      return node.enum.slice();
    }
  }
  return [];
}

function resolveTypeEnums(bundle) {
  const config = bundle.config || {};
  const schema = bundle.schemaDocument || {};

  let elementTypes = Array.isArray(config.elementTypes) ? config.elementTypes.slice() : [];
  if (elementTypes.length === 0) {
    elementTypes = resolveEnumFromSchema(schema, ELEMENT_ENUM_KEYS, config.elementTypeEnumPath);
  }

  let relationshipTypes = Array.isArray(config.relationshipTypes) ? config.relationshipTypes.slice() : [];
  if (relationshipTypes.length === 0) {
    relationshipTypes = resolveEnumFromSchema(schema, RELATIONSHIP_ENUM_KEYS, config.relationshipTypeEnumPath);
  }

  return { elementTypes, relationshipTypes };
}

function resolveInvariants(config, defaults) {
  const raw = config && typeof config.invariants === 'object' && config.invariants !== null
    ? config.invariants
    : {};
  const invariants = { ...defaults };
  if (typeof raw.statementGrammar === 'boolean') {
    invariants.statementGrammar = raw.statementGrammar;
  }
  if (typeof raw.endpointMatrix === 'boolean') {
    invariants.endpointMatrix = raw.endpointMatrix;
  }
  if (raw.rootViewName === null) {
    invariants.rootViewName = null;
  } else if (typeof raw.rootViewName === 'string' && raw.rootViewName.trim() !== '') {
    invariants.rootViewName = raw.rootViewName.trim();
  }
  if (raw.maxElementsPerView === null) {
    invariants.maxElementsPerView = null;
  } else if (Number.isInteger(raw.maxElementsPerView) && raw.maxElementsPerView >= 0) {
    invariants.maxElementsPerView = raw.maxElementsPerView;
  }
  return invariants;
}

function resolveActorElementType(config) {
  // The Actor element type is part of the bundle contract: the ARGO workflow
  // identifies the agent through an Actor element (wakeup gate). A bundle may
  // rename it, or set it to null to declare that the schema has no actor concept
  // (actor identification is then skipped). Absent => the default 'Business Actor'.
  if (config && Object.prototype.hasOwnProperty.call(config, 'actorElementType')) {
    return config.actorElementType;
  }
  return DEFAULT_ACTOR_ELEMENT_TYPE;
}

function validateBundle({ language, kind, elementTypes, relationshipTypes, actorElementType, matrix }) {
  const errors = [];
  const elementTypeList = Array.isArray(elementTypes) ? elementTypes : [];
  const relationshipTypeList = Array.isArray(relationshipTypes) ? relationshipTypes : [];

  if (elementTypeList.length === 0) {
    errors.push(`schema bundle '${language}' defines no element types`);
  }
  if (relationshipTypeList.length === 0) {
    errors.push(`schema bundle '${language}' defines no relationship types`);
  }

  if (actorElementType === null) {
    // Explicit opt-out: the schema has no actor/agent identity concept.
  } else if (typeof actorElementType === 'string' && actorElementType.trim() !== '') {
    if (!elementTypeList.includes(actorElementType)) {
      errors.push(
        `schema bundle '${language}' declares actorElementType '${actorElementType}' which is not one of its element types; ` +
        `set a valid actorElementType in argob.config.json (one of: ${elementTypeList.join(', ') || '(none)'}) ` +
        `or set "actorElementType": null if the schema has no actor concept`,
      );
    }
  } else {
    errors.push(`schema bundle '${language}' actorElementType must be a non-empty string or null; got ${JSON.stringify(actorElementType)}`);
  }

  // The endpoint matrix (custom bundles only) must only reference declared types.
  if (kind !== 'default' && matrix && typeof matrix === 'object') {
    for (const [relationshipType, targetsBySource] of Object.entries(matrix)) {
      if (!relationshipTypeList.includes(relationshipType)) {
        errors.push(`relationshipTargetMatrix references unknown relationship type '${relationshipType}'`);
      }
      for (const [sourceType, targetList] of Object.entries(targetsBySource || {})) {
        if (!elementTypeList.includes(sourceType)) {
          errors.push(`relationshipTargetMatrix['${relationshipType}'] references unknown element type '${sourceType}'`);
        }
        for (const targetType of Array.isArray(targetList) ? targetList : []) {
          if (targetType !== '*' && !elementTypeList.includes(targetType)) {
            errors.push(`relationshipTargetMatrix['${relationshipType}']['${sourceType}'] references unknown element type '${targetType}'`);
          }
        }
      }
    }
  }

  return { status: errors.length === 0 ? 'passed' : 'failed', errors };
}

function buildDefaultOntology(bundle) {
  const rules = require('./archimate32-rules.js');
  const language = typeof bundle.config.language === 'string' && bundle.config.language.trim() !== ''
    ? bundle.config.language.trim()
    : DEFAULT_LANGUAGE;
  const elementTypes = Array.from(rules.elementTypeMetadata.keys());
  const relationshipTypes = Array.from(rules.relationshipCategoryByType.keys());
  const actorElementType = resolveActorElementType(bundle.config);
  return finalizeOntology({
    kind: 'default',
    language,
    elementTypeErrorLabel: 'ArchiMate',
    relationshipTypeErrorLabel: 'ArchiMate',
    matrixErrorLabel: 'ArchiMate 3.2 relationship matrix',
    elementTypes,
    relationshipTypes,
    actorElementType,
    bundleValidation: validateBundle({ language, kind: 'default', elementTypes, relationshipTypes, actorElementType, matrix: null }),
    elementTypeMetadata: rules.elementTypeMetadata,
    relationshipCategoryByType: rules.relationshipCategoryByType,
    isSupportedElementType: rules.isSupportedElementType,
    isSupportedRelationshipType: rules.isSupportedRelationshipType,
    getMetadata: rules.getMetadata,
    getArchiMateClass: rules.getArchiMateClass,
    validateRelationshipEndpointTypes: rules.validateRelationshipEndpointTypes,
    invariants: resolveInvariants(bundle.config, {
      statementGrammar: true,
      endpointMatrix: true,
      rootViewName: DEFAULT_ROOT_VIEW_NAME,
      maxElementsPerView: DEFAULT_MAX_ELEMENTS_PER_VIEW,
    }),
  });
}

function buildCustomOntology(bundle) {
  const config = bundle.config || {};
  const language = typeof config.language === 'string' && config.language.trim() !== ''
    ? config.language.trim()
    : 'Custom Ontology';
  const enums = resolveTypeEnums(bundle);
  const rules = bundle.rules || {};
  const rawMetadata = rules.elementTypeMetadata && typeof rules.elementTypeMetadata === 'object'
    ? rules.elementTypeMetadata
    : {};
  const rawCategories = rules.relationshipCategoryByType && typeof rules.relationshipCategoryByType === 'object'
    ? rules.relationshipCategoryByType
    : {};
  const matrix = rules.relationshipTargetMatrix && typeof rules.relationshipTargetMatrix === 'object'
    ? rules.relationshipTargetMatrix
    : null;

  const elementTypeMetadata = new Map();
  for (const type of enums.elementTypes) {
    elementTypeMetadata.set(type, rawMetadata[type] || { layer: null, aspect: null });
  }
  for (const [type, meta] of Object.entries(rawMetadata)) {
    if (!elementTypeMetadata.has(type)) {
      elementTypeMetadata.set(type, meta);
    }
  }

  const relationshipCategoryByType = new Map();
  for (const type of enums.relationshipTypes) {
    relationshipCategoryByType.set(type, rawCategories[type] || 'Custom');
  }
  for (const [type, category] of Object.entries(rawCategories)) {
    if (!relationshipCategoryByType.has(type)) {
      relationshipCategoryByType.set(type, category);
    }
  }

  const matrixErrorLabel = `${language} relationship matrix`;
  const actorElementType = resolveActorElementType(config);
  const elementTypes = Array.from(elementTypeMetadata.keys());
  const relationshipTypes = Array.from(relationshipCategoryByType.keys());
  const getArchiMateClass = (elementOrType) => {
    const type = typeof elementOrType === 'string' ? elementOrType : elementOrType && elementOrType.type;
    return type;
  };

  function validateRelationshipEndpointTypes(relationship, source, target) {
    if (!relationship || !source || !target) {
      return [];
    }
    const type = relationship.type;
    if (!relationshipCategoryByType.has(type)) {
      return [`relationships '${relationship.id}' uses unsupported ${language} relationship type '${type}'`];
    }
    if (!matrix) {
      return [];
    }
    const allowedTargets = matrix[type] && matrix[type][source.type];
    if (!allowedTargets) {
      return [];
    }
    const ok = allowedTargets.some((allowed) => allowed === target.type || allowed === '*');
    if (!ok) {
      return [`relationships '${relationship.id}' violates ${matrixErrorLabel}: ${source.type} '${source.name}' cannot ${type} ${target.type} '${target.name}'`];
    }
    return [];
  }

  return finalizeOntology({
    kind: 'custom',
    language,
    elementTypeErrorLabel: language,
    relationshipTypeErrorLabel: language,
    matrixErrorLabel,
    elementTypes,
    relationshipTypes,
    actorElementType,
    bundleValidation: validateBundle({ language, kind: 'custom', elementTypes, relationshipTypes, actorElementType, matrix }),
    elementTypeMetadata,
    relationshipCategoryByType,
    isSupportedElementType: (type) => elementTypeMetadata.has(type),
    isSupportedRelationshipType: (type) => relationshipCategoryByType.has(type),
    getMetadata: (element) => elementTypeMetadata.get(element && element.type) || {},
    getArchiMateClass,
    validateRelationshipEndpointTypes,
    invariants: resolveInvariants(config, {
      statementGrammar: true,
      endpointMatrix: Boolean(matrix),
      rootViewName: DEFAULT_ROOT_VIEW_NAME,
      maxElementsPerView: DEFAULT_MAX_ELEMENTS_PER_VIEW,
    }),
  });
}

function finalizeOntology(ontology) {
  const elementById = new Map();
  function auditRelationshipEndpointTypes(document, relationshipIds) {
    const errors = [];
    const idSet = Array.isArray(relationshipIds) && relationshipIds.length > 0
      ? new Set(relationshipIds)
      : undefined;
    for (const element of (document && document.elements) || []) {
      elementById.set(element.id, element);
    }
    for (const relationship of (document && document.relationships) || []) {
      if (idSet && !idSet.has(relationship.id)) {
        continue;
      }
      const source = elementById.get(relationship.source_id);
      const target = elementById.get(relationship.target_id);
      errors.push(...ontology.validateRelationshipEndpointTypes(relationship, source, target));
    }
    return errors;
  }
  return {
    ...ontology,
    auditRelationshipEndpointTypes,
  };
}

const ontologyCache = new Map();

function buildOntology(bundle) {
  return bundle.kind === 'default' ? buildDefaultOntology(bundle) : buildCustomOntology(bundle);
}

function loadSchemaBundleAndOntology(workspaceRoot, options = {}) {
  const bundle = resolveSchemaBundle(workspaceRoot, options);
  const cacheKey = `${bundle.kind}:${path.resolve(bundle.dir).toLowerCase()}`;
  if (ontologyCache.has(cacheKey)) {
    return { bundle, ontology: ontologyCache.get(cacheKey) };
  }
  const ontology = buildOntology(bundle);
  ontologyCache.set(cacheKey, ontology);
  return { bundle, ontology };
}

module.exports = {
  SCHEMA_BASENAME,
  CONFIG_BASENAME,
  RULES_BASENAME,
  resolveSchemaBundle,
  resolveTypeEnums,
  buildOntology,
  loadSchemaBundleAndOntology,
};

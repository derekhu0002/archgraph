'use strict';

// ARGO schema-bundle resolution and ontology construction.
//
// The toolchain is no longer hard-wired to a single modeling language. A
// "schema bundle" is a directory that carries the graph contract:
//
//   <bundle>/SystemArchitecture.schema.json   (required) JSON Schema of the graph
//   <bundle>/schema-bundle.config.json                (optional) bundle descriptor:
//                                               language, enum locations, guide,
//                                               rules file, invariant switches
//   <bundle>/schema-bundle.rules.json                 (optional) ontology rules data
//                                               (type metadata, relationship
//                                               categories, endpoint matrix)
//   <bundle>/GUIDE.md                         (optional) human-readable guide
//
// Resolution precedence (first bundle that has SystemArchitecture.schema.json):
//   1. ARGO_SCHEMA_DIR                     鈥?explicit override (tests / hosts)
//   2. <workspaceRoot>/.argo/schema        鈥?the repository's own schema
//   3. <argoRoot>/schema                   鈥?the default ArchiMate 3.2 schema
//
// The default bundle keeps the historical ArchiMate 3.2 + ARGO behaviour. A
// custom bundle may define its own element/relationship types and, optionally,
// its own endpoint rules and invariants.

const fs = require('node:fs');
const path = require('node:path');

const { getArgoRoot } = require('./argo-paths.js');

const SCHEMA_BASENAME = 'SystemArchitecture.schema.json';
const CONFIG_BASENAME = 'schema-bundle.config.json';
const RULES_BASENAME = 'schema-bundle.rules.json';
const GUIDE_BASENAME = 'GUIDE.md';
const DEFAULT_GUIDE_BASENAME = 'archimate3.2.md';
const DEFAULT_LANGUAGE = 'ArchiMate 3.2';
const DEFAULT_ROOT_VIEW_NAME = 'SystemArchitecture';
const DEFAULT_MAX_ELEMENTS_PER_VIEW = 15;
const DEFAULT_ACTOR_ELEMENT_TYPE = 'Business Actor';

// Which relationship types express a delivery dependency and in which direction.
// Declared per bundle via schema-bundle.config.json "deliveryDependencies"; the default
// ArchiMate 3.2 bundle keeps the ArchiMate mapping below (previous behaviour).
const ARCHIMATE_DELIVERY_DEPENDENCIES = Object.freeze({
  sourceDependsOnTarget: Object.freeze(['Access', 'Assignment', 'Specialization', 'Composition', 'Aggregation']),
  targetDependsOnSource: Object.freeze(['Serving', 'Realization', 'Flow', 'Triggering', 'Influence']),
});

function resolveDeliveryDependencies(config, dialect) {
  const raw = config && typeof config.deliveryDependencies === 'object' && config.deliveryDependencies !== null
    ? config.deliveryDependencies
    : null;
  if (raw) {
    return {
      sourceDependsOnTarget: Array.isArray(raw.sourceDependsOnTarget) ? raw.sourceDependsOnTarget.slice() : [],
      targetDependsOnSource: Array.isArray(raw.targetDependsOnSource) ? raw.targetDependsOnSource.slice() : [],
    };
  }
  if (dialect === 'archimate-class-matrix') {
    return {
      sourceDependsOnTarget: ARCHIMATE_DELIVERY_DEPENDENCIES.sourceDependsOnTarget.slice(),
      targetDependsOnSource: ARCHIMATE_DELIVERY_DEPENDENCIES.targetDependsOnSource.slice(),
    };
  }
  // Custom schema with no declared dependency semantics: no delivery ordering
  // (tests still run, in declaration order).
  return { sourceDependsOnTarget: [], targetDependsOnSource: [] };
}
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
  const schemaExists = isFile(schemaFile);
  const schema = schemaExists ? readJsonFile(schemaFile) : null;

  const configFile = path.join(dir, CONFIG_BASENAME);
  const fileConfig = isFile(configFile) ? readJsonFile(configFile) : {};
  const inlineConfig = schema && typeof schema['x-schema-bundle'] === 'object' && schema['x-schema-bundle'] !== null
    ? schema['x-schema-bundle']
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
    schema: schemaExists
      ? { absolutePath: schemaFile, relativePath: relativeLabel(workspaceRoot, schemaFile) }
      : null,
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

// --- Bundle inheritance (issue #4) -----------------------------------------
// A bundle may declare `extends` to inherit a base bundle (the built-in default,
// or another bundle directory) and add/override on top of it instead of forking
// the whole rules file. `addElementTypes` / `addRelationships` / `overrideMatrix`
// are the delta; the effective element universe becomes base ∪ add (single
// source of truth), matrix/metadata merge by key.

function bundleConfig(dir) {
  const configFile = path.join(dir, CONFIG_BASENAME);
  if (!isFile(configFile)) {
    return {};
  }
  try {
    return readJsonFile(configFile);
  } catch {
    return {};
  }
}

function hasExtendsConfig(dir) {
  const config = bundleConfig(dir);
  return typeof config.extends === 'string' && config.extends.trim() !== '';
}

function resolveBaseBundleDir(ext, childDir) {
  const value = String(ext).trim();
  // Reserved, language-neutral name for the built-in default bundle. Any other
  // value is a path to another bundle directory — the framework never hardcodes a
  // modeling-language name (ArchiMate or otherwise) into bundle resolution.
  if (value === 'default') {
    return path.join(getArgoRoot(), 'schema');
  }
  return path.resolve(childDir, value);
}

function deepCloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeMatrixInto(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  for (const [relationshipType, bySource] of Object.entries(source)) {
    if (!bySource || typeof bySource !== 'object') {
      target[relationshipType] = deepCloneJson(bySource);
      continue;
    }
    if (!target[relationshipType] || typeof target[relationshipType] !== 'object') {
      target[relationshipType] = {};
    }
    for (const [sourceType, targets] of Object.entries(bySource)) {
      target[relationshipType][sourceType] = deepCloneJson(targets);
    }
  }
  return target;
}

// Append added types to a JSON-Schema enum def (the element/relationship type
// universe), so a schema-less inheriting Profile's own added types are structurally
// valid — not just present at the ontology level.
function extendSchemaEnum(schemaDocument, enumKeys, additions) {
  const defs = schemaDocument && typeof schemaDocument.$defs === 'object' ? schemaDocument.$defs : null;
  if (!defs) {
    return;
  }
  for (const key of enumKeys) {
    const node = defs[key];
    if (node && Array.isArray(node.enum)) {
      for (const value of additions) {
        if (typeof value === 'string' && value !== '' && !node.enum.includes(value)) {
          node.enum.push(value);
        }
      }
      return;
    }
  }
}

function mergeExtendsBundle(base, child) {
  const baseRules = base.rules || {};
  const childRules = child.rules || {};
  const config = { ...(base.config || {}), ...(child.config || {}) };

  const elementTypeMetadata = { ...(baseRules.elementTypeMetadata || {}), ...(childRules.elementTypeMetadata || {}) };
  const archimateClassByElementType = { ...(baseRules.archimateClassByElementType || {}), ...(childRules.archimateClassByElementType || {}) };
  const relationshipCategoryByType = { ...(baseRules.relationshipCategoryByType || {}), ...(childRules.relationshipCategoryByType || {}) };

  const addElementTypes = config.addElementTypes && typeof config.addElementTypes === 'object' ? config.addElementTypes : {};
  for (const [type, meta] of Object.entries(addElementTypes)) {
    if (!elementTypeMetadata[type]) {
      elementTypeMetadata[type] = { layer: (meta && meta.layer) || null, aspect: (meta && meta.aspect) || null };
    }
    if (meta && typeof meta.class === 'string' && meta.class !== '') {
      archimateClassByElementType[type] = meta.class;
    }
  }
  const addRelationships = config.addRelationships && typeof config.addRelationships === 'object' ? config.addRelationships : {};
  for (const [type, category] of Object.entries(addRelationships)) {
    relationshipCategoryByType[type] = category;
  }

  // Guarantee base ∪ add for the element/relationship universe regardless of the
  // base dialect (class-matrix derives types from rules metadata, type-matrix from
  // schema enums) — an inheriting Profile must never silently drop a base type.
  const baseOntology = buildOntology(base);
  for (const type of baseOntology.elementTypes) {
    if (!elementTypeMetadata[type]) {
      elementTypeMetadata[type] = { layer: null, aspect: null };
    }
  }
  for (const type of baseOntology.relationshipTypes) {
    if (!relationshipCategoryByType[type]) {
      relationshipCategoryByType[type] = 'Custom';
    }
  }

  const relationshipTargetMatrix = deepCloneJson(baseRules.relationshipTargetMatrix || {}) || {};
  mergeMatrixInto(relationshipTargetMatrix, childRules.relationshipTargetMatrix || {});
  mergeMatrixInto(relationshipTargetMatrix, config.overrideMatrix || {});

  const dialect = childRules.dialect || baseRules.dialect || 'archimate-class-matrix';
  const rules = {
    ...baseRules,
    ...childRules,
    dialect,
    elementTypeMetadata,
    archimateClassByElementType,
    relationshipCategoryByType,
    relationshipTargetMatrix,
  };

  // Structural schema: when the child has none, it inherits the base schema — but
  // its added types must be valid against the base's $defs enum too, otherwise
  // whole-graph validation (validateAgainstSchema) rejects elements of the added
  // types. Extend the inherited schema enum in place (clone, never mutate base).
  let schemaDocument = child.schemaDocument || base.schemaDocument;
  if (!child.schemaDocument && base.schemaDocument) {
    const extraElementTypes = Object.keys(addElementTypes).filter(Boolean);
    const extraRelationshipTypes = Object.keys(addRelationships).filter(Boolean);
    const extraFromConfigElements = Array.isArray(config.elementTypes) ? config.elementTypes : [];
    const extraFromConfigRelationships = Array.isArray(config.relationshipTypes) ? config.relationshipTypes : [];
    if (extraElementTypes.length || extraRelationshipTypes.length || extraFromConfigElements.length || extraFromConfigRelationships.length) {
      schemaDocument = deepCloneJson(base.schemaDocument);
      extendSchemaEnum(schemaDocument, ELEMENT_ENUM_KEYS, extraElementTypes.concat(extraFromConfigElements));
      extendSchemaEnum(schemaDocument, RELATIONSHIP_ENUM_KEYS, extraRelationshipTypes.concat(extraFromConfigRelationships));
    }
  }

  return {
    ...child,
    schema: child.schema || base.schema,
    schemaDocument,
    rules,
    config,
    inheritedFrom: base.dir,
    chainDirs: Array.from(new Set([
      ...(Array.isArray(base.chainDirs) && base.chainDirs.length > 0 ? base.chainDirs : [path.resolve(base.dir).toLowerCase()]),
      path.resolve(child.dir).toLowerCase(),
    ])),
  };
}

function applyExtends(bundle, workspaceRoot, seen = new Set()) {
  const ext = bundle && bundle.config && typeof bundle.config.extends === 'string' ? bundle.config.extends.trim() : '';
  if (!ext) {
    return bundle;
  }
  seen.add(path.resolve(bundle.dir).toLowerCase());
  const baseDir = resolveBaseBundleDir(ext, bundle.dir);
  const baseKey = path.resolve(baseDir).toLowerCase();
  if (seen.has(baseKey)) {
    throw new Error(`schema bundle extends cycle detected at '${baseDir}'`);
  }
  if (!isFile(path.join(baseDir, SCHEMA_BASENAME)) && !hasExtendsConfig(baseDir)) {
    throw new Error(`schema bundle extends '${ext}' could not be resolved: no schema bundle at '${baseDir}'`);
  }
  const baseBundle = applyExtends(buildBundle('extends', baseDir, workspaceRoot), workspaceRoot, seen);
  return mergeExtendsBundle(baseBundle, bundle);
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
    if (isFile(path.join(candidate.dir, SCHEMA_BASENAME)) || hasExtendsConfig(candidate.dir)) {
      return applyExtends(buildBundle(candidate.kind, candidate.dir, root), root);
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

// Per-element-type attribute contract (issue #3): declare that an element type
// must carry certain attributes, that some attribute values are a controlled
// vocabulary, and that some attribute values are unique within the type.
//   { "Rule": { "required": ["ruleId","normativity"], "unique": ["ruleId"],
//               "enumByAttr": { "normativity": ["MUST","SHOULD","MAY","MUST_NOT"] } } }
// Absent => no per-type attribute contract (backward compatible).
function resolveAttributeContracts(config) {
  const raw = config && typeof config.attributesByElementType === 'object' && config.attributesByElementType !== null
    ? config.attributesByElementType
    : null;
  if (!raw) {
    return undefined;
  }
  const contracts = {};
  for (const [type, contract] of Object.entries(raw)) {
    if (!contract || typeof contract !== 'object') {
      contracts[type] = {};
      continue;
    }
    contracts[type] = {
      required: Array.isArray(contract.required) ? contract.required.slice() : undefined,
      unique: Array.isArray(contract.unique) ? contract.unique.slice() : undefined,
      enumByAttr: contract.enumByAttr && typeof contract.enumByAttr === 'object' ? { ...contract.enumByAttr } : undefined,
    };
  }
  return contracts;
}

function validateAttributeContracts(language, elementTypeList, contracts) {
  const errors = [];
  if (!contracts || typeof contracts !== 'object') {
    return errors;
  }
  for (const [type, contract] of Object.entries(contracts)) {
    if (!elementTypeList.includes(type)) {
      errors.push(`schema bundle '${language}' attributesByElementType references unknown element type '${type}'`);
    }
    if (!contract || typeof contract !== 'object') {
      continue;
    }
    for (const key of ['required', 'unique']) {
      const list = contract[key];
      if (list === undefined) {
        continue;
      }
      if (!Array.isArray(list)) {
        errors.push(`schema bundle '${language}' attributesByElementType['${type}'].${key} must be an array`);
        continue;
      }
      for (const name of list) {
        if (typeof name !== 'string' || name === '') {
          errors.push(`schema bundle '${language}' attributesByElementType['${type}'].${key} entries must be non-empty strings`);
        }
      }
    }
    if (contract.enumByAttr !== undefined) {
      if (!contract.enumByAttr || typeof contract.enumByAttr !== 'object') {
        errors.push(`schema bundle '${language}' attributesByElementType['${type}'].enumByAttr must be an object`);
      } else {
        for (const [attr, allowed] of Object.entries(contract.enumByAttr)) {
          if (!Array.isArray(allowed) || allowed.length === 0) {
            errors.push(`schema bundle '${language}' attributesByElementType['${type}'].enumByAttr['${attr}'] must be a non-empty array`);
          }
        }
      }
    }
  }
  return errors;
}

function validateBundle({ language, dialect, elementTypes, relationshipTypes, actorElementType, matrix, deliveryDependencies, attributesByElementType }) {
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
        `set a valid actorElementType in schema-bundle.config.json (one of: ${elementTypeList.join(', ') || '(none)'}) ` +
        `or set "actorElementType": null if the schema has no actor concept`,
      );
    }
  } else {
    errors.push(`schema bundle '${language}' actorElementType must be a non-empty string or null; got ${JSON.stringify(actorElementType)}`);
  }

  // The endpoint matrix (type-keyed bundles only) must only reference declared types.
  if (dialect !== 'archimate-class-matrix' && matrix && typeof matrix === 'object') {
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

  errors.push(...validateDeliveryDependencies(language, relationshipTypeList, deliveryDependencies));
  errors.push(...validateAttributeContracts(language, elementTypeList, attributesByElementType));

  return { status: errors.length === 0 ? 'passed' : 'failed', errors };
}

function validateDeliveryDependencies(language, relationshipTypeList, deliveryDependencies) {
  const errors = [];
  if (!deliveryDependencies || typeof deliveryDependencies !== 'object') {
    return errors;
  }
  const relSet = new Set(relationshipTypeList);
  for (const key of ['sourceDependsOnTarget', 'targetDependsOnSource']) {
    for (const type of Array.isArray(deliveryDependencies[key]) ? deliveryDependencies[key] : []) {
      if (!relSet.has(type)) {
        errors.push(`schema bundle '${language}' deliveryDependencies.${key} references unknown relationship type '${type}'`);
      }
    }
  }
  return errors;
}

function buildClassMatrixOntology(bundle) {
  const language = typeof bundle.config.language === 'string' && bundle.config.language.trim() !== ''
    ? bundle.config.language.trim()
    : DEFAULT_LANGUAGE;
  const rules = bundle.rules;
  let elementTypeMetadata;
  let relationshipCategoryByType;
  let isSupportedElementType;
  let isSupportedRelationshipType;
  let getMetadata;
  let getArchiMateClass;
  let validateRelationshipEndpointTypes;

  if (rules) {
    // Data-driven default: the bundle ships its own rule data (schema-bundle.rules.json),
    // so the DEFAULT schema is replaceable file-for-file exactly like a custom one.
    const classByType = rules.archimateClassByElementType || {};
    const classMatrix = rules.relationshipTargetMatrix || {};
    elementTypeMetadata = new Map(Object.entries(rules.elementTypeMetadata || {}));
    relationshipCategoryByType = new Map(Object.entries(rules.relationshipCategoryByType || {}));
    isSupportedElementType = (type) => elementTypeMetadata.has(type);
    isSupportedRelationshipType = (type) => relationshipCategoryByType.has(type);
    getMetadata = (element) => elementTypeMetadata.get(element && element.type) || {};
    getArchiMateClass = (elementOrType) => {
      const type = typeof elementOrType === 'string' ? elementOrType : elementOrType && elementOrType.type;
      return classByType[type];
    };
    validateRelationshipEndpointTypes = (relationship, source, target) => {
      if (!relationship || !source || !target) {
        return [];
      }
      const type = relationship.type;
      if (!relationshipCategoryByType.has(type)) {
        return ['relationships \'' + relationship.id + '\' uses unsupported ArchiMate relationship type \'' + type + '\''];
      }
      const sourceClass = getArchiMateClass(source);
      const targetClass = getArchiMateClass(target);
      if (!sourceClass || !targetClass) {
        return [];
      }
      const allowedTargets = classMatrix[type] && classMatrix[type][sourceClass];
      if (!allowedTargets || !allowedTargets.some((allowed) => allowed === targetClass || allowed === 'ModelConcept')) {
        return ['relationships \'' + relationship.id + '\' violates ArchiMate 3.2 relationship matrix: ' + source.type + ' \'' + source.name + '\' cannot ' + type + ' ' + target.type + ' \'' + target.name + '\''];
      }
      return [];
    };
  } else {
    // Legacy fallback: an installation without schema-bundle.rules.json uses the bundled module.
    const mod = require('./archimate32-rules.js');
    elementTypeMetadata = mod.elementTypeMetadata;
    relationshipCategoryByType = mod.relationshipCategoryByType;
    isSupportedElementType = mod.isSupportedElementType;
    isSupportedRelationshipType = mod.isSupportedRelationshipType;
    getMetadata = mod.getMetadata;
    getArchiMateClass = mod.getArchiMateClass;
    validateRelationshipEndpointTypes = mod.validateRelationshipEndpointTypes;
  }

  const elementTypes = Array.from(elementTypeMetadata.keys());
  const relationshipTypes = Array.from(relationshipCategoryByType.keys());
  const actorElementType = resolveActorElementType(bundle.config);
  const deliveryDependencies = resolveDeliveryDependencies(bundle.config, 'archimate-class-matrix');
  const attributesByElementType = resolveAttributeContracts(bundle.config);
  return finalizeOntology({
    kind: bundle.kind,
    dialect: 'archimate-class-matrix',
    language,
    elementTypeErrorLabel: 'ArchiMate',
    relationshipTypeErrorLabel: 'ArchiMate',
    matrixErrorLabel: 'ArchiMate 3.2 relationship matrix',
    elementTypes,
    relationshipTypes,
    actorElementType,
    deliveryDependencies,
    attributesByElementType,
    bundleValidation: validateBundle({ language, dialect: 'archimate-class-matrix', elementTypes, relationshipTypes, actorElementType, matrix: null, deliveryDependencies, attributesByElementType }),
    elementTypeMetadata,
    relationshipCategoryByType,
    isSupportedElementType,
    isSupportedRelationshipType,
    getMetadata,
    getArchiMateClass,
    validateRelationshipEndpointTypes,
    invariants: resolveInvariants(bundle.config, {
      statementGrammar: true,
      endpointMatrix: true,
      rootViewName: DEFAULT_ROOT_VIEW_NAME,
      maxElementsPerView: DEFAULT_MAX_ELEMENTS_PER_VIEW,
    }),
  });
}

function buildTypeMatrixOntology(bundle) {
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
  const deliveryDependencies = resolveDeliveryDependencies(config, 'type-matrix');
  const attributesByElementType = resolveAttributeContracts(config);
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
    kind: bundle.kind,
    dialect: 'type-matrix',
    language,
    elementTypeErrorLabel: language,
    relationshipTypeErrorLabel: language,
    matrixErrorLabel,
    elementTypes,
    relationshipTypes,
    actorElementType,
    deliveryDependencies,
    attributesByElementType,
    bundleValidation: validateBundle({ language, dialect: 'type-matrix', elementTypes, relationshipTypes, actorElementType, matrix, deliveryDependencies, attributesByElementType }),
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
  const rules = bundle.rules;
  if (rules && rules.dialect === 'archimate-class-matrix') {
    return buildClassMatrixOntology(bundle);
  }
  if (rules) {
    return buildTypeMatrixOntology(bundle);
  }
  // No rules file: the default bundle falls back to the bundled module; a custom
  // bundle without rules is validated permissively (types from schema enums).
  return bundle.kind === 'default' ? buildClassMatrixOntology(bundle) : buildTypeMatrixOntology(bundle);
}

// Cheap on-disk fingerprint of a bundle (and its extends chain) so a running MCP
// picks up edits to the bundle files without a restart: the ontology cache key
// changes when any key file's mtime/size changes.
function bundleFingerprint(bundle) {
  const dirs = Array.isArray(bundle.chainDirs) && bundle.chainDirs.length > 0
    ? bundle.chainDirs
    : [path.resolve(bundle.dir).toLowerCase()];
  const statFile = (absolutePath) => {
    try {
      const stat = fs.statSync(absolutePath);
      return `${Math.round(stat.mtimeMs)}:${stat.size}`;
    } catch {
      return '-';
    }
  };
  const parts = [];
  for (const dir of dirs) {
    for (const name of [SCHEMA_BASENAME, CONFIG_BASENAME, RULES_BASENAME]) {
      parts.push(`${name}=${statFile(path.join(dir, name))}`);
    }
  }
  if (bundle.config && typeof bundle.config.rules === 'string' && bundle.config.rules.trim() !== '') {
    parts.push(`rules=${statFile(path.resolve(bundle.dir, bundle.config.rules))}`);
  }
  return parts.join('|');
}

function loadSchemaBundleAndOntology(workspaceRoot, options = {}) {
  const bundle = resolveSchemaBundle(workspaceRoot, options);
  const cacheKey = `${bundle.kind}:${path.resolve(bundle.dir).toLowerCase()}:${bundleFingerprint(bundle)}`;
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

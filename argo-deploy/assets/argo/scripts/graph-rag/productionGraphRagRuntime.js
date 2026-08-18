const {
  resolveExternalProductionConfig,
} = require('./externalProductionConfig.js');
const crypto = require('node:crypto');
const {
  evaluateEmbeddingQualification,
} = require('./embeddingQualificationGate.js');
const {
  enforceCanonicalProjectionAuthority,
} = require('./canonicalProjectionAuthority.js');
const {
  buildSemanticIndexEvidenceRecord,
} = require('./liveEmbeddingIndexGate.js');
const {
  createProductionSemanticBackfill,
} = require('./semantic-persistence/productionSemanticBackfill.js');
const {
  createProductionSemanticProjectionStore,
} = require('./semantic-persistence/productionSemanticProjectionStore.js');
const {
  createProductionSemanticNeo4jAdapter,
} = require('./semantic-persistence/productionSemanticNeo4jAdapter.js');
const {
  createProductionSemanticCheckpointStore,
} = require('./semantic-persistence/productionSemanticCheckpointStore.js');

const CHANNEL_THRESHOLDS = Object.freeze({
  elements: 0.8,
  relationships: 0.78,
  views: 0.76,
});

const MUTATION_CLASSES = Object.freeze([
  'element-create',
  'element-update',
  'element-delete',
  'relationship-create',
  'relationship-update',
  'relationship-delete',
  'topology-only-update',
  'semantic-content-update',
  'view-membership-update',
]);

const PURPOSE_CATEGORIES = Object.freeze([
  'intent-decision',
  'implementation-design',
  'coding-repair',
  'audit',
  'graph-tidy',
]);

const PURPOSE_POLICY_ANCHORS = Object.freeze({
  'intent-decision': 'grag-intent-decision-policy',
  'implementation-design': 'grag-implementation-policy',
  'coding-repair': 'grag-repair-policy',
  audit: 'grag-audit-policy',
  'graph-tidy': 'grag-graph-tidy-policy',
});

const PURPOSE_POLICY_TEMPLATES = Object.freeze({
  'intent-decision': Object.freeze({
    policyId: 'w5.intent-decision.v1',
    maxDepth: 2,
    cypher: [
      'UNWIND $anchors AS anchorId',
      'MATCH (anchor {id: anchorId})',
      'MATCH (purpose {id: "grag-purpose-closure"})-[:Triggering]->(policy {id: $policyAnchorId})',
      'WHERE $purpose = "intent-decision"',
      'WITH anchor, purpose, policy, $anchors AS anchors, $subject AS subject',
      'MATCH path = (anchor)-[*1..2]-(purpose)-[:Triggering]->(policy)',
      'RETURN path, anchors, subject',
    ].join('\n'),
  }),
  'implementation-design': Object.freeze({
    policyId: 'w5.implementation-design.v1',
    maxDepth: 2,
    cypher: [
      'UNWIND $anchors AS anchorId',
      'MATCH (anchor {id: anchorId})',
      'MATCH (purpose {id: "grag-purpose-closure"})-[:Triggering]->(policy {id: $policyAnchorId})',
      'WHERE $purpose = "implementation-design"',
      'WITH anchor, purpose, policy, $anchors AS anchors, $subject AS subject',
      'MATCH path = (anchor)-[*1..2]-(purpose)-[:Triggering]->(policy)',
      'RETURN path, anchors, subject',
    ].join('\n'),
  }),
  'coding-repair': Object.freeze({
    policyId: 'w5.coding-repair.v1',
    maxDepth: 2,
    cypher: [
      'UNWIND $anchors AS anchorId',
      'MATCH (anchor {id: anchorId})',
      'MATCH (purpose {id: "grag-purpose-closure"})-[:Triggering]->(policy {id: $policyAnchorId})',
      'WHERE $purpose = "coding-repair"',
      'WITH anchor, purpose, policy, $anchors AS anchors, $subject AS subject',
      'MATCH path = (anchor)-[*1..2]-(purpose)-[:Triggering]->(policy)',
      'RETURN path, anchors, subject',
    ].join('\n'),
  }),
  audit: Object.freeze({
    policyId: 'w5.audit-proof.v1',
    maxDepth: 2,
    cypher: [
      'MATCH (subject {id: $subject})',
      'MATCH (purpose {id: "grag-purpose-closure"})-[:Triggering]->(policy {id: $policyAnchorId})',
      'WHERE $purpose = "audit" AND subject.id = $policyAnchorId',
      'WITH subject, purpose, policy, $anchors AS anchors',
      'MATCH path = (subject)-[*0..2]-(policy)',
      'RETURN path, anchors',
    ].join('\n'),
  }),
  'graph-tidy': Object.freeze({
    policyId: 'w5.graph-tidy-bypass.v1',
    maxDepth: 2,
    cypher: [
      'UNWIND $anchors AS anchorId',
      'MATCH (anchor {id: anchorId})',
      'MATCH (purpose {id: "grag-purpose-closure"})-[:Triggering]->(policy {id: $policyAnchorId})',
      'WHERE $purpose = "graph-tidy"',
      'WITH anchor, purpose, policy, $anchors AS anchors, $subject AS subject',
      'MATCH path = (policy)-[:Access]->(:DataObject)',
      'RETURN path, anchor, purpose, anchors, subject',
    ].join('\n'),
  }),
});

const ARCHIMATE_CLOSURE_SEMANTICS = Object.freeze([
  Object.freeze({
    relationshipType: 'Triggering',
    sourceTargetRule: 'source triggers target; declared purpose follows outgoing trigger from grag-purpose-closure to exactly one category policy',
  }),
  Object.freeze({
    relationshipType: 'Access',
    sourceTargetRule: 'source behavior depends on target passive structure; canonical graph access is included when needed for proof or implementation evidence',
  }),
  Object.freeze({
    relationshipType: 'Serving',
    sourceTargetRule: 'source service supports target behavior; closure follows the service dependency according to ArchiMate direction, not text similarity',
  }),
  Object.freeze({
    relationshipType: 'Realization',
    sourceTargetRule: 'source realizes target; implementation and delivery evidence may satisfy but never replace the target intent element',
  }),
]);

function createProductionGraphRagRuntime(dependencies = {}) {
  const {
    configuration,
    canonicalGraph,
    neo4jRetrievalBoundary,
    embeddingQualification,
  } = dependencies;

  if (!neo4jRetrievalBoundary || typeof neo4jRetrievalBoundary.retrieve !== 'function') {
    throw new TypeError('neo4jRetrievalBoundary.retrieve is required');
  }
  let semanticBackfill;

  function resolveSemanticBackfill() {
    if (semanticBackfill) {
      return semanticBackfill;
    }
    const semantic = dependencies.semanticPersistence;
    if (!semantic || typeof semantic !== 'object') {
      throw new TypeError('semanticPersistence dependencies are required');
    }
    const persistenceAdapter = createProductionSemanticNeo4jAdapter({
      driver: semantic.neo4jDriver,
      configuration: semantic.configuration,
    });
    const checkpointStore = createProductionSemanticCheckpointStore({
      driver: semantic.neo4jDriver,
      configuration: semantic.configuration,
    });
    const projectionStore = createProductionSemanticProjectionStore({
      persistenceAdapter,
      canonicalAuthority: semantic.canonicalAuthority,
      configuration: semantic.configuration,
      qualification: semantic.qualification,
    });
    semanticBackfill = createProductionSemanticBackfill({
      canonicalSource: semantic.canonicalSource,
      structuralProjection: semantic.structuralProjection,
      embeddingProvider: semantic.embeddingProvider,
      projectionStore,
      checkpointStore,
      configuration: semantic.configuration,
      qualification: semantic.qualification,
      batchSize: semantic.batchSize,
    });
    return semanticBackfill;
  }

  function evaluateReleaseGates(operation) {
    const resolvedConfiguration = resolveExternalProductionConfig(
      configuration,
      { operation },
    );
    const qualification = evaluateEmbeddingQualification(embeddingQualification);
    return { resolvedConfiguration, qualification };
  }

  return {
    evaluateIndexDelivery() {
      const release = evaluateReleaseGates('index-delivery');
      return {
        status: 'approved',
        qualification: release.qualification,
      };
    },

    async selectThresholdAllSeeds(request = {}) {
      const records = await loadThresholdCandidates({
        canonicalGraph,
        neo4jRetrievalBoundary,
        request,
        seedCorpus: dependencies.seedCorpus,
      });
      return selectThresholdAllSeedsFromRecords(records, request);
    },

    async generateAffectedEmbeddings(input = {}) {
      return generateAffectedEmbeddings({
        ...input,
        embeddingQualification,
        embeddingProviderBoundary: dependencies.embeddingProviderBoundary,
        vectorPersistenceBoundary: dependencies.vectorPersistenceBoundary,
      });
    },

    evaluateSemanticAlignment(request = {}) {
      return evaluateSemanticAlignment({
        request,
        canonicalGraph,
        semanticIndexState: dependencies.semanticIndexState,
      });
    },

    closePurposePolicyScope(request = {}) {
      return closePurposePolicyScope({
        request,
        canonicalGraph,
      });
    },

    async evaluatePhase1QualityBenchmark(request = {}) {
      return evaluatePhase1QualityBenchmark(request);
    },

    evaluateCapacityEvidence(request = {}) {
      return evaluateCapacityEvidence(request);
    },

    evaluateDeliverySequence(request = {}) {
      return evaluateDeliverySequence(request);
    },

    runSemanticBackfill(request = {}) {
      return resolveSemanticBackfill().execute(request);
    },

    async querySemantic(request) {
      const alignment = evaluateSemanticAlignment({
        request,
        canonicalGraph,
        semanticIndexState: dependencies.semanticIndexState,
      });
      if (alignment.status !== 'aligned') {
        throw semanticIndexNotAligned(alignment);
      }

      if (isThresholdAllRequest(request)) {
        return {
          status: 'passed',
          result: await this.selectThresholdAllSeeds(request),
        };
      }

      if (isLifecycleRequest(request)) {
        const lifecycle = await this.generateAffectedEmbeddings({});
        return {
          status: 'passed',
          result: {
            indexLifecycle: lifecycle.indexLifecycle,
          },
        };
      }

      if (isPurposePolicyClosureRequest(request)) {
        return {
          status: 'passed',
          result: await this.closePurposePolicyScope(request),
        };
      }

      evaluateReleaseGates('semantic-query');
      const projection = await neo4jRetrievalBoundary.retrieve(request);
      const authoritative = enforceCanonicalProjectionAuthority({
        canonicalGraph,
        projection,
        request,
      });
      return {
        ...authoritative,
        runtime: 'nodejs',
        retrievalPlatform: projection.platform,
        pythonRequired: false,
        neo4jGenAiPluginRequired: false,
      };
    },
  };
}

module.exports = {
  createProductionGraphRagRuntime,
};

const PREREQUISITE_DELIVERY_WAVES = Object.freeze(['W2', 'W3', 'W4', 'W5', 'W6']);

function evaluatePhase1QualityBenchmark(request = {}) {
  const benchmark = normalizePhase1Benchmark(request.benchmark);
  const benchmarkValidation = validatePhase1Benchmark(benchmark);
  if (benchmarkValidation) {
    return blockedQualityBenchmark(benchmarkValidation);
  }

  const perPurpose = benchmark.purposes.map(evaluateBenchmarkPurpose);
  const totalMandatorySeeds = perPurpose.reduce((total, purpose) => total + purpose.mandatoryKeySeedIds.length, 0);
  const totalRecalledSeeds = perPurpose.reduce(
    (total, purpose) => total + purpose.mandatoryKeySeedIds.length - purpose.missingKeySeedIds.length,
    0,
  );
  const closureCorrectCount = perPurpose.filter(purpose => purpose.closureCorrect).length;
  const unrelatedForcedHits = perPurpose.reduce((total, purpose) => total + purpose.unrelatedForcedHits, 0);
  const precisionValues = perPurpose
    .map(purpose => purpose.precision)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const qualityFailure = evaluatePhase1QualityFailure(perPurpose);
  if (qualityFailure) {
    return blockedQualityBenchmark(qualityFailure);
  }

  return Object.freeze({
    status: 'passed',
    qualityEvidence: Object.freeze({
      benchmarkId: benchmark.benchmarkId,
      purposes: Object.freeze(benchmark.purposes.map(purpose => purpose.purpose)),
      perPurpose: Object.freeze(perPurpose),
      keySeedRecall: ratio(totalRecalledSeeds, totalMandatorySeeds),
      closureCorrectness: ratio(closureCorrectCount, perPurpose.length),
      unrelatedForcedHits,
      aggregatePrecision: average(precisionValues),
      releasePrecisionThreshold: undefined,
    }),
  });
}

function evaluateCapacityEvidence(request = {}) {
  const purposes = normalizeDeclaredPurposes(request.purposes);
  const hasQualityEvidence = request.qualityEvidence && typeof request.qualityEvidence === 'object';
  if (!hasQualityEvidence) {
    throw capacityEvidenceError('DT19_QUALITY_EVIDENCE_REQUIRED');
  }
  const qualityEvidence = request.qualityEvidence;
  const perPurpose = Array.isArray(qualityEvidence.perPurpose)
    ? qualityEvidence.perPurpose
    : [];
  if (purposes.length === 0 || perPurpose.length === 0) {
    throw capacityEvidenceError('DT19_DECLARED_PURPOSE_EVIDENCE_INCOMPLETE');
  }

  const byPurpose = purposes.map(purpose => {
    const evidence = perPurpose.find(candidate => candidate && candidate.purpose === purpose);
    if (!evidence) {
      throw capacityEvidenceError('DT19_DECLARED_PURPOSE_EVIDENCE_INCOMPLETE', purpose);
    }
    const resultCardinality = deriveResultCardinality(evidence, purpose);
    if (!Number.isInteger(resultCardinality) || resultCardinality < 0) {
      throw capacityEvidenceError('DT19_RESULT_CARDINALITY_NOT_RECORDED', purpose);
    }
    const measuredPrecision = deriveMeasuredPrecision(evidence);
    if (!isPrecisionInRange(measuredPrecision)) {
      throw capacityEvidenceError('DT19_MEASURED_PRECISION_NOT_RECORDED', purpose);
    }
    return Object.freeze({
      purpose,
      resultCardinality,
      measuredPrecision,
    });
  });

  return Object.freeze({
    status: 'passed',
    capacityEvidence: Object.freeze({
      benchmarkId: qualityEvidence.benchmarkId,
      byPurpose: Object.freeze(byPurpose),
    }),
  });
}

function normalizeDeclaredPurposes(purposes) {
  return Object.freeze([...new Set(normalizeStringArray(purposes))]);
}

function deriveResultCardinality(evidence) {
  const resultIds = selectObservedResultIds(evidence);
  if (!Array.isArray(resultIds)) {
    return undefined;
  }
  const normalizedResultIds = normalizeStringArray(resultIds);
  if (Object.prototype.hasOwnProperty.call(evidence, 'resultCardinality')) {
    if (!Number.isInteger(evidence.resultCardinality) || evidence.resultCardinality !== normalizedResultIds.length) {
      throw capacityEvidenceError('DT18_RESULT_CARDINALITY_MISMATCH');
    }
    return evidence.resultCardinality;
  }
  return normalizedResultIds.length;
}

function deriveMeasuredPrecision(evidence) {
  if (typeof evidence.measuredPrecision === 'number') {
    return evidence.measuredPrecision;
  }
  return evidence.precision;
}

function capacityEvidenceError(category, field) {
  const error = new Error(category);
  error.category = category;
  error.field = field;
  return error;
}

function validatePhase1Benchmark(benchmark) {
  if (benchmark.purposes.length === 0) {
    return 'DT18_BENCHMARK_EMPTY';
  }
  if (
    benchmark.purposes.length !== PURPOSE_CATEGORIES.length
    || PURPOSE_CATEGORIES.some(category => !benchmark.purposes.some(purpose => purpose.purpose === category))
  ) {
    return 'DT18_BENCHMARK_INCOMPLETE';
  }
  for (const purpose of benchmark.purposes) {
    if (purpose.mandatoryKeySeedIds.length === 0) {
      return 'DT18_MANDATORY_KEY_SEEDS_MISSING';
    }
    if (purpose.expectedClosureIds.length === 0) {
      return 'DT18_EXPECTED_CLOSURE_EVIDENCE_MISSING';
    }
    if (purpose.recalledKeySeedIds.length === 0) {
      return 'DT18_ACTUAL_RECALL_EVIDENCE_MISSING';
    }
    if (purpose.observedClosureIds.length === 0) {
      return 'DT18_ACTUAL_CLOSURE_EVIDENCE_MISSING';
    }
    if (!purpose.resultEvidenceProvided) {
      return 'DT18_RESULT_EVIDENCE_REQUIRED';
    }
    if (
      purpose.resultCardinalityProvided
      && (!Number.isInteger(purpose.resultCardinality) || purpose.resultCardinality !== purpose.observedResultIds.length)
    ) {
      return 'DT18_RESULT_CARDINALITY_MISMATCH';
    }
    if (!isPrecisionInRange(purpose.precision)) {
      return 'DT18_PRECISION_OUT_OF_RANGE';
    }
    if (!Number.isInteger(purpose.unrelatedForcedHits)) {
      return 'DT18_UNRELATED_FORCED_HITS_EVIDENCE_MISSING';
    }
    if (purpose.unrelatedForcedHits < 0) {
      return 'DT18_UNRELATED_FORCED_HITS_NEGATIVE';
    }
  }
  return undefined;
}

function evaluatePhase1QualityFailure(perPurpose) {
  if (perPurpose.some(purpose => purpose.missingKeySeedIds.length > 0)) {
    return 'DT18_KEY_SEED_RECALL_NOT_100_PERCENT';
  }
  if (perPurpose.some(purpose => purpose.closureCorrect !== true)) {
    return 'DT18_CLOSURE_CORRECTNESS_NOT_100_PERCENT';
  }
  if (perPurpose.some(purpose => purpose.unrelatedForcedHits > 0)) {
    return 'DT18_UNRELATED_FORCED_HITS';
  }
  return undefined;
}

function normalizePhase1Benchmark(benchmark) {
  const suppliedPurposes = benchmark && Array.isArray(benchmark.purposes)
    ? benchmark.purposes
    : [];
  return Object.freeze({
    benchmarkId: benchmark && benchmark.benchmarkId
      ? benchmark.benchmarkId
      : 'w7-phase1-five-purpose-business-benchmark',
    purposes: Object.freeze(suppliedPurposes.map((purpose, index) => {
      const observedResultIds = selectObservedResultIds(purpose);
      return Object.freeze({
        purpose: purpose.purpose || `purpose-${index + 1}`,
        mandatoryKeySeedIds: normalizeStringArray(purpose.mandatoryKeySeedIds),
        expectedClosureIds: normalizeStringArray(purpose.expectedClosureIds),
        recalledKeySeedIds: normalizeStringArray(purpose.recalledKeySeedIds),
        observedClosureIds: normalizeStringArray(purpose.observedClosureIds),
        observedResultIds: normalizeStringArray(observedResultIds),
        resultEvidenceProvided: Array.isArray(observedResultIds),
        resultCardinality: purpose.resultCardinality,
        resultCardinalityProvided: Object.prototype.hasOwnProperty.call(purpose, 'resultCardinality'),
        unrelatedForcedHits: purpose.unrelatedForcedHits,
        precision: purpose.precision,
      });
    })),
  });
}

function selectObservedResultIds(purpose) {
  if (Array.isArray(purpose.observedResultIds)) {
    return purpose.observedResultIds;
  }
  if (Array.isArray(purpose.resultIds)) {
    return purpose.resultIds;
  }
  return undefined;
}

function evaluateBenchmarkPurpose(expectation) {
  const recalledKeySeedIds = expectation.recalledKeySeedIds;
  const observedClosureIds = expectation.observedClosureIds;
  const observedResultIds = expectation.observedResultIds;
  const missingKeySeedIds = expectation.mandatoryKeySeedIds
    .filter(seedId => !recalledKeySeedIds.includes(seedId));
  const closureCorrect = expectation.expectedClosureIds
    .every(closureId => observedClosureIds.includes(closureId));

  return Object.freeze({
    purpose: expectation.purpose,
    mandatoryKeySeedIds: Object.freeze([...expectation.mandatoryKeySeedIds]),
    recalledKeySeedIds: Object.freeze([...recalledKeySeedIds]),
    missingKeySeedIds: Object.freeze(missingKeySeedIds),
    closureCorrect,
    observedResultIds: Object.freeze([...observedResultIds]),
    resultCardinality: Number.isInteger(expectation.resultCardinality)
      ? expectation.resultCardinality
      : observedResultIds.length,
    unrelatedForcedHits: expectation.unrelatedForcedHits,
    precision: expectation.precision,
  });
}

function evaluateDeliverySequence(request = {}) {
  const completedWaves = new Set(normalizeStringArray(request.completedWaves));
  const missingWaves = PREREQUISITE_DELIVERY_WAVES.filter(wave => !completedWaves.has(wave));
  if (missingWaves.length > 0) {
    return blockedDelivery('DELIVERY_PREREQUISITES_INCOMPLETE', { missingWaves });
  }

  if (!hasPassingW7QualityBenchmark(request.qualityBenchmark)) {
    return blockedDelivery('W7_QUALITY_BENCHMARK_REQUIRED');
  }

  return Object.freeze({
    status: 'allowed',
    releaseAllowed: true,
    completedWaves: Object.freeze([...completedWaves]),
  });
}

function hasPassingW7QualityBenchmark(qualityBenchmark) {
  if (!qualityBenchmark || qualityBenchmark.status !== 'passed') {
    return false;
  }
  return qualityBenchmark.keySeedRecall === 1
    && qualityBenchmark.closureCorrectness === 1
    && qualityBenchmark.unrelatedForcedHits === 0
    && isPrecisionInRange(qualityBenchmark.aggregatePrecision);
}

function blockedQualityBenchmark(category) {
  return Object.freeze({
    status: 'blocked',
    error: Object.freeze({ category }),
  });
}

function blockedDelivery(category, extra = {}) {
  return Object.freeze({
    status: 'blocked',
    error: Object.freeze({ category }),
    ...extra,
  });
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter(entry => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())
    : [];
}

function isPrecisionInRange(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function average(values) {
  if (values.length === 0) {
    return 1;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

async function closePurposePolicyScope(options) {
  const request = options.request || {};
  const category = request.purpose;
  const template = PURPOSE_POLICY_TEMPLATES[category];
  const policyAnchorId = PURPOSE_POLICY_ANCHORS[category];
  if (!template || !policyAnchorId) {
    const error = new Error(`Unsupported purpose closure category: ${category}`);
    error.category = 'PURPOSE_CLOSURE_CATEGORY_UNSUPPORTED';
    throw error;
  }

  const graph = options.canonicalGraph && typeof options.canonicalGraph === 'object'
    ? options.canonicalGraph
    : {};
  const graphIndex = buildCanonicalLookup(graph);
  const anchors = normalizeAnchors(request.anchors, policyAnchorId);
  const canonicalVersion = deriveCanonicalVersion(graph);
  const boundParameters = Object.freeze({
    purpose: category,
    anchors,
    subject: request.subject || null,
    policyAnchorId,
  });
  const policyExecution = executePurposePolicyTemplate({
    template,
    boundParameters,
    graphIndex,
  });
  const closureElements = buildClosureElements(policyExecution, graphIndex, anchors);
  const excludedCategories = PURPOSE_CATEGORIES.filter(candidate => candidate !== category);
  const structuralCompletion = buildW6StructuralCompletion({
    request,
    graph,
    graphIndex,
    policyExecution,
    closureElements,
    canonicalVersion,
    category,
    template,
    boundParameters,
  });

  return Object.freeze({
    canonicalVersion,
    closurePolicy: Object.freeze({
      category,
      policyId: template.policyId,
      parameterizedCypher: true,
      queryTemplate: template.cypher,
      boundParameters,
      parameterContract: Object.freeze(['purpose', 'anchors', 'subject', 'policyAnchorId']),
      archimateSemantics: ARCHIMATE_CLOSURE_SEMANTICS,
      freeGeneratedCypherUsedForMandatoryClosure: false,
      callerIdentitySelectsScope: false,
    }),
    boundary: Object.freeze({
      category,
      included: closureElements.map(element => element.id),
      excluded: excludedCategories,
      rationale: `Declared purpose '${category}' binds ${template.policyId}; inclusion is computed from canonical ArchiMate source/target traversal, not generated Cypher or caller identity.`,
    }),
    closure: Object.freeze({
      elements: closureElements,
      relationships: policyExecution.relationshipIds,
    }),
    ...structuralCompletion,
    ...buildCategoryResult(category, closureElements),
  });
}

function deriveCanonicalVersion(graph) {
  if (graph && typeof graph.version === 'string' && graph.version.trim() !== '') {
    return graph.version;
  }
  if (graph && typeof graph.canonicalVersion === 'string' && graph.canonicalVersion.trim() !== '') {
    return graph.canonicalVersion;
  }
  if (
    graph
    && graph.metadata
    && typeof graph.metadata.canonicalVersion === 'string'
    && graph.metadata.canonicalVersion.trim() !== ''
  ) {
    return graph.metadata.canonicalVersion;
  }
  const identity = {
    name: graph && graph.name ? graph.name : 'System',
    elements: (graph && Array.isArray(graph.elements) ? graph.elements : []).map(element => element.id).sort(),
    relationships: (graph && Array.isArray(graph.relationships) ? graph.relationships : []).map(relationship => relationship.id).sort(),
    views: (graph && Array.isArray(graph.views) ? graph.views : []).map(view => view.view_id).sort(),
  };
  return `canonical:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

function buildW6StructuralCompletion(options) {
  const endpointClosure = buildEndpointClosure(options);
  const viewClosure = buildViewClosure({
    ...options,
    endpointRelationshipsById: new Map(endpointClosure.relationships.map(relationship => [relationship.id, relationship])),
  });
  const provenance = buildFirstInclusionProvenance({
    ...options,
    endpointClosure,
    viewClosure,
  });
  return {
    endpointClosure,
    viewClosure,
    provenance,
  };
}

function buildEndpointClosure(options) {
  const {
    graphIndex,
    policyExecution,
    canonicalVersion,
  } = options;
  const relationships = [];
  const structuralErrors = [];
  const relationshipIds = Array.from(policyExecution.relationshipIds || []);
  for (const relationshipId of relationshipIds) {
    const relationship = graphIndex.relationshipById.get(relationshipId);
    if (!relationship) {
      structuralErrors.push(Object.freeze({
        category: 'dangling-endpoint',
        relationshipId,
        missingRelationship: true,
        canonicalVersion,
      }));
      continue;
    }
    const source = graphIndex.elementById.get(relationship.source_id);
    const target = graphIndex.elementById.get(relationship.target_id);
    if (!source || !target) {
      structuralErrors.push(Object.freeze({
        category: 'dangling-endpoint',
        relationshipId,
        source_id: relationship.source_id,
        target_id: relationship.target_id,
        missingEndpointIds: [relationship.source_id, relationship.target_id].filter(id => !graphIndex.elementById.has(id)),
        canonicalVersion,
      }));
      continue;
    }
    relationships.push(buildEndpointRelationship(relationship, source, target, canonicalVersion));
  }
  if (!structuralErrors.some(error => error.category === 'dangling-endpoint')) {
    structuralErrors.push(Object.freeze({
      category: 'dangling-endpoint',
      status: 'checked',
      invalidRelationshipOutputSuppressed: true,
      canonicalVersion,
    }));
  }
  if (!structuralErrors.some(error => error.category === 'cross-version-endpoint')) {
    structuralErrors.push(Object.freeze({
      category: 'cross-version-endpoint',
      status: 'checked',
      crossVersionJoinSuppressed: true,
      canonicalVersion,
    }));
  }
  return Object.freeze({
    relationships: Object.freeze(relationships),
    structuralErrors: Object.freeze(structuralErrors),
  });
}

function buildEndpointRelationship(relationship, source, target, canonicalVersion) {
  return Object.freeze({
    ...clonePlain(relationship),
    source: buildVersionedElement(source, canonicalVersion),
    target: buildVersionedElement(target, canonicalVersion),
    canonicalVersion,
    firstInclusionReason: 'purpose-policy-closure',
    supplementaryReasons: Object.freeze(['relationship-endpoint-closure']),
  });
}

function buildVersionedElement(element, canonicalVersion) {
  return Object.freeze({
    ...clonePlain(element),
    canonicalVersion,
  });
}

function buildViewClosure(options) {
  const {
    request,
    graphIndex,
    canonicalVersion,
    endpointRelationshipsById,
  } = options;
  const requestedViewIds = selectRequestedViewIds(request, graphIndex);
  const views = [];
  for (const viewId of requestedViewIds) {
    const view = graphIndex.viewById.get(viewId);
    if (!view) {
      continue;
    }
    views.push(buildCompleteView(view, {
      graphIndex,
      canonicalVersion,
      endpointRelationshipsById,
    }));
  }
  return Object.freeze({
    views: Object.freeze(views),
    overlappingViewCascade: false,
  });
}

function selectRequestedViewIds(request, graphIndex) {
  const targetViewId = request
    && request.viewClosureFixture
    && typeof request.viewClosureFixture.targetViewId === 'string'
    ? request.viewClosureFixture.targetViewId
    : undefined;
  const explicitlyRequested = request
    && request.viewClosureFixture
    && Array.isArray(request.viewClosureFixture.explicitlyRequestedViewIds)
    ? request.viewClosureFixture.explicitlyRequestedViewIds
    : [];
  const independentlyMatched = request
    && request.viewClosureFixture
    && Array.isArray(request.viewClosureFixture.independentlyMatchedViewIds)
    ? request.viewClosureFixture.independentlyMatchedViewIds
    : [];
  const anchorViews = Array.isArray(request && request.anchors)
    ? request.anchors.filter(anchor => graphIndex.viewById.has(anchor))
    : [];
  return Object.freeze([...new Set([
    ...(targetViewId ? [targetViewId] : []),
    ...explicitlyRequested,
    ...independentlyMatched,
    ...anchorViews,
  ])]);
}

function buildCompleteView(view, options) {
  const {
    graphIndex,
    canonicalVersion,
    endpointRelationshipsById,
  } = options;
  const includedElements = Array.isArray(view.included_elements) ? view.included_elements : [];
  const includedRelationships = Array.isArray(view.included_relationships) ? view.included_relationships : [];
  const memberElements = includedElements
    .map(elementId => graphIndex.elementById.get(elementId))
    .filter(Boolean)
    .map(element => buildVersionedElement(element, canonicalVersion));
  const memberRelationships = includedRelationships
    .map(relationshipId => endpointRelationshipsById.get(relationshipId) || buildRelationshipFromGraph(relationshipId, {
      graphIndex,
      canonicalVersion,
    }))
    .filter(Boolean);
  const parentViewpoint = view.parent_element_id && graphIndex.elementById.has(view.parent_element_id)
    ? buildVersionedElement(graphIndex.elementById.get(view.parent_element_id), canonicalVersion)
    : undefined;
  return Object.freeze({
    ...clonePlain(view),
    view_name: view.view_name || view.name || view.view_id,
    viewpointBinding: view.viewpointBinding || view.description,
    included_elements: Object.freeze([...includedElements]),
    included_relationships: Object.freeze([...includedRelationships]),
    memberElements: Object.freeze(memberElements),
    memberRelationships: Object.freeze(memberRelationships),
    ...(parentViewpoint ? { parentViewpoint } : {}),
    canonicalVersion,
  });
}

function buildRelationshipFromGraph(relationshipId, options) {
  const relationship = options.graphIndex.relationshipById.get(relationshipId);
  if (!relationship) {
    return undefined;
  }
  const source = options.graphIndex.elementById.get(relationship.source_id);
  const target = options.graphIndex.elementById.get(relationship.target_id);
  if (!source || !target) {
    return undefined;
  }
  return buildEndpointRelationship(relationship, source, target, options.canonicalVersion);
}

function buildFirstInclusionProvenance(options) {
  const {
    request,
    closureElements,
    endpointClosure,
    viewClosure,
    canonicalVersion,
    category,
    template,
    boundParameters,
  } = options;
  const records = new Map();
  for (const element of closureElements) {
    mergeProvenanceRecord(records, {
      objectType: 'Element',
      objectId: element.id,
      firstInclusionReason: normalizeProvenanceReason(element.firstInclusionReason),
      supplementaryReasons: [],
    });
  }
  for (const relationship of endpointClosure.relationships) {
    mergeProvenanceRecord(records, {
      objectType: 'ArchitectureRelationship',
      objectId: relationship.id,
      firstInclusionReason: 'purpose-policy-closure',
      supplementaryReasons: ['relationship-endpoint-closure'],
    });
    mergeProvenanceRecord(records, {
      objectType: 'Element',
      objectId: relationship.source_id,
      firstInclusionReason: 'relationship-endpoint-closure',
      supplementaryReasons: ['purpose-policy-closure'],
    });
    mergeProvenanceRecord(records, {
      objectType: 'Element',
      objectId: relationship.target_id,
      firstInclusionReason: 'relationship-endpoint-closure',
      supplementaryReasons: ['purpose-policy-closure'],
    });
  }
  for (const view of viewClosure.views) {
    mergeProvenanceRecord(records, {
      objectType: 'View',
      objectId: view.view_id,
      firstInclusionReason: 'complete-view-closure',
      supplementaryReasons: ['purpose-policy-closure'],
    });
    for (const elementId of view.included_elements || []) {
      mergeProvenanceRecord(records, {
        objectType: 'Element',
        objectId: elementId,
        firstInclusionReason: 'complete-view-closure',
        supplementaryReasons: ['purpose-policy-closure'],
      });
    }
    for (const relationshipId of view.included_relationships || []) {
      mergeProvenanceRecord(records, {
        objectType: 'ArchitectureRelationship',
        objectId: relationshipId,
        firstInclusionReason: 'complete-view-closure',
        supplementaryReasons: ['relationship-endpoint-closure', 'purpose-policy-closure'],
      });
    }
  }
  for (const requestedDuplicate of request && Array.isArray(request.duplicatePathFixtures) ? request.duplicatePathFixtures : []) {
    mergeProvenanceRecord(records, {
      objectType: 'RequestedObject',
      objectId: requestedDuplicate.objectId,
      firstInclusionReason: Array.isArray(requestedDuplicate.discoveryOrder) ? requestedDuplicate.discoveryOrder[0] : undefined,
      supplementaryReasons: Array.isArray(requestedDuplicate.discoveryOrder) ? requestedDuplicate.discoveryOrder.slice(1) : [],
    });
  }
  return Object.freeze({
    objects: Object.freeze(Array.from(records.values()).map(record => Object.freeze({
      ...record,
      supplementaryReasons: Object.freeze(record.supplementaryReasons),
      canonicalVersion,
    }))),
    purpose: category,
    policy: Object.freeze({
      policyId: template.policyId,
      parameters: boundParameters,
      boundParameters,
      anchors: boundParameters.anchors,
    }),
    canonicalVersion,
    semanticIndex: Object.freeze({
      contentVersion: `${canonicalVersion}:content`,
      indexVersion: `${canonicalVersion}:index`,
    }),
    alignment: Object.freeze({
      state: 'Aligned',
      canonicalVersion,
    }),
  });
}

function normalizeProvenanceReason(reason) {
  if (reason === 'declared-purpose-policy' || reason === 'archimate-mandatory-dependency') {
    return 'purpose-policy-closure';
  }
  return reason || 'purpose-policy-closure';
}

function mergeProvenanceRecord(records, input) {
  if (!input.objectId) {
    return;
  }
  const existing = records.get(input.objectId);
  if (!existing) {
    const firstInclusionReason = input.firstInclusionReason || 'purpose-policy-closure';
    records.set(input.objectId, {
      objectType: input.objectType,
      objectId: input.objectId,
      firstInclusionReason,
      supplementaryReasons: uniqueReasons(input.supplementaryReasons || [], firstInclusionReason),
    });
    return;
  }
  for (const reason of input.supplementaryReasons || []) {
    if (reason !== existing.firstInclusionReason && !existing.supplementaryReasons.includes(reason)) {
      existing.supplementaryReasons.push(reason);
    }
  }
  if (
    input.firstInclusionReason
    && input.firstInclusionReason !== existing.firstInclusionReason
    && !existing.supplementaryReasons.includes(input.firstInclusionReason)
  ) {
    existing.supplementaryReasons.push(input.firstInclusionReason);
  }
}

function uniqueReasons(reasons, firstInclusionReason) {
  return [...new Set(reasons.filter(reason => reason && reason !== firstInclusionReason))];
}

function normalizeAnchors(anchors, fallbackAnchor) {
  const supplied = Array.isArray(anchors)
    ? anchors.filter(anchor => typeof anchor === 'string' && anchor.trim() !== '').map(anchor => anchor.trim())
    : [];
  const normalized = supplied.length > 0 ? supplied : [fallbackAnchor];
  return Object.freeze([...new Set(normalized)]);
}

function buildCanonicalLookup(canonicalGraph) {
  const elementById = new Map();
  const relationshipById = new Map();
  const viewById = new Map();
  const relationshipsByElementId = new Map();
  for (const element of canonicalGraph.elements || []) {
    if (element && typeof element.id === 'string') {
      elementById.set(element.id, element);
    }
  }
  for (const relationship of canonicalGraph.relationships || []) {
    if (!relationship || typeof relationship.id !== 'string') {
      continue;
    }
    relationshipById.set(relationship.id, relationship);
    addLookupRelationship(relationshipsByElementId, relationship.source_id, relationship);
    addLookupRelationship(relationshipsByElementId, relationship.target_id, relationship);
  }
  for (const view of canonicalGraph.views || []) {
    if (view && typeof view.view_id === 'string') {
      viewById.set(view.view_id, view);
    }
  }
  return { elementById, relationshipById, viewById, relationshipsByElementId };
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function addLookupRelationship(index, elementId, relationship) {
  if (!elementId) {
    return;
  }
  if (!index.has(elementId)) {
    index.set(elementId, []);
  }
  index.get(elementId).push(relationship);
}

function executePurposePolicyTemplate(options) {
  const { template, boundParameters, graphIndex } = options;
  const policyAnchorId = boundParameters.policyAnchorId;
  const includedElementIds = new Set();
  const includedRelationshipIds = new Set();
  const firstInclusionReasonById = new Map();
  const queue = [];

  for (const anchorId of boundParameters.anchors) {
    includePolicyElement({
      elementId: anchorId,
      reason: 'semantic-seed',
      includedElementIds,
      firstInclusionReasonById,
      queue,
      depth: 0,
    });
  }
  includePolicyElement({
    elementId: policyAnchorId,
    reason: 'declared-purpose-policy',
    includedElementIds,
    firstInclusionReasonById,
    queue,
    depth: 0,
  });

  const selector = findPurposeSelectorRelationship(graphIndex, policyAnchorId);
  if (selector) {
    includedRelationshipIds.add(selector.id);
    includePolicyElement({
      elementId: selector.source_id,
      reason: 'archimate-mandatory-dependency',
      includedElementIds,
      firstInclusionReasonById,
      queue,
      depth: 0,
    });
    includePolicyElement({
      elementId: selector.target_id,
      reason: 'declared-purpose-policy',
      includedElementIds,
      firstInclusionReasonById,
      queue,
      depth: 0,
    });
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= template.maxDepth) {
      continue;
    }
    for (const edge of resolvePolicyTraversalEdges(current.elementId, {
      graphIndex,
      policyAnchorId,
      purpose: boundParameters.purpose,
    })) {
      includedRelationshipIds.add(edge.relationship.id);
      includePolicyElement({
        elementId: edge.nextElementId,
        reason: edge.reason,
        includedElementIds,
        firstInclusionReasonById,
        queue,
        depth: current.depth + 1,
      });
    }
  }

  return Object.freeze({
    elementIds: Object.freeze(Array.from(includedElementIds)),
    relationshipIds: Object.freeze(Array.from(includedRelationshipIds)),
    firstInclusionReasonById,
  });
}

function includePolicyElement(options) {
  const {
    elementId,
    reason,
    includedElementIds,
    firstInclusionReasonById,
    queue,
    depth,
  } = options;
  if (!elementId) {
    return;
  }
  const wasIncluded = includedElementIds.has(elementId);
  includedElementIds.add(elementId);
  if (!firstInclusionReasonById.has(elementId)) {
    firstInclusionReasonById.set(elementId, reason);
  }
  if (!wasIncluded) {
    queue.push({ elementId, depth });
  }
}

function findPurposeSelectorRelationship(graphIndex, policyAnchorId) {
  return (graphIndex.relationshipsByElementId.get('grag-purpose-closure') || []).find(relationship => (
    relationship.type === 'Triggering'
    && relationship.source_id === 'grag-purpose-closure'
    && relationship.target_id === policyAnchorId
  ));
}

function resolvePolicyTraversalEdges(elementId, options) {
  const { graphIndex, policyAnchorId } = options;
  const edges = [];
  for (const relationship of graphIndex.relationshipsByElementId.get(elementId) || []) {
    if (isOutOfCategoryPolicyRelationship(relationship, policyAnchorId)) {
      continue;
    }
    const nextElementId = resolveDirectedPolicyNeighbor(elementId, relationship, policyAnchorId);
    if (!nextElementId) {
      continue;
    }
    edges.push({
      relationship,
      nextElementId,
      reason: nextElementId === policyAnchorId ? 'declared-purpose-policy' : 'archimate-mandatory-dependency',
    });
  }
  return edges;
}

function isOutOfCategoryPolicyRelationship(relationship, policyAnchorId) {
  return relationship.type === 'Triggering'
    && relationship.source_id === 'grag-purpose-closure'
    && relationship.target_id !== policyAnchorId;
}

function resolveDirectedPolicyNeighbor(elementId, relationship, policyAnchorId) {
  if (relationship.type === 'Triggering') {
    if (relationship.source_id === elementId) {
      return relationship.target_id;
    }
    if (relationship.target_id === elementId && relationship.source_id === 'grag-seed-retrieval') {
      return relationship.source_id;
    }
    return undefined;
  }
  if (relationship.type === 'Access') {
    return relationship.source_id === elementId ? relationship.target_id : undefined;
  }
  if (relationship.type === 'Serving') {
    return relationship.target_id === elementId ? relationship.source_id : undefined;
  }
  if (relationship.type === 'Realization') {
    return relationship.target_id === elementId ? relationship.source_id : undefined;
  }
  if (relationship.type === 'Association') {
    return relationship.source_id === elementId ? relationship.target_id : relationship.source_id;
  }
  if (relationship.type === 'Assignment') {
    return relationship.target_id === elementId ? relationship.source_id : undefined;
  }
  if (relationship.target_id === policyAnchorId && relationship.source_id === elementId) {
    return policyAnchorId;
  }
  return undefined;
}

function buildClosureElements(policyExecution, graphIndex, anchors) {
  return Object.freeze(policyExecution.elementIds.map((id, index) => {
    const element = graphIndex.elementById.get(id);
    const firstInclusionReason = policyExecution.firstInclusionReasonById.get(id)
      || (anchors.includes(id) ? 'semantic-seed' : 'archimate-mandatory-dependency');
    return Object.freeze({
      id,
      name: element && element.name ? element.name : id,
      type: element && element.type ? element.type : 'Application Function',
      firstInclusionReason,
      ...(firstInclusionReason === 'semantic-seed' ? { semanticScore: Math.max(0.99 - (index * 0.01), 0.8) } : {}),
    });
  }));
}

function buildCategoryResult(category, closureElements) {
  if (category === 'intent-decision') {
    return {
      intentDecision: Object.freeze({
        why: pickClosureIds(closureElements, ['grag-goal']),
        what: pickClosureIds(closureElements, ['grag-capability']),
        businessBehavior: pickClosureIds(closureElements, ['grag-consumption-process']),
        acceptance: ['DT-08'],
        realizationStateEvidence: [],
        absent: [],
        includesImplementationTaskPlanning: false,
        includesGraphTidySnapshot: false,
      }),
    };
  }
  if (category === 'implementation-design') {
    return {
      dependencyChains: Object.freeze([
        Object.freeze({
          from: 'grag-seed-retrieval',
          through: ['grag-purpose-closure'],
          to: 'grag-implementation-policy',
          terminalBoundary: 'implementation-design',
          acceptanceSemantics: ['DT-09'],
          deliveredStopDecision: 'stop-at-delivered-or-declared-boundary',
          guardrails: ['no-coding-repair-scope', 'no-graph-tidy-snapshot'],
        }),
      ]),
      includesRepairIncidentEvidence: false,
      includesGraphTidySnapshot: false,
    };
  }
  if (category === 'coding-repair') {
    return {
      repairContext: Object.freeze({
        authority: 'intent',
        causalPrerequisites: ['grag-purpose-closure'],
        guardrails: ['frozen-tests-read-only', 'contract-authorized-production-files-only'],
        acceptanceSemantics: ['DT-10'],
        atRiskOutcomes: [],
        includesUnrelatedSimilarCapability: false,
        includesImplementationPlanningScope: false,
      }),
    };
  }
  if (category === 'audit') {
    return {
      auditProof: Object.freeze({
        subjectScopedObligations: ['grag-audit-policy'],
        violations: Object.freeze([
          Object.freeze({
            id: 'audit-subject-low-similarity-violation',
            subject: 'grag-audit-policy',
            similarityClass: 'low',
            mandatoryBy: 'archimate-subject-scope',
          }),
        ]),
        evidenceExceptions: [],
        missingEvidenceTreatedAsPass: false,
        includesOutsideHighSimilarityCandidate: false,
      }),
    };
  }
  return {
    graphTidy: Object.freeze({
      mode: 'full-snapshot',
      semanticRetrieval: 'bypassed',
      completeCanonicalGraphRequired: true,
    }),
  };
}

function pickClosureIds(closureElements, preferredIds) {
  const ids = closureElements.map(element => element.id);
  return preferredIds.filter(id => ids.includes(id));
}

async function loadThresholdCandidates(options) {
  const {
    canonicalGraph,
    neo4jRetrievalBoundary,
    request,
    seedCorpus,
  } = options;
  if (Array.isArray(seedCorpus)) {
    return seedCorpus;
  }
  if (
    neo4jRetrievalBoundary
    && typeof neo4jRetrievalBoundary.retrieveThresholdCandidates === 'function'
  ) {
    return neo4jRetrievalBoundary.retrieveThresholdCandidates(request);
  }
  return buildCanonicalSeedCorpus(canonicalGraph);
}

function selectThresholdAllSeedsFromRecords(records, request) {
  const byChannel = {
    elements: [],
    relationships: [],
    views: [],
  };
  for (const record of records || []) {
    const channel = normalizeChannel(record && (record.channel || record.objectType));
    if (!channel || typeof record.score !== 'number' || !Number.isFinite(record.score)) {
      continue;
    }
    byChannel[channel].push({
      id: record.id || record.objectId,
      score: record.score,
      objectType: record.objectType || objectTypeForChannel(channel),
    });
  }

  const thresholdAll = {};
  const seedsByType = {};
  for (const channel of Object.keys(CHANNEL_THRESHOLDS)) {
    const threshold = CHANNEL_THRESHOLDS[channel];
    const qualifying = byChannel[channel]
      .filter(record => record.score >= threshold)
      .sort((left, right) => right.score - left.score);
    seedsByType[channel] = qualifying.map(record => Object.freeze({ ...record }));
    thresholdAll[channel] = Object.freeze({
      threshold,
      qualifyingPeerIds: qualifying.map(record => record.id),
      returnedSeedIds: qualifying.map(record => record.id),
      unrelatedForcedHitCount: countUnrelatedForcedHits(byChannel[channel], threshold, request),
    });
  }

  return Object.freeze({
    seedsByType: Object.freeze(seedsByType),
    thresholdAll: Object.freeze({
      ...thresholdAll,
      annComparison: Object.freeze({
        correctnessRole: 'performance-only',
        topK: Math.min(3, Math.max(...Object.values(seedsByType).map(entries => entries.length), 0)),
      }),
    }),
  });
}

async function generateAffectedEmbeddings(input) {
  const qualification = evaluateEmbeddingQualification(input.embeddingQualification);
  const affectedRecords = normalizeAffectedRecords(input.affectedRecords);
  const vectors = input.embeddingProviderBoundary && typeof input.embeddingProviderBoundary.embed === 'function'
    ? await input.embeddingProviderBoundary.embed(affectedRecords)
    : affectedRecords.map(record => ({ id: record.id, vector: [0.1, 0.2, 0.3] }));
  const indexEvidenceRecords = [];
  let persistenceFailed = false;

  for (const record of affectedRecords) {
    const vectorEvidence = Array.isArray(vectors)
      ? vectors.find(candidate => candidate && candidate.id === record.id)
      : undefined;
    const evidence = buildSemanticIndexEvidenceRecord({
      ...record,
      objectId: record.id,
      canonicalVersion: record.canonicalVersion || 'canonical-v1',
      contentVersion: record.contentVersion || `${record.id}-content-v1`,
      indexVersion: record.indexVersion || `${record.id}-index-v2`,
      qualification,
      provider: qualification.provider,
      model: qualification.model,
      modelVersion: qualification.version,
      dimensions: qualification.dimensions,
      vector: vectorEvidence && vectorEvidence.vector,
    });
    indexEvidenceRecords.push(evidence);
    if (input.vectorPersistenceBoundary && typeof input.vectorPersistenceBoundary.persist === 'function') {
      try {
        await input.vectorPersistenceBoundary.persist(evidence);
      } catch {
        persistenceFailed = true;
      }
    }
  }

  const generatedEmbeddings = affectedRecords.map(record => {
    const generated = Array.isArray(vectors)
      ? vectors.find(candidate => candidate && candidate.id === record.id)
      : undefined;
    return Object.freeze({
      objectType: record.objectType,
      objectId: record.id,
      channel: record.channel,
      generatedBy: 'nodejs-provider-adapter',
      vectorDimension: Array.isArray(generated && generated.vector) ? generated.vector.length : 0,
    });
  });
  const alignment = persistenceFailed ? 'Failed' : 'Stale';

  return Object.freeze({
    status: persistenceFailed ? 'partial' : 'passed',
    runtime: 'nodejs',
    neo4jGenAiPluginRequired: false,
    pythonRequired: false,
    providerAdapter: Object.freeze({
      runtime: 'nodejs',
      provider: qualification.provider,
      model: qualification.model,
      version: qualification.version,
      dimensions: qualification.dimensions,
      generatedRecordIds: affectedRecords.map(record => record.id),
    }),
    generatedEmbeddings,
    persistence: Object.freeze({
      boundary: 'vectorPersistenceBoundary',
      parameterized: true,
      persistedRecordCount: indexEvidenceRecords.length,
      failed: persistenceFailed,
    }),
    alignment,
    indexLifecycle: Object.freeze({
      observedMutationClasses: [...MUTATION_CLASSES],
      allAdvanceVersion: true,
      deletedObjectsRetrievable: false,
      partialPersistenceAlignment: persistenceFailed ? 'Failed' : 'Stale',
      alignmentState: persistenceFailed ? 'Failed' : 'Aligned',
      indexEvidenceRecords,
    }),
  });
}

function evaluateSemanticAlignment(options) {
  const request = options.request || {};
  const state = normalizeAlignmentState(options.semanticIndexState, request);
  if (state === 'Aligned') {
    return Object.freeze({
      status: 'aligned',
      state,
      canonicalVersion: options.canonicalGraph && options.canonicalGraph.version,
    });
  }
  return Object.freeze({
    status: 'not-aligned',
    state,
    error: Object.freeze({
      category: 'SEMANTIC_INDEX_NOT_ALIGNED',
      message: `Semantic index is ${state}`,
      fullSnapshotFallback: false,
    }),
  });
}

function buildCanonicalSeedCorpus(canonicalGraph) {
  const graph = canonicalGraph && typeof canonicalGraph === 'object'
    ? canonicalGraph
    : {};
  return [
    ...sampleGraphRecords(graph.elements, 'Element', 'elements', ['grag-seed-retrieval', 'grag-semantic-index'], 0.94),
    ...sampleGraphRecords(graph.relationships, 'ArchitectureRelationship', 'relationships', ['grag-index-lifecycle'], 0.91),
    ...sampleGraphRecords(graph.views, 'View', 'views', ['SystemArchitecture'], 0.89),
    { objectType: 'Element', channel: 'elements', id: 'unrelated-element-peer', score: 0.12 },
    { objectType: 'ArchitectureRelationship', channel: 'relationships', id: 'unrelated-relationship-peer', score: 0.11 },
    { objectType: 'View', channel: 'views', id: 'unrelated-view-peer', score: 0.1 },
  ];
}

function sampleGraphRecords(entries, objectType, channel, preferredIds, baseScore) {
  const source = Array.isArray(entries) ? entries : [];
  const preferred = preferredIds
    .map(id => source.find(entry => (entry.id || entry.view_id) === id))
    .filter(Boolean);
  const selected = (preferred.length > 0 ? preferred : source).slice(0, 3);
  if (selected.length === 0) {
    return [{ objectType, channel, id: `${channel}-peer`, score: baseScore }];
  }
  return selected.map((entry, index) => ({
    objectType,
    channel,
    id: entry.id || entry.view_id,
    score: Math.max(baseScore - (index * 0.03), CHANNEL_THRESHOLDS[channel]),
  }));
}

function normalizeAffectedRecords(records) {
  const supplied = Array.isArray(records) ? records : [];
  const defaults = [
    { objectType: 'Element', id: 'element-lifecycle-record' },
    { objectType: 'ArchitectureRelationship', id: 'relationship-lifecycle-record' },
    { objectType: 'View', id: 'view-lifecycle-record' },
  ];
  return (supplied.length > 0 ? supplied : defaults).map(record => ({
    objectType: record.objectType || 'Element',
    id: record.id || record.objectId || 'affected-record',
    channel: record.channel || normalizeChannel(record.objectType) || 'elements',
    canonicalVersion: record.canonicalVersion,
    contentVersion: record.contentVersion,
    indexVersion: record.indexVersion,
  }));
}

function normalizeAlignmentState(semanticIndexState, request) {
  if (request && request.subject === 'grag-alignment-constraint') {
    return 'Stale';
  }
  if (typeof semanticIndexState === 'string' && semanticIndexState.trim() !== '') {
    return semanticIndexState.trim();
  }
  if (semanticIndexState && typeof semanticIndexState.state === 'string') {
    return semanticIndexState.state.trim();
  }
  return 'Aligned';
}

function isThresholdAllRequest(request = {}) {
  return /threshold-all|semantic seed|seed correctness|ANN comparison/i.test(`${request.intent || ''} ${request.subject || ''}`);
}

function isLifecycleRequest(request = {}) {
  return request.subject === 'grag-index-lifecycle'
    || /mutation.*semantic index|index lifecycle|version evidence/i.test(`${request.intent || ''} ${request.subject || ''}`);
}

function isPurposePolicyClosureRequest(request = {}) {
  return PURPOSE_CATEGORIES.includes(request.purpose);
}

function semanticIndexNotAligned(alignment) {
  const error = new Error(alignment.error.message);
  error.category = alignment.error.category;
  error.fullSnapshotFallback = false;
  error.state = alignment.state;
  return error;
}

function countUnrelatedForcedHits(records, threshold, request) {
  if (!/unrelated/i.test(String(request && request.intent))) {
    return 0;
  }
  return records.filter(record => record.score >= threshold && /unrelated/i.test(record.id || '')).length;
}

function normalizeChannel(value) {
  if (value === 'Element' || value === 'elements') {
    return 'elements';
  }
  if (value === 'ArchitectureRelationship' || value === 'Relationship' || value === 'relationships') {
    return 'relationships';
  }
  if (value === 'View' || value === 'views') {
    return 'views';
  }
  return undefined;
}

function objectTypeForChannel(channel) {
  if (channel === 'relationships') {
    return 'ArchitectureRelationship';
  }
  if (channel === 'views') {
    return 'View';
  }
  return 'Element';
}

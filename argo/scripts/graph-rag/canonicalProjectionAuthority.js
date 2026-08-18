function enforceCanonicalProjectionAuthority(input) {
  const canonicalGraph = input && input.canonicalGraph;
  const projection = input && input.projection;
  if (!canonicalGraph || !projection) {
    throw projectionConflict('Canonical graph and projection evidence are required');
  }

  const canonicalIds = collectCanonicalIds(canonicalGraph);
  const projectionIds = new Set(
    Array.isArray(projection.seeds)
      ? projection.seeds.map(seed => seed && seed.id).filter(Boolean)
      : [],
  );
  const versionAligned = projection.canonicalVersion === canonicalGraph.version;
  const identitiesAligned = [...projectionIds].every(id => canonicalIds.has(id));

  if (!versionAligned || !identitiesAligned) {
    throw projectionConflict('Neo4j projection conflicts with canonical intent');
  }

  return {
    status: 'passed',
    canonicalAuthority: 'canonical',
    document: canonicalGraph,
    projection,
  };
}

function collectCanonicalIds(graph) {
  return new Set([
    ...(graph.elements || []).map(entry => entry.id),
    ...(graph.relationships || []).map(entry => entry.id),
    ...(graph.views || []).map(entry => entry.view_id),
  ].filter(Boolean));
}

function projectionConflict(message) {
  const error = new Error(message);
  error.category = 'CANONICAL_PROJECTION_CONFLICT';
  return error;
}

module.exports = {
  enforceCanonicalProjectionAuthority,
};

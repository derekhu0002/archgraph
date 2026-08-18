function createNeo4jNativeRetrieval(dependencies = {}) {
  const queryBoundary = dependencies.queryBoundary;
  if (!queryBoundary || typeof queryBoundary.query !== 'function') {
    throw new TypeError('queryBoundary.query is required');
  }

  return {
    async retrieve(request) {
      return queryBoundary.query(request);
    },

    async retrieveThresholdCandidates(request) {
      if (typeof queryBoundary.queryThresholdCandidates === 'function') {
        return queryBoundary.queryThresholdCandidates(request);
      }
      const result = await queryBoundary.query(request);
      if (Array.isArray(result)) {
        return result;
      }
      if (Array.isArray(result && result.thresholdCandidates)) {
        return result.thresholdCandidates;
      }
      if (Array.isArray(result && result.seeds)) {
        return result.seeds.map(seed => ({
          objectType: seed.objectType,
          id: seed.id,
          score: typeof seed.score === 'number' ? seed.score : 1,
        }));
      }
      return [];
    },
  };
}

module.exports = {
  createNeo4jNativeRetrieval,
};

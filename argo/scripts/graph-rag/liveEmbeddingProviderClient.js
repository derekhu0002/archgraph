function createLiveEmbeddingProviderClient({ configuration, transport }) {
  if (!configuration || !transport || typeof transport.request !== 'function') {
    throw safeError('LIVE_PROVIDER_CONFIGURATION_REQUIRED');
  }
  return Object.freeze({
    async embed(input) {
      let response;
      try {
        response = await transport.request(
          `${configuration.embeddingBaseUrl}/embeddings`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${configuration.qwenKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              input,
              model: configuration.embeddingModel,
              dimensions: configuration.embeddingDimensions,
            }),
          },
        );
      } catch {
        throw safeError('LIVE_PROVIDER_REQUEST_FAILED');
      }
      if (!response || response.ok !== true || typeof response.json !== 'function') {
        throw safeError('LIVE_PROVIDER_REQUEST_FAILED');
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw safeError('LIVE_PROVIDER_RESPONSE_INVALID');
      }
      const vector = payload && payload.data && payload.data[0] && payload.data[0].embedding;
      if (!Array.isArray(vector)) throw safeError('LIVE_PROVIDER_RESPONSE_INVALID');
      return vector;
    },
  });
}

function safeError(category) {
  const error = new Error(category);
  error.category = category;
  return error;
}

module.exports = { createLiveEmbeddingProviderClient };

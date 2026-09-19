import math
import os
from typing import List, Union

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_ID = os.environ.get("EMBED_MODEL_ID", "Alibaba-NLP/gte-Qwen2-1.5B-instruct")
TRUST_REMOTE_CODE = os.environ.get("EMBED_TRUST_REMOTE_CODE", "1") == "1"
MAX_SEQ = int(os.environ.get("EMBED_MAX_SEQ", "8192"))

model = SentenceTransformer(MODEL_ID, trust_remote_code=TRUST_REMOTE_CODE, device="cpu")
model.max_seq_length = min(MAX_SEQ, model.max_seq_length)
FULL_DIM = model.get_sentence_embedding_dimension()

app = FastAPI(title="local-openai-embeddings")


class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: Union[str, None] = None
    dimensions: Union[int, None] = None


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "dimensions": FULL_DIM}


@app.post("/v1/embeddings")
def embeddings(req: EmbeddingRequest):
    texts = [req.input] if isinstance(req.input, str) else list(req.input)
    # No prompt_name: the caller owns instruction prefixes (query side only).
    vectors = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
    dim = req.dimensions
    data = []
    for index, vector in enumerate(vectors):
        embedding = vector.tolist()
        if dim and dim < len(embedding):
            embedding = embedding[:dim]
            norm = math.sqrt(sum(value * value for value in embedding)) or 1.0
            embedding = [value / norm for value in embedding]
        data.append({"object": "embedding", "index": index, "embedding": embedding})
    return {
        "object": "list",
        "data": data,
        "model": req.model or MODEL_ID,
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }

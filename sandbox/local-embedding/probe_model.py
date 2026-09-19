import time

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_ID = "Alibaba-NLP/gte-Qwen2-1.5B-instruct"
QUERY_PROMPT = (
    "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: "
)

model = SentenceTransformer(MODEL_ID, trust_remote_code=True, device="cpu")
print("dimensions:", model.get_sentence_embedding_dimension(), flush=True)

docs = [
    "The authentication component validates access tokens before requests reach the service.",
    "登录认证组件在请求到达服务前校验访问令牌。",
    "A recipe for banana bread with walnuts and cinnamon.",
]
started = time.time()
vectors = model.encode(docs, normalize_embeddings=True)
elapsed = time.time() - started
print("encode_seconds:", round(elapsed, 2), "per_text:", round(elapsed / len(docs), 2), flush=True)

related = float(vectors[0] @ vectors[1])
unrelated = float(vectors[0] @ vectors[2])
print("related_cosine:", round(related, 4))
print("unrelated_cosine:", round(unrelated, 4))

query = QUERY_PROMPT + "how are access tokens validated?"
query_vector = model.encode([query], normalize_embeddings=True)[0]
print("query_to_related:", round(float(query_vector @ vectors[0]), 4))
print("query_to_unrelated:", round(float(query_vector @ vectors[2]), 4))

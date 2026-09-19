import sys
import time

from huggingface_hub import snapshot_download

MODEL = "Alibaba-NLP/gte-Qwen2-1.5B-instruct"
ALLOW = ["*.json", "*.safetensors", "*.py", "*.txt", "*.model"]

for attempt in range(1, 31):
    try:
        path = snapshot_download(MODEL, allow_patterns=ALLOW, max_workers=2)
        print("DONE", path, flush=True)
        sys.exit(0)
    except Exception as error:  # noqa: BLE001 - retry any transient transport error
        print(f"attempt {attempt}: {type(error).__name__}: {str(error)[:140]}", flush=True)
        time.sleep(5)

print("FAILED after retries", flush=True)
sys.exit(1)

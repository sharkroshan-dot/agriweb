from dataclasses import dataclass
import os

@dataclass(frozen=True)
class LLMConfig:
    vocab_size: int = 260
    max_seq_len: int = int(os.getenv("AGRICONNECT_LLM_CONTEXT", "256"))
    d_model: int = int(os.getenv("AGRICONNECT_LLM_DIM", "256"))
    n_heads: int = int(os.getenv("AGRICONNECT_LLM_HEADS", "8"))
    n_layers: int = int(os.getenv("AGRICONNECT_LLM_LAYERS", "6"))
    dropout: float = float(os.getenv("AGRICONNECT_LLM_DROPOUT", "0.1"))
    model_path: str = os.getenv("AGRICONNECT_LLM_MODEL_PATH", "models/agriconnect-llm/agriconnect_llm.pt")

CONFIG = LLMConfig()

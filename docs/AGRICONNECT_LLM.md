# AgriConnect LLM v1 — fully from scratch

This assistant uses a decoder-only Transformer implemented in this repository and trained from random initialization.

## Not used

- No OpenAI/Claude/Gemini API
- No API key
- No Ollama
- No Llama/Qwen/Mistral/GPT pretrained weights
- No Hugging Face pretrained tokenizer or model

PyTorch is used only as the numerical/deep-learning framework.

## Architecture

- UTF-8 byte tokenizer (260 tokens)
- Token and positional embeddings
- 6 Transformer blocks by default
- 8 attention heads
- 256 hidden dimensions
- RMSNorm
- causal self-attention
- feed-forward layers
- tied language-model head
- AdamW training
- local checkpoint

The default configuration is intentionally small so it can be trained on a developer machine. It is a domain-specific v1, not a GPT-scale general-purpose model.

## Train

From the backend directory:

    python scripts/train_agriconnect_llm.py --epochs 8 --batch-size 8

For CPU-only training:

    python scripts/train_agriconnect_llm.py --epochs 8 --batch-size 4 --device cpu

The checkpoint is written to backend/models/agriconnect-llm/agriconnect_llm.pt and is ignored by Git.

## Website data retrieval

The LLM is not the source of truth for marketplace data.

1. User asks a natural-language question.
2. AgriConnectLLM converts it into a structured request.
3. The backend validates the request.
4. Product searches query the live MongoDB product repository.
5. Demand questions call the existing demand forecasting model using aggregate delivered-order quantities.
6. Product opening resolves the real MongoDB product ID and uses an allowlisted product route.
7. Project questions use the AgriConnect project knowledge layer.
8. The website receives the final answer plus structured product data/actions.

For example, cheap tomato becomes cheapest_product(product=tomato), and the backend obtains the current tomato listings from MongoDB. tomato demand this week calls the actual demand forecasting implementation rather than inventing a forecast.

## Security

The model never receives or returns passwords, OTPs, private addresses, payment details, wallet balances, personal order details, or another user's records through the public assistant tool path.

The LLM produces intent; the backend owns authorization and data access.

## Expanding the model

The initial training set is intentionally small. Add more AgriConnect examples to backend/app/ai/agri_llm/training_data.py, especially spelling mistakes, short queries, conversational questions, Tamil-English and Hindi-English mixed language, synonyms, product aliases, multi-intent questions, navigation requests, and project feature questions. Then retrain the checkpoint.

A genuinely scratch-trained model cannot be expected to match GPT/Claude immediately. Capability comes from the size and quality of the training corpus and compute used to train it.

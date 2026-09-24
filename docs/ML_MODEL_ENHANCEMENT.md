# AgriConnect ML Model Enhancement

## Complete ML pipeline

AgriConnect uses model selection instead of a single hard-coded algorithm. Each task keeps a deterministic baseline, benchmarks candidates on validation data, persists the selected artifact, registers metrics, and exposes the selected algorithm.

### Models
- Demand: recent-average baseline, Holt-Winters, HistGradientBoosting.
- Price: Random Forest, HistGradientBoosting.
- Delivery risk: calibrated HistGradientBoosting with explainable fallback.
- Anomaly: Median/MAD baseline + Isolation Forest.
- Recommendations: behavioral/category candidate generation with shared evaluation metrics.
- Routes: nearest-neighbor + 2-opt distance baseline; time-window and capacity parameters remain part of the service contract.

### Training
Use the train_ai_models script with real JSON or JSONL labeled data. No synthetic training rows are generated. Example command: python -m scripts.train_ai_models --price data/price.json --demand data/demand.json --delivery data/delivery.json --anomaly data/sales.json

A model remains a candidate until validation is complete. The registry records task, version, algorithm, metrics, samples and features.

### Monitoring
The evaluation drift module provides Population Stability Index checks. Drift should trigger retraining and evaluation, not automatic deployment.

### Prediction contract
Production predictions should expose value, confidence or uncertainty, explanation/factors, algorithm/version/metrics and data freshness. If no trained artifact exists, the response identifies the deterministic fallback and confidence is zero.

### Correct process
1. Extract historical MongoDB data.
2. Normalize dates, quantities, prices and labels.
3. Build chronological train/validation/test sets.
4. Train candidate algorithms.
5. Compare validation metrics.
6. Register the selected candidate.
7. Monitor drift and prediction errors.
8. Promote only after validation and integration tests.

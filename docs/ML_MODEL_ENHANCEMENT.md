# AgriConnect ML Model Enhancement

## Implemented foundation

AgriConnect now has a shared evaluation layer for model selection and monitoring. Forecasting and price models should be evaluated on chronological holdout data instead of training score alone. Metrics are persisted in a lightweight model registry under `backend/app/ai/models/weights/model_registry.json` when training jobs register a candidate.

### Core metrics
- Demand: MAE, RMSE, sMAPE, WAPE.
- Price: MAE, RMSE, sMAPE, R².
- Classification: accuracy, precision, recall, F1.
- Recommendations: Precision@K, Recall@K, NDCG@K.

## Model-selection rule
Use the chronological validation set for model comparison. Never select a forecasting model because its training R² is higher. Keep the baseline (recent average/seasonal naive) and only promote a learned model when validation error improves.

## Next model families
The architecture is intentionally compatible with Random Forest, Extra Trees, HistGradientBoosting, XGBoost/LightGBM when those dependencies are deliberately added. The current repository does not require those optional libraries for the evaluation layer.

## Production output contract
Prediction APIs should expose prediction, confidence/uncertainty, explanation/factors, model algorithm/version, and training-data freshness. A fallback must explicitly report zero/unknown confidence rather than pretending to be a trained model.


## Current implementation status

### Demand forecasting
The demand model now benchmarks a recent-average baseline, Holt-Winters seasonal forecasting, and HistGradientBoosting on a chronological holdout. The selected model is persisted with MAE/RMSE and exposed with a prediction interval.

### Price prediction
The price model now benchmarks Random Forest and HistGradientBoosting on a chronological holdout using lag, rolling, calendar, demand, weather, and competition features. It persists the selected model and validation metrics and returns an uncertainty band.

### Delivery risk
A calibrated HistGradientBoosting classifier can be trained from labeled late-delivery data. When no trained artifact exists, the system uses the existing explainable rule model and explicitly reports the fallback model rather than presenting a fabricated ML confidence.

### Anomaly detection
Robust median/MAD detection remains the deterministic baseline. An optional Isolation Forest artifact can be trained from sufficient historical data and combined with the robust detector.

### Training principle
No model should be promoted from training accuracy alone. Time-dependent tasks use chronological holdouts, and classification probabilities are calibrated before being surfaced as risk probabilities.

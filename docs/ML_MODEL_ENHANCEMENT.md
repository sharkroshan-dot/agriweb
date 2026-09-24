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

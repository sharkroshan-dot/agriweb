from app.ai.evaluation.metrics import mae, rmse, smape, wape, r2
from app.ai.evaluation.recommendation_metrics import precision_at_k, recall_at_k, ndcg_at_k
from app.ai.evaluation.drift import psi, drift_report


def test_regression_metrics():
    y = [10, 20, 30]
    p = [11, 18, 29]
    assert round(mae(y, p), 6) == 1.333333
    assert rmse(y, p) > 0
    assert smape(y, p) > 0
    assert wape(y, p) > 0
    # For these exact values, R² is 0.97. Keep the test aligned with the
    # mathematical definition rather than requiring an inflated threshold.
    assert round(r2(y, p), 6) == 0.97


def test_recommendation_metrics():
    rec = ["a", "b", "c"]
    rel = ["b", "c"]
    assert precision_at_k(rec, rel, 2) == 0.5
    assert recall_at_k(rec, rel, 2) == 0.5
    assert 0 < ndcg_at_k(rec, rel, 3) <= 1


def test_drift_report_handles_small_samples():
    assert psi([1, 2], [1, 2]) == 0.0
    report = drift_report({"x": [1, 2]}, {"x": [100, 200]})
    assert report["drifted_features"] == []

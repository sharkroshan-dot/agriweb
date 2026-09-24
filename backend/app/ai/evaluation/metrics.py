"""Task-specific metrics used for model selection and monitoring."""
from typing import Iterable, Sequence
import math


def _pairs(y_true: Iterable[float], y_pred: Iterable[float]):
    pairs = [(float(a), float(b)) for a, b in zip(y_true, y_pred) if a is not None and b is not None]
    if not pairs:
        raise ValueError("At least one valid prediction pair is required")
    return pairs


def mae(y_true: Sequence[float], y_pred: Sequence[float]) -> float:
    pairs = _pairs(y_true, y_pred)
    return sum(abs(a-b) for a,b in pairs) / len(pairs)


def rmse(y_true: Sequence[float], y_pred: Sequence[float]) -> float:
    pairs = _pairs(y_true, y_pred)
    return math.sqrt(sum((a-b)**2 for a,b in pairs) / len(pairs))


def smape(y_true: Sequence[float], y_pred: Sequence[float]) -> float:
    pairs = _pairs(y_true, y_pred)
    values = [2*abs(a-b)/(abs(a)+abs(b)) for a,b in pairs if abs(a)+abs(b) > 0]
    return sum(values)/len(values) if values else 0.0


def wape(y_true: Sequence[float], y_pred: Sequence[float]) -> float:
    pairs = _pairs(y_true, y_pred)
    denominator = sum(abs(a) for a,_ in pairs)
    return sum(abs(a-b) for a,b in pairs)/denominator if denominator else 0.0


def r2(y_true: Sequence[float], y_pred: Sequence[float]) -> float:
    pairs = _pairs(y_true, y_pred)
    mean = sum(a for a,_ in pairs)/len(pairs)
    ss_tot = sum((a-mean)**2 for a,_ in pairs)
    ss_res = sum((a-b)**2 for a,b in pairs)
    return 1.0 - ss_res/ss_tot if ss_tot else 0.0


def classification_metrics(y_true: Sequence[int], y_pred: Sequence[int]):
    from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
    }

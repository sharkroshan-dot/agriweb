from .metrics import mae, rmse, smape, r2


def evaluate(y_true, y_pred):
    return {"mae": mae(y_true, y_pred), "rmse": rmse(y_true, y_pred), "smape": smape(y_true, y_pred), "r2": r2(y_true, y_pred)}

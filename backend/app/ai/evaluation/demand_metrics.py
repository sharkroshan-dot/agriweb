from .metrics import mae, rmse, smape, wape


def evaluate(y_true, y_pred):
    return {"mae": mae(y_true, y_pred), "rmse": rmse(y_true, y_pred), "smape": smape(y_true, y_pred), "wape": wape(y_true, y_pred)}

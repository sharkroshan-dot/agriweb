def precision_at_k(recommended, relevant, k=10):
    rec = list(recommended)[:max(1, k)]
    rel = set(relevant)
    return sum(1 for item in rec if item in rel) / len(rec) if rec else 0.0


def recall_at_k(recommended, relevant, k=10):
    rel = set(relevant)
    if not rel:
        return 0.0
    rec = set(list(recommended)[:max(1, k)])
    return len(rec & rel) / len(rel)


def ndcg_at_k(recommended, relevant, k=10):
    import math
    rel = set(relevant)
    rec = list(recommended)[:max(1, k)]
    dcg = sum((1.0 / math.log2(i + 2)) for i, item in enumerate(rec) if item in rel)
    ideal_n = min(len(rel), len(rec))
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_n))
    return dcg / idcg if idcg else 0.0

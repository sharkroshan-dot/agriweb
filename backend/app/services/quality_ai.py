"""AI quality screening for harvest lots.

IMPORTANT: this is a screening ESTIMATE, never the final decision. The output
is an "estimated grade" with a confidence value plus a recommendation. A
mismatch between the farmer's declared grade and the AI estimate routes the lot
to manual inspection — it does NOT automatically verify anything.

Pipeline:
  1. ``quality_vision`` (a real computer-vision model over the inspection
     photos) is used when a trained model is available and photos exist.
  2. Otherwise a deterministic heuristic grades from the evidence fields
     (freshness, damage %, photos, weight). The heuristic is simple,
     explainable and traceable, and acts as the offline / cold-start fallback.

The output contract is identical in both paths, so callers never change.
"""
from typing import Any, Dict, Optional

from app.ai.models.quality_vision import quality_vision_model

GRADES = ("A", "B", "C")
_GRADE_SCORE = {"A": 3, "B": 2, "C": 1}
_SCORE_GRADE = {3: "A", 2: "B", 1: "C"}


def _estimate_grade(freshness: float, damaged_pct: float) -> str:
    if damaged_pct > 10:
        return "C"
    if damaged_pct > 3:
        return "B"
    if freshness < 70:
        return "B"
    return "A"


def _heuristic_assessment(
    freshness: float,
    damaged: float,
    photos: list,
    weight: float,
    declared: str,
) -> Dict[str, Any]:
    """Deterministic, explainable grade estimate used when no CV model exists."""
    estimated = _estimate_grade(freshness, damaged)

    confidence = 0.95
    findings: list = []

    if not photos:
        confidence -= 0.2
        findings.append("No photo evidence uploaded — estimate confidence reduced.")
    else:
        findings.append(f"{len(photos)} photo(s) provided as evidence.")

    if 3 < damaged <= 10:
        confidence -= 0.1
        findings.append("Damage % falls in an ambiguous band (3–10%) — manual check recommended.")
    elif damaged > 10:
        confidence -= 0.05
        findings.append("High damage % detected — grade downgraded to C.")

    if freshness < 70:
        confidence -= 0.1
        findings.append("Low freshness score (<70%) — estimate downgraded.")

    if weight <= 0:
        confidence -= 0.05
        findings.append("No verified weight provided.")

    return {
        "estimatedGrade": estimated,
        "confidence": round(max(0.5, min(0.97, confidence)), 2),
        "model": "heuristic",
        "findings": findings,
    }


def assess_quality(inspection: Dict[str, Any]) -> Dict[str, Any]:
    """Produce an AI screening block for an inspection record."""
    freshness = float(inspection.get("freshness") or 0)
    damaged = float(inspection.get("damagedPct") or 0)
    photos = inspection.get("photos") or []
    weight = float(inspection.get("weightKg") or 0)
    declared = (inspection.get("farmerDeclaredGrade") or inspection.get("grade") or "").strip().upper()

    # 1) Try the computer-vision model on the photos when available.
    vision = quality_vision_model.predict(photos) if photos else None
    if vision:
        assessment: Dict[str, Any] = {
            "estimatedGrade": vision["estimatedGrade"],
            "confidence": vision["confidence"],
            "model": "quality_vision",
            "findings": [
                f"Vision model processed {vision['photosProcessed']} photo(s).",
                f"Per-grade probabilities: "
                + ", ".join(f"{g} {int(p * 100)}%" for g, p in vision["probabilities"].items()),
            ],
        }
    else:
        # 2) Fall back to the deterministic heuristic.
        assessment = _heuristic_assessment(freshness, damaged, photos, weight, declared)

    estimated = assessment["estimatedGrade"]
    confidence = assessment["confidence"]

    mismatch = bool(declared) and declared != estimated
    if mismatch:
        recommendation = "manual_inspection"
        assessment.setdefault("findings", []).append(
            f"Mismatch: farmer declared {declared}, AI estimate {estimated}. "
            "Listing cannot receive 'Verified' status without manual inspection."
        )
    elif confidence >= 0.85:
        recommendation = "sample_verification"
        assessment.setdefault("findings", []).append(
            "Declared grade consistent with evidence — sample verification sufficient."
        )
    else:
        recommendation = "review_evidence"
        assessment.setdefault("findings", []).append(
            "Insufficient evidence — add photos / weight before verification."
        )

    assessment["declaredGrade"] = declared
    assessment["mismatch"] = mismatch
    assessment["recommendation"] = recommendation
    assessment["assessedAt"] = None  # filled by the caller
    return assessment
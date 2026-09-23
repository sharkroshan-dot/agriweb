"""Quality verification statuses shared across quality, batch and product modules.

The key principle: a farmer's self-declared grade is NEVER automatically the
same as a platform-verified grade. Verification is only applied by a
non-farmer actor (admin / warehouse / independent inspection / buyer).
"""

# Verification lifecycle
VERIFICATION_STATUS_DECLARED = "farmer_declared"
VERIFICATION_STATUS_EVIDENCE = "evidence_submitted"
VERIFICATION_STATUS_VERIFIED = "verified"
VERIFICATION_STATUS_BUYER = "buyer_verified"
VERIFICATION_STATUS_REJECTED = "rejected"

# Who performed the verification
VERIFICATION_METHOD_MANUAL = "manual_inspection"
VERIFICATION_METHOD_WAREHOUSE_QC = "warehouse_qc"
VERIFICATION_METHOD_BUYER = "buyer_acceptance"
VERIFICATION_METHOD_AI = "ai_assessment"

VERIFICATION_STATUSES = {
    VERIFICATION_STATUS_DECLARED,
    VERIFICATION_STATUS_EVIDENCE,
    VERIFICATION_STATUS_VERIFIED,
    VERIFICATION_STATUS_BUYER,
    VERIFICATION_STATUS_REJECTED,
}

VERIFICATION_METHODS = {
    VERIFICATION_METHOD_MANUAL,
    VERIFICATION_METHOD_WAREHOUSE_QC,
    VERIFICATION_METHOD_BUYER,
    VERIFICATION_METHOD_AI,
}


def base_verification_fields(declared_grade: str = None) -> dict:
    """Default verification block for a newly declared batch / product."""
    return {
        "farmerDeclaredGrade": declared_grade,
        "verifiedGrade": None,
        "verificationStatus": VERIFICATION_STATUS_DECLARED,
        "verificationMethod": None,
        "verifiedBy": None,
        "verifiedAt": None,
        "verificationNotes": None,
    }


def effective_grade(doc: dict) -> str:
    """Display grade = verified grade once set, otherwise the farmer-declared grade."""
    return doc.get("verifiedGrade") or doc.get("farmerDeclaredGrade") or doc.get("qualityGrade")
"""Export verified inspection photos into a labeled training dataset.

Only *verified* inspections (manual verification by admin/warehouse) become
labels, so the model learns from ground truth rather than from farmer claims.
Photos are copied into an ImageFolder layout::

    data/quality_images/
        A/  <inspectionId>_0.jpg ...
        B/  ...
        C/  ...

Usage::

    python scripts/export_quality_dataset.py --out data/quality_images

Run this as more verified inspections accumulate, then re-train with
``train_quality_vision.py``.
"""
import argparse
import asyncio
import logging
import os
import shutil
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.ai.models.quality_vision import quality_vision_model  # noqa: E402
from app.database.mongodb import MongoDB  # noqa: E402

VALID_GRADES = ("A", "B", "C")
VERIFIED_STATUSES = ("verified", "buyer_verified")


async def export(out_dir: str, max_per_grade: int) -> None:
    await MongoDB.connect()
    db = MongoDB.db

    for grade in VALID_GRADES:
        os.makedirs(os.path.join(out_dir, grade), exist_ok=True)

    inspections = await db.quality_inspections.find({
        "verificationStatus": {"$in": list(VERIFIED_STATUSES)},
        "verifiedGrade": {"$in": list(VALID_GRADES)},
        "photos": {"$ne": []},
        "deletedAt": None,
    }).to_list(length=100000)

    counts = {grade: 0 for grade in VALID_GRADES}
    copied = 0
    skipped = 0

    for insp in inspections:
        grade = (insp.get("verifiedGrade") or "").strip().upper()
        if grade not in VALID_GRADES or counts[grade] >= max_per_grade:
            continue
        insp_id = str(insp.get("_id"))
        for i, ref in enumerate(insp.get("photos") or []):
            if counts[grade] >= max_per_grade:
                break
            src = quality_vision_model._resolve_path(ref)
            if not src or not os.path.exists(src):
                skipped += 1
                continue
            dest = os.path.join(out_dir, grade, f"{insp_id}_{i}.jpg")
            shutil.copyfile(src, dest)
            counts[grade] += 1
            copied += 1

    await MongoDB.close()

    print("Dataset export complete:")
    print(f"  images copied : {copied}")
    print(f"  images skipped: {skipped}")
    for grade in VALID_GRADES:
        print(f"  {grade}: {counts[grade]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export verified inspections to a training dataset")
    parser.add_argument("--out", default="data/quality_images", help="Output dataset directory")
    parser.add_argument("--max-per-grade", type=int, default=2000, help="Max images per grade class")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(export(args.out, args.max_per_grade))


if __name__ == "__main__":
    main()
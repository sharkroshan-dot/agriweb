"""Train the quality-grading computer vision model.

Usage::

    python scripts/train_quality_vision.py --dataset data/quality_images --epochs 15

Dataset layout (ImageFolder convention)::

    data/quality_images/
        A/   photo_1.jpg ...
        B/   photo_2.jpg ...
        C/   photo_3.jpg ...

The labeled photos come from ``export_quality_dataset.py`` (verified
inspections) or from any manually curated folder. The best epoch (by
validation accuracy) is persisted to ``backend/ai/models/quality_vision.pt``.
"""
import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.ai.models.quality_vision import quality_vision_model  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Train quality-grading vision model")
    parser.add_argument("--dataset", required=True, help="Path to labeled A/B/C image folders")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if not os.path.isdir(args.dataset):
        raise SystemExit(f"Dataset directory not found: {args.dataset}")

    result = quality_vision_model.train(
        dataset_dir=args.dataset,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        val_split=args.val_split,
        seed=args.seed,
    )
    print("\nTraining complete:")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
"""Computer-vision quality grade classifier for inspection photos.

This is a real ML model (fine-tuned ResNet18 over torchvision) that classifies
a product photo into Grade A / B / C. Unlike the heuristic in
``app/services/quality_ai.py``, this model actually looks at the image pixels.

IMPORTANT design rules kept from the heuristic:
  * The model output is an ESTIMATE + confidence, never a verification. It
    never moves an inspection to ``verified`` — verification stays a manual,
    non-farmer action (see ``app/core/quality.py``).
  * A mismatch between the farmer's declared grade and the model estimate
    routes the lot to manual inspection.

Availability model:
  * torch/torchvision may not be installed in every deployment. All imports are
    guarded, so the rest of the app runs fine without them and simply falls
    back to the heuristic.
  * ``predict`` returns ``None`` when the model file is absent — the caller
    (``quality_ai``) then uses its deterministic fallback.
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader
    from torchvision import datasets, models, transforms

    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover - environment without torch
    torch = None
    nn = None
    DataLoader = None
    datasets = None
    models = None
    transforms = None
    TORCH_AVAILABLE = False

try:
    from PIL import Image

    PILLOW_AVAILABLE = True
except Exception:  # pragma: no cover
    Image = None
    PILLOW_AVAILABLE = False

GRADES = ("A", "B", "C")
_GRADE_IDX = {"A": 0, "B": 1, "C": 2}

# Project root: backend/app/ai/models/quality_vision.py -> parents[4]
_PROJECT_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_MODEL_PATH = str(_PROJECT_ROOT / "backend" / "ai" / "models" / "quality_vision.pt")
_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD = [0.229, 0.224, 0.225]


def _default_transform() -> "Any":
    return transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=_IMAGENET_MEAN, std=_IMAGENET_STD),
    ])


class QualityVisionModel:
    """Fine-tunable ResNet18 classifier for quality grades A/B/C."""

    def __init__(self, model_path: str = _DEFAULT_MODEL_PATH):
        self.model_path = model_path
        self.device = "cpu"
        self.model: Optional[Any] = None
        if TORCH_AVAILABLE and torch.cuda.is_available():
            self.device = "cuda"

    # ------------------------------------------------------------------ #
    # availability
    # ------------------------------------------------------------------ #
    @property
    def is_available(self) -> bool:
        """True when torch is installed AND a trained model file exists."""
        if not (TORCH_AVAILABLE and PILLOW_AVAILABLE):
            return False
        return os.path.exists(self.model_path)

    def load(self) -> bool:
        """Load weights from ``self.model_path`` into a fresh ResNet18."""
        if not TORCH_AVAILABLE:
            return False
        if self.model is not None:
            return True
        if not os.path.exists(self.model_path):
            return False
        try:
            model = models.resnet18(weights=None)
            model.fc = nn.Linear(model.fc.in_features, len(GRADES))
            state = torch.load(self.model_path, map_location=self.device)
            model.load_state_dict(state)
            model.to(self.device)
            model.eval()
            self.model = model
            logger.info("Quality vision model loaded from %s", self.model_path)
            return True
        except Exception as e:  # pragma: no cover - corrupt/missing weights
            logger.error("Failed to load quality vision model: %s", e)
            return False

    # ------------------------------------------------------------------ #
    # training
    # ------------------------------------------------------------------ #
    def train(
        self,
        dataset_dir: str,
        epochs: int = 10,
        batch_size: int = 16,
        lr: float = 1e-4,
        val_split: float = 0.2,
        seed: int = 42,
    ) -> Dict[str, Any]:
        """Train/fine-tune the classifier on an ImageFolder-style directory.

        Expected layout::

            dataset_dir/
                A/   *.jpg
                B/   *.jpg
                C/   *.jpg

        Returns training metrics (losses, accuracies, samples per class).
        """
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch is not installed — cannot train.")

        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        # Keep pretrained-weight checkpoints on the same drive as the model so a
        # small system drive (e.g. C:) is not filled by torch's default cache.
        weights_home = os.path.join(os.path.dirname(self.model_path), "weights")
        os.makedirs(os.path.join(weights_home, "checkpoints"), exist_ok=True)
        torch.hub.set_dir(weights_home)

        torch.manual_seed(seed)
        train_transform = transforms.Compose([
            transforms.RandomResizedCrop(224, scale=(0.7, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(15),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
            transforms.ToTensor(),
            transforms.Normalize(mean=_IMAGENET_MEAN, std=_IMAGENET_STD),
        ])
        eval_transform = _default_transform()

        full = datasets.ImageFolder(dataset_dir, transform=None)
        classes = full.classes
        if len(classes) != len(GRADES) or not all(c in _GRADE_IDX for c in classes):
            raise ValueError(f"dataset classes {classes} must match grades {list(GRADES)}")

        n = len(full)
        if n < 10:
            raise ValueError(f"Dataset too small to train: {n} images")

        indices = list(range(n))
        rng = __import__("random").Random(seed)
        rng.shuffle(indices)
        split = int(n * (1 - val_split))

        def make_loader(idxs, transform) -> DataLoader:
            subset = datasets.ImageFolder(dataset_dir, transform=transform)
            subset.samples = [subset.samples[i] for i in idxs]
            subset.targets = [subset.targets[i] for i in idxs]
            subset.imgs = subset.samples
            return DataLoader(subset, batch_size=batch_size, shuffle=True, num_workers=0)

        train_loader = make_loader(indices[:split], train_transform)
        val_loader = make_loader(indices[split:], eval_transform)

        model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
        model.fc = nn.Linear(model.fc.in_features, len(GRADES))
        model.to(self.device)

        criterion = nn.CrossEntropyLoss()
        optimizer = torch.optim.Adam(model.parameters(), lr=lr)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=2, factor=0.5)

        best_val_acc = 0.0
        history = {"train_loss": [], "val_loss": [], "val_acc": []}

        for epoch in range(1, epochs + 1):
            model.train()
            train_loss = 0.0
            for images, labels in train_loader:
                images, labels = images.to(self.device), labels.to(self.device)
                optimizer.zero_grad()
                outputs = model(images)
                loss = criterion(outputs, labels)
                loss.backward()
                optimizer.step()
                train_loss += loss.item() * images.size(0)

            model.eval()
            val_loss, correct, total = 0.0, 0, 0
            with torch.no_grad():
                for images, labels in val_loader:
                    images, labels = images.to(self.device), labels.to(self.device)
                    outputs = model(images)
                    loss = criterion(outputs, labels)
                    val_loss += loss.item() * images.size(0)
                    preds = outputs.argmax(dim=1)
                    correct += (preds == labels).sum().item()
                    total += labels.size(0)

            train_loss /= split
            val_loss /= (n - split)
            val_acc = correct / total if total else 0.0
            scheduler.step(val_loss)

            history["train_loss"].append(round(train_loss, 4))
            history["val_loss"].append(round(val_loss, 4))
            history["val_acc"].append(round(val_acc, 4))
            logger.info(
                "Epoch %d/%d train_loss=%.4f val_loss=%.4f val_acc=%.3f",
                epoch, epochs, train_loss, val_loss, val_acc,
            )

            if val_acc >= best_val_acc:
                best_val_acc = val_acc
                torch.save(model.state_dict(), self.model_path)

        self.model = model
        self.model.eval()

        return {
            "status": "success",
            "epochs": epochs,
            "samples": n,
            "trainSamples": split,
            "valSamples": n - split,
            "bestValAccuracy": round(best_val_acc, 4),
            "history": history,
            "modelPath": self.model_path,
        }

    # ------------------------------------------------------------------ #
    # inference
    # ------------------------------------------------------------------ #
    def predict(self, photo_refs: List[str]) -> Optional[Dict[str, Any]]:
        """Classify one or more inspection photos into A/B/C.

        ``photo_refs`` items may be local paths, ``/uploads/<file>`` style
        server URLs (relative to ``UPLOAD_DIR``) or full http(s) URLs.
        Probabilities are averaged across all readable photos, so the estimate
        is stable even when one photo is unreadable.

        Returns None when the model is unavailable or no photo could be read.
        """
        if not self.is_available or not self.load():
            return None

        paths = [self._resolve_path(ref) for ref in (photo_refs or [])]
        transform = _default_transform()
        probs_accumulator = None
        images_used = 0

        with torch.no_grad():
            for path in paths:
                try:
                    image = Image.open(path).convert("RGB")
                except Exception:
                    continue
                tensor = transform(image).unsqueeze(0).to(self.device)
                logits = self.model(tensor)
                probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
                if probs_accumulator is None:
                    probs_accumulator = probs
                else:
                    probs_accumulator += probs
                images_used += 1

        if probs_accumulator is None:
            return None

        avg = probs_accumulator / images_used
        grade_idx = int(avg.argmax())
        estimated = GRADES[grade_idx]
        confidence = round(float(avg[grade_idx]), 4)

        return {
            "estimatedGrade": estimated,
            "confidence": confidence,
            "model": "quality_vision",
            "photosProcessed": images_used,
            "probabilities": {grade: round(float(p), 4) for grade, p in zip(GRADES, avg)},
        }

    # ------------------------------------------------------------------ #
    # helpers
    # ------------------------------------------------------------------ #
    def _resolve_path(self, ref: str) -> str:
        """Turn a photo reference into a readable local file path."""
        ref = (ref or "").strip()
        if not ref:
            return ref
        if ref.startswith("/uploads/"):
            from app.core.config import settings

            candidate = os.path.join(settings.UPLOAD_DIR, os.path.basename(ref))
            if os.path.exists(candidate):
                return candidate
            return ref
        if ref.startswith("http://") or ref.startswith("https://"):
            return self._download(ref)
        return ref

    def _download(self, url: str) -> str:
        """Best-effort download of a remote image to a temp file."""
        try:
            import requests

            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            suffix = os.path.splitext(url.split("?")[0])[1] or ".jpg"
            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            tmp.write(resp.content)
            tmp.close()
            return tmp.name
        except Exception as e:  # pragma: no cover
            logger.warning("Could not download image %s: %s", url, e)
            return url


quality_vision_model = QualityVisionModel()
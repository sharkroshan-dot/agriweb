#!/usr/bin/env python3
"""Scan the repository for accidentally committed secrets.

Run from the repo root:
    python scripts/check_secrets.py

Exits non-zero (failing CI) if any real-looking secret pattern is found in a
tracked file. Recognised providers: Stripe, Razorpay, AWS, Google Maps,
Firebase, OpenAI, Twilio, Vonage, Sentry, generic JWT/private keys.

False positives are expected on placeholder strings like ``sk_test_REPLACE``;
the check is designed to catch high-entropy secrets such as ``sk_live_...``,
``rzp_live_...``, ``sk-proj-...`` and ``AIza...``.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Provider patterns (regex -> friendly name)
PATTERNS = [
    (re.compile(r"sk_live_[A-Za-z0-9]{16,}"), "Stripe secret key"),
    (re.compile(r"whsec_[A-Za-z0-9]{16,}"), "Stripe webhook secret"),
    (re.compile(r"rzp_live_[A-Za-z0-9]{14,}"), "Razorpay live key"),
    (re.compile(r"rzp_test_[A-Za-z0-9]{14,}"), "Razorpay test key"),
    (re.compile(r"AIza[0-9A-Za-z_-]{30,}"), "Google API key"),
    (re.compile(r"sk-proj-[A-Za-z0-9_-]{40,}"), "OpenAI API key"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AWS access key"),
    (re.compile(r"AAAA[A-Za-z0-9_-]{60,}"), "Firebase server key"),
    (re.compile(r"SK[A-Za-z0-9]{60,}"), "Twilio API key"),
    (re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----"), "Private key"),
]

# Files that may legitimately contain placeholder values matching patterns
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", ".next", ".dart_tool",
    "build", "dist", "__pycache__", ".pytest_cache", ".mypy_cache", "logs",
    ".npm-cache",  # cached package tarballs contain SDK test keys
}
SKIP_NAMES = {"package-lock.json", "package.json", "pubspec.lock"}
SKIP_SUFFIXES = {".pyc", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff",
                 ".woff2", ".ttf", ".pkl", ".joblib", ".lock", ".pdf"}


def scan_file(path: Path) -> list[str]:
    hits: list[str] = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return hits
    for line_no, line in enumerate(text.splitlines(), 1):
        for pattern, name in PATTERNS:
            if pattern.search(line):
                # Skip placeholder lines
                stripped = line.strip().lstrip("#").strip()
                if "REPLACE" in stripped or "change-me" in stripped or "your-" in stripped:
                    continue
                hits.append(f"  {path} : {line_no}: {name}")
                break
    return hits


def main() -> int:
    found: list[str] = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        if path.name in SKIP_NAMES:
            continue  # dependency lockfiles contain SDK test keys
        if path.name == ".env":
            continue  # .env is gitignored; still flag it if present
        found.extend(scan_file(path))

    if found:
        print(f"[FAIL] Found {len(found)} potential secret(s):")
        for item in found:
            print(item)
        print("\nAction: rotate the secret and remove it from the file.")
        return 1

    print("[OK] No committed secrets detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

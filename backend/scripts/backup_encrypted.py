"""Encrypted MongoDB backup script.

Dumps the database to a JSON file, encrypts it with AES-256-GCM using a key
derived from BACKUP_ENCRYPTION_KEY (or --key), then optionally removes the
plaintext temp file. Keeps the last N backups.

Usage:
    python scripts/backup_encrypted.py [--db agri] [--keep 5] [--out dir]
        [--key <32+ char secret>]

Prerequisites:
    - mongodump installed OR the pymongo driver (used to stream BSON data).
    - BACKUP_ENCRYPTION_KEY env var (32+ chars) - store it separately from the
      database; you cannot restore backups without it.
"""
import argparse
import asyncio
import base64
import gzip
import json
import logging
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from app.core.config import settings
from app.database.mongodb import MongoDB

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backup")


def derive_key(secret: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200_000)
    return kdf.derive(secret.encode())


async def dump_database(uri: str, db_name: str) -> dict:
    """Read every collection into a dict (name -> list of documents)."""
    import motor.motor_asyncio

    client = motor.motor_asyncio.AsyncIOMotorClient(uri)
    db = client[db_name]
    data = {}
    names = await db.list_collection_names()
    for name in names:
        if name.startswith("system."):
            continue
        docs = await db[name].find({}).to_list(length=None)
        data[name] = docs
    client.close()
    return data


def encrypt_bytes(plaintext: bytes, secret: str) -> bytes:
    salt = os.urandom(16)
    key = derive_key(secret, salt)
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext, None)
    # layout: salt(16) || nonce(12) || ciphertext
    return salt + nonce + ct


def decrypt_bytes(blob: bytes, secret: str) -> bytes:
    """Decrypt a payload produced by encrypt_bytes (salt||nonce||ct)."""
    salt, nonce, ct = blob[:16], blob[16:28], blob[28:]
    key = derive_key(secret, salt)
    return AESGCM(key).decrypt(nonce, ct, None)


def cleanup(outdir: Path, keep: int) -> None:
    backups = sorted(outdir.glob("backup_*.enc.gz"))
    for old in backups[:-keep] if keep > 0 else []:
        old.unlink(missing_ok=True)
        logger.info("Pruned old backup %s", old.name)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=settings.MONGODB_DATABASE)
    parser.add_argument("--out", default=str(Path.cwd() / "backups"))
    parser.add_argument("--keep", type=int, default=5)
    parser.add_argument("--key", default=os.environ.get("BACKUP_ENCRYPTION_KEY", ""))
    args = parser.parse_args()

    secret = args.key or os.environ.get("BACKUP_ENCRYPTION_KEY", "")
    if len(secret) < 32:
        logger.error("BACKUP_ENCRYPTION_KEY must be at least 32 characters.")
        return 1

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    uri = settings.MONGODB_URI
    if settings.MONGODB_USER and settings.MONGODB_PASSWORD:
        uri = uri.replace(
            "mongodb://",
            f"mongodb://{settings.MONGODB_USER}:{settings.MONGODB_PASSWORD}@",
        )

    logger.info("Dumping database '%s'...", args.db)
    data = await dump_database(uri, args.db)

    raw = json.dumps(data, default=str).encode()
    logger.info("Payload size: %.2f MB", len(raw) / 1024 / 1024)

    compressed = gzip.compress(raw, compresslevel=6)
    encrypted = encrypt_bytes(compressed, secret)

    stamp = __import__("datetime").datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    target = outdir / f"backup_{stamp}.enc.gz"
    target.write_bytes(encrypted)
    logger.info("Encrypted backup written to %s (%s bytes)", target, len(encrypted))

    cleanup(outdir, args.keep)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
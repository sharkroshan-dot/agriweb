#!/bin/sh
set -e

echo "[entrypoint] Starting container..."

# Optional: run any startup tasks here (migrations, seeding, etc.)
# Example placeholder for future migrations:
# if [ -f /app/scripts/seed_data.py ]; then
#   python /app/scripts/seed_data.py || true
# fi

# Execute the command passed to the container
exec "$@"

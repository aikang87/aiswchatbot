#!/bin/sh
set -e

echo "[entrypoint] running alembic migrations..."
alembic upgrade head

echo "[entrypoint] starting: $*"
exec "$@"

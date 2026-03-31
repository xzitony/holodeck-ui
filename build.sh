#!/bin/bash
set -e

export GIT_SHA=$(git rev-parse HEAD)
export BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "Building Holodeck UI..."
echo "  Commit: ${GIT_SHA:0:7}"
echo "  Time:   $BUILD_TIME"

docker compose up --build "$@"

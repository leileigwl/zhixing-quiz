#!/usr/bin/env bash
# 启用仓库自带的 git hooks（.githooks/pre-commit 与 .githooks/pre-push）。
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
chmod +x .githooks/*
git config core.hooksPath .githooks
echo "✔ core.hooksPath = $(git config core.hooksPath)"

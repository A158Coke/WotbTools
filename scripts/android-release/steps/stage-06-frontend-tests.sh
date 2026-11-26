#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 8: Frontend tests + build validation).
# Behavior is preserved; edit this script, not the workflow YAML.
pnpm install --frozen-lockfile
pnpm test
pnpm run build

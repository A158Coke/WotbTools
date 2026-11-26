#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 10: Build the local-first frontend bundle into APK assets).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
pnpm --dir frontend run build:android

#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 10: Build the local-first frontend bundle into APK assets).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
pnpm --dir frontend run build:android
# 2D 底图与 Web 同字节随包（无派生）：build 内部已逐条 fail closed（注册表每张地图
# 都必须有随包资源），并写下 bundle manifest 的 maps 段与 map2d-embedded.json。

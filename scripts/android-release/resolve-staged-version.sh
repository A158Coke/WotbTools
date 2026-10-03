#!/usr/bin/env bash
# Resolve release metadata from a specific immutable tag target (the **staged** Android source).
#
# 为什么 publish 需要它（PR #467 review P2）：publish 的候选版本不能再从「当前 main 的
# android/gradle.properties」推导 —— 真机验证期间 main 可能已经升到 2.0.2，而 2.0.1 才是已
# staged / 已验证 / 不可变的那个候选。因此操作者显式给出要发布的版本，tag 名由它推导，
# 而 versionCode / bridge 从 **tag target** 的源码读取，不接受任何工作区文件。
#
# 与 resolve-version.sh 的分工：
#   resolve-version.sh                 → 从工作区（= 当前 main）解析「当前策略/版本」
#   resolve-staged-version.sh（本文件） → 从 immutable tag target 解析「已 staged 的候选身份」
#
# 输出仅为 `key=value` 行，直接追加到 $GITHUB_OUTPUT。
# versionName/versionCode/tag/APK 名的推导口径只有 resolve-version.sh 一份实现，本脚本不重复；
# scripts/android-release/test-release.sh 用真实 git fixture 覆盖「tag target ⇒ 候选身份」。
set -euo pipefail

ROOT="${WOTB_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STAGED_PROPERTIES="${WOTB_STAGED_PROPERTIES:-}"
REQUESTED="${WOTB_REQUESTED_VERSION:-}"

if [ -z "$STAGED_PROPERTIES" ]; then
  echo "::error::WOTB_STAGED_PROPERTIES is required (export it with: git archive <ref> -- android/gradle.properties | tar -x -C \"\$dir\")" >&2
  exit 1
fi
if [ ! -f "$STAGED_PROPERTIES" ]; then
  echo "::error::WOTB_STAGED_PROPERTIES=$STAGED_PROPERTIES does not exist (the tag target must contain android/gradle.properties)" >&2
  exit 1
fi
if [ -z "$REQUESTED" ]; then
  echo "::error::WOTB_REQUESTED_VERSION is required (publish must name the staged version explicitly)" >&2
  exit 1
fi

# staged 源码的 gradle.properties 由 workflow 用 `git archive <tag target>` 导出后传入；
# 这里只做「读取 + 与请求版本比对」，不接触工作区的 android/gradle.properties。
WOTB_ROOT="$ROOT" WOTB_TRIGGER=workflow_dispatch WOTB_TAG_NAME="" \
  WOTB_COMMIT="${WOTB_STAGED_REF:-}" WOTB_STAGED_REF="${WOTB_STAGED_REF:-}" \
  WOTB_STAGED_PROPERTIES="$STAGED_PROPERTIES" \
  WOTB_REQUESTED_VERSION="$REQUESTED" \
  bash "$ROOT/scripts/android-release/resolve-version.sh"

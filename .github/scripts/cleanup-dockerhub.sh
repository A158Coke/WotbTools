#!/usr/bin/env bash
# 清理 Docker Hub 仓库:
#   1) 每个 *-sha-* 家族只保留最新 KEEP 个 tag,删更老的 tag(*-latest 永不删)
#   2) 删除所有"无 tag"的 digest —— 这才是 image-management 里 digest 持续增长的根源
#      (删 tag 不会删底层 digest,Docker Hub 免费版也不自动回收)
#
# 入参(环境变量):
#   DOCKER_USER   Docker Hub 用户名
#   DOCKER_TOKEN  PAT(需 Read/Write/Delete 权限)
#   NS            namespace(默认 a158coke)
#   REPO_NAME     仓库名(默认 wotbtool)
#   KEEP          每个 sha 家族保留数(默认 10)
#   DRY_RUN       无 tag digest 删除: true=仅预览 / false=真删(默认 false)
set -euo pipefail

: "${DOCKER_USER:?need DOCKER_USER}"
: "${DOCKER_TOKEN:?need DOCKER_TOKEN}"
NS="${NS:-a158coke}"
REPO_NAME="${REPO_NAME:-wotbtool}"
KEEP="${KEEP:-10}"
DRY_RUN="${DRY_RUN:-false}"
HUB="https://hub.docker.com/v2"
REPO="${NS}/${REPO_NAME}"

# ---- 登录拿 JWT ----
TOKEN=$(curl -fsS -H "Content-Type: application/json" \
  -d "{\"username\":\"${DOCKER_USER}\",\"password\":\"${DOCKER_TOKEN}\"}" \
  "${HUB}/users/login/" | jq -r '.token // empty')
[ -z "$TOKEN" ] && { echo "::error::Docker Hub 登录失败(token 为空,检查 DOCKER_PASSWORD 是否为有效 PAT)。"; exit 1; }
echo "登录成功。KEEP=${KEEP} DRY_RUN=${DRY_RUN}"

FAILED=0

# ========== 1) 每族 tag 保留最新 KEEP ==========
ALL="$(mktemp)"
URL="${HUB}/repositories/${REPO}/tags?page_size=100"
while [ -n "$URL" ] && [ "$URL" != "null" ]; do
  RESP=$(curl -fsS -H "Authorization: JWT ${TOKEN}" "$URL")
  echo "$RESP" | jq -r '.results[] | "\(.last_updated)\t\(.name)"' >> "$ALL"
  URL=$(echo "$RESP" | jq -r '.next // empty')
done
echo "当前 tag 数: $(grep -c . "$ALL" || true)"
for IMG in backend frontend; do
  echo "== ${IMG}-sha-* 保留最新 ${KEEP} =="
  DELETE=$({ grep -P "\t${IMG}-sha-" "$ALL" || true; } | sort -rk1,1 | tail -n +"$((KEEP+1))" | cut -f2)
  [ -z "$DELETE" ] && { echo "  无需删除"; continue; }
  while IFS= read -r TAG; do
    [ -z "$TAG" ] && continue
    CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
      -H "Authorization: JWT ${TOKEN}" "${HUB}/repositories/${REPO}/tags/${TAG}/")
    if [ "$CODE" = "204" ] || [ "$CODE" = "200" ]; then
      echo "  已删 tag ${TAG} ($CODE)"
    else
      echo "::warning::删 tag 失败 ${TAG} ($CODE)"; FAILED=1
    fi
    sleep 0.3
  done <<< "$DELETE"
done

# ========== 2) 删除无 tag 的 digest(best-effort, 不让本步失败影响整个 job) ==========
echo "== 无 tag digest 清理 (DRY_RUN=${DRY_RUN}) =="
DG="$(mktemp)"
# 先探测 image-management 列表端点是否可用(带鉴权)。不可用就告警跳过,不 exit。
IMG_URL="${HUB}/namespaces/${NS}/repositories/${REPO_NAME}/images?currently_tagged=false&status=active&page_size=100"
HTTP=$(curl -sS -o /tmp/img0.json -w '%{http_code}' -H "Authorization: JWT ${TOKEN}" "$IMG_URL" || echo "000")
if [ "$HTTP" != "200" ]; then
  echo "::warning::无 tag digest 列表 API 返回 HTTP ${HTTP} —— 端点不可用(可能免费版不开放/路径变更),跳过 digest 清理。"
  echo "  替代: Docker Hub 网页 image-management → Filter by Untagged → Preview and delete;或抓浏览器 Network 里的真实请求反馈以校准。"
else
  URL="$IMG_URL"
  while [ -n "$URL" ] && [ "$URL" != "null" ]; do
    RESP=$(curl -sS -H "Authorization: JWT ${TOKEN}" "$URL")
    echo "$RESP" | jq -r '.results[]?.digest' >> "$DG" 2>/dev/null || true
    URL=$(echo "$RESP" | jq -r '.next // empty' 2>/dev/null || echo "")
  done
  N=$(grep -c . "$DG" || true)
  echo "无 tag digest 数: ${N}"
  if [ "${N}" != "0" ]; then
  MAN=$(jq -R -s --arg repo "$REPO_NAME" \
    'split("\n")|map(select(length>0))|map({repository:$repo,digest:.})' "$DG")
  # 先 dry-run 探测 warnings
  DRY=$(curl -sS -H "Authorization: JWT ${TOKEN}" -H "Content-Type: application/json" \
    -d "$(jq -n --argjson m "$MAN" '{dry_run:true,manifests:$m}')" \
    -X POST "${HUB}/namespaces/${NS}/delete-images")
  echo "  dry-run 摘要: $(echo "$DRY" | jq -c '{dry_run,metrics}' 2>/dev/null || echo "$DRY" | head -c 600)"
  if [ "${DRY_RUN}" = "true" ]; then
    echo "  DRY_RUN=true: 仅预览,未真删。"
  else
    IGN=$(echo "$DRY" | jq -c '[.manifests[]? | . as $m | (($m.warnings // [])[] | {repository:$m.repository,digest:$m.digest,warning:.})]' 2>/dev/null || echo '[]')
    RES=$(curl -sS -H "Authorization: JWT ${TOKEN}" -H "Content-Type: application/json" \
      -d "$(jq -n --argjson m "$MAN" --argjson ig "$IGN" '{dry_run:false,manifests:$m,ignore_warnings:$ig}')" \
      -X POST "${HUB}/namespaces/${NS}/delete-images")
    echo "  删除摘要: $(echo "$RES" | jq -c '.metrics' 2>/dev/null || echo "$RES" | head -c 600)"
    ERRN=$(echo "$RES" | jq -r '((.errors // []) | length)' 2>/dev/null || echo 0)
    [ "${ERRN}" != "0" ] && echo "::warning::部分 digest 删除报错: $(echo "$RES" | jq -c '.errors' 2>/dev/null)"
    fi
  fi
fi

[ "${FAILED}" = "1" ] && { echo "::error::有 tag 删除失败(检查 PAT 删除权限: Read/Write/Delete)。"; exit 1; }
echo "清理完成。"

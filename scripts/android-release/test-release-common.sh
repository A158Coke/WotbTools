fail() { echo "FAIL: $*" >&2; exit 1; }

resolve() {
  local tag_name=""
  if [ "$#" -ge 2 ]; then tag_name="$2"; fi
  WOTB_ROOT="$ROOT" WOTB_TRIGGER="$1" WOTB_TAG_NAME="$tag_name" WOTB_COMMIT="deadbeef" bash "$RESOLVE"
}

#!/usr/bin/env bash
set -Eeuo pipefail
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export ANDROID_DOWNLOAD_ROOT="$work/origin"
root=$ANDROID_DOWNLOAD_ROOT
installer="$(dirname "$0")/install-android-download.sh"
mkdir -p "$root/android" "$root/incoming"
touch "$root/.install.lock" "$root/incoming/other-run.partial"
src="$work/upload"
printf 'original candidate' > "$src"
size=$(stat -c %s "$src")
sha=$(sha256sum < "$src" | cut -d' ' -f1)
name=wotbtools-android-v1.2.3.apk
delta="wotbtools-android-delta-1002002-1002003-$sha.vcdiff"
reject() {
  if "$@"; then echo "unexpected success: $*" >&2; exit 1; fi
}
install_file() { bash "$installer" "$@"; }
for bad in "../$name" version.json "$name.partial"; do
  reject install_file "$src" "$bad" "$size" "$sha"
done
ln -s "$src" "$work/link"
reject install_file "$work/link" "$name" "$size" "$sha"
reject install_file "$work" "$name" "$size" "$sha"
reject install_file "$src" "$name" 1 "$sha"
wrong_sha=$(printf '0%.0s' {1..64})
reject install_file "$src" "$name" "$size" "$wrong_sha"
reject install_file "$src" "$delta" "$size" "$wrong_sha"
dest="$root/android/$name"
ln -s "$src" "$dest"
reject install_file "$src" "$name" "$size" "$sha"
rm "$dest"
mkdir "$dest"
reject install_file "$src" "$name" "$size" "$sha"
rmdir "$dest"

# Exercise a real short write (EFBIG) while copying the private incoming file.
dd if=/dev/zero of="$work/oversize" bs=4096 count=8 status=none
reject_limited_write() (
  ulimit -c 0 -f 4
  install_file "$work/oversize" "$name" 32768 "$(sha256sum < "$work/oversize" | cut -d' ' -f1)"
)
reject reject_limited_write
[[ ! -e $dest && -f $root/incoming/other-run.partial ]]
[[ $(find "$root/incoming" -name '.install.*' | wc -l) == 0 ]]

pids=()
for _ in {1..4}; do install_file "$src" "$name" "$size" "$sha" & pids+=("$!"); done
for pid in "${pids[@]}"; do wait "$pid"; done
inode=$(stat -c %i "$dest")
install_file "$src" "$name" "$size" "$sha"
[[ $(stat -c %i "$dest") == "$inode" ]]
printf 'conflict candidate' > "$work/conflict"
reject install_file "$work/conflict" "$name" "$(stat -c %s "$work/conflict")" "$(sha256sum < "$work/conflict" | cut -d' ' -f1)"
cmp "$src" "$dest"
install_file "$src" "$delta" "$size" "$sha"
cmp "$src" "$root/android/$delta"
echo 'Android origin immutable install: PASS'

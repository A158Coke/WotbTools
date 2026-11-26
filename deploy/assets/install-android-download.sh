#!/usr/bin/env bash
# Run on the Linux origin with an upload from a private, uploader-owned directory.
set -Eeuo pipefail
export LC_ALL=C

fail() { echo "install Android download: $*" >&2; exit 1; }
[[ $# == 4 ]] || fail "usage: $0 SOURCE NAME EXPECTED_SIZE EXPECTED_SHA256"
src=$1 name=$2 size=$3 sha=$4
root=${ANDROID_DOWNLOAD_ROOT:-/srv/wotb-downloads}
dest="$root/android/$name"
[[ $size =~ ^[1-9][0-9]*$ && $sha =~ ^[0-9a-f]{64}$ ]] || fail "invalid expected size or SHA-256"
if [[ $name =~ ^wotbtools-android-delta-[0-9]+-[0-9]+-([0-9a-f]{64})\.vcdiff$ ]]; then
  [[ ${BASH_REMATCH[1]} == "$sha" ]] || fail "delta filename disagrees with expected SHA-256"
else
  [[ $name =~ ^wotbtools-android-v[0-9]+\.[0-9]+\.[0-9]+\.apk$ ]] || fail "invalid release filename"
fi
[[ -f $src && ! -L $src ]] || fail "source must be a regular file"
[[ -d $root/incoming && ! -L $root/incoming && -d $root/android && ! -L $root/android ]] || fail "origin directories missing or symlinked"
[[ -f $root/.install.lock && ! -L $root/.install.lock ]] || fail "origin lock missing or symlinked"
exec 9<"$root/.install.lock"
flock -w 120 9 || fail "timed out waiting for origin lock"

verify_file() {
  local file=$1 actual_size actual_sha
  [[ -f $file && ! -L $file ]] || fail "not a regular file: $file"
  actual_size=$(stat -c %s -- "$file")
  [[ $actual_size == "$size" ]] || fail "expected size=$size actual=$actual_size"
  actual_sha=$(sha256sum < "$file")
  actual_sha=${actual_sha%% *}
  [[ $actual_sha == "$sha" ]] || fail "expected SHA-256=$sha actual=$actual_sha"
}

tmp=$(mktemp "$root/incoming/.install.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
cp -- "$src" "$tmp"
verify_file "$tmp"
chmod 0644 "$tmp"
if [[ -e $dest || -L $dest ]]; then
  verify_file "$dest"
else
  # Hard-link creation fails on EEXIST, EXDEV, ENOSPC and permission errors.
  ln -T -- "$tmp" "$dest"
fi
echo "verified on disk: $name size=$size sha256=$sha"

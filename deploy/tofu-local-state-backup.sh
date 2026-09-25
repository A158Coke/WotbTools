#!/usr/bin/env bash
# Back up the host's fixed local OpenTofu states without exposing state contents.
set -Eeuo pipefail
umask 077

case "${1:-}" in
  tx)
    host_root=/opt/wotb-tx
    state_paths=(
      postgres-business-tofu-state/terraform.tfstate
      postgres-keycloak-tofu-state/terraform.tfstate
      keycloak-tofu-state/terraform.tfstate
    )
    ;;
  yecao)
    host_root=/opt/wotb
    state_paths=(grafana-tofu-state/terraform.tfstate)
    ;;
  *) echo "Usage: $0 <tx|yecao>" >&2; exit 2 ;;
esac
[[ -d "$host_root" && ! -L "$host_root" ]] || { echo 'Owner-host state root is unavailable.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'flock is required.' >&2; exit 2; }
command -v tar >/dev/null || { echo 'tar is required.' >&2; exit 2; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required.' >&2; exit 2; }

backup_root="$host_root/backups/opentofu-state"
install -d -m 700 "$backup_root"
exec 9>"$host_root/.deploy.lock"
flock -n 9 || { echo 'Another owner-host production mutation is running.' >&2; exit 1; }
exec 8>"$backup_root/.backup.lock"
flock -n 8 || { echo 'Another OpenTofu state backup is running.' >&2; exit 1; }
for relative in "${state_paths[@]}"; do
  file="$host_root/$relative"
  [[ -f "$file" && -s "$file" && ! -L "$file" ]] || {
    echo "Required persistent OpenTofu state is missing or unsafe: $file" >&2
    exit 1
  }
done

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
archive="$backup_root/${1}-opentofu-state-${timestamp}.tar.gz"
[[ ! -e "$archive" && ! -L "$archive" ]] || { echo 'Refusing to overwrite a state backup.' >&2; exit 1; }
tmp="$archive.tmp.$$"
trap 'rm -f -- "$tmp" "$tmp.sha256"' EXIT
(cd "$host_root" && tar -czf "$tmp" -- "${state_paths[@]}")
[[ -s "$tmp" ]] || { echo 'OpenTofu state backup archive is empty.' >&2; exit 1; }
tar -tzf "$tmp" >/dev/null
sha256sum "$tmp" | awk '{print $1}' > "$tmp.sha256"
chmod 600 "$tmp" "$tmp.sha256"
[[ "$(sha256sum "$tmp" | awk '{print $1}')" == "$(tr -d '[:space:]' < "$tmp.sha256")" ]] || {
  echo 'OpenTofu state archive checksum validation failed.' >&2
  exit 1
}
mv -- "$tmp" "$archive"
mv -- "$tmp.sha256" "$archive.sha256"
echo "OpenTofu state backup created and archive verified: $archive"

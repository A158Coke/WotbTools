#!/usr/bin/env bash
# Create one job-scoped native OpenSSH configuration for TX image publication.
set -euo pipefail

for required in TX_VPS_HOST TX_VPS_USER TX_VPS_PORT TX_VPS_SSH_KEY RUNNER_TEMP GITHUB_ENV; do
  [ -n "${!required:-}" ] || {
    printf 'ERROR: %s is required\n' "$required" >&2
    exit 2
  }
done
[[ "$TX_VPS_PORT" =~ ^[1-9][0-9]*$ ]] || {
  printf 'ERROR: TX_VPS_PORT must be a positive integer\n' >&2
  exit 2
}

ssh_dir="$RUNNER_TEMP/tx-image-publication-ssh"
rm -rf -- "$ssh_dir"
umask 077
mkdir -p "$ssh_dir"
printf '%s\n' "$TX_VPS_SSH_KEY" > "$ssh_dir/id_ed25519"
chmod 600 "$ssh_dir/id_ed25519"

# No pinned host key is currently configured for TX. This retains the existing
# trust model while ensuring the native client never disables host-key checks.
timeout --kill-after=10s 30s ssh-keyscan -p "$TX_VPS_PORT" -H "$TX_VPS_HOST" > "$ssh_dir/known_hosts"
test -s "$ssh_dir/known_hosts"
cat > "$ssh_dir/config" <<EOF
Host tx-image-publication
  HostName $TX_VPS_HOST
  User $TX_VPS_USER
  Port $TX_VPS_PORT
  IdentityFile $ssh_dir/id_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile $ssh_dir/known_hosts
  StrictHostKeyChecking yes
  BatchMode yes
EOF
chmod 600 "$ssh_dir/config"
printf 'TX_SSH_DIR=%s\n' "$ssh_dir" >> "$GITHUB_ENV"

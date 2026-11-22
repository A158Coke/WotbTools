set -euo pipefail
bash /opt/wotb-tx/android-evidence.incoming/deploy/tx/install-staging-evidence.sh \
  --source "/opt/wotb-tx/android-evidence.incoming/release-staging/$PATCH_NAME" \
  --dest-dir /opt/wotb-tx/android-release --lock /opt/wotb-tx/.deploy.lock

set -euo pipefail
bash /opt/wotb-tx2/android-evidence.incoming/deploy/tx/install-staging-evidence.sh \
  --source "/opt/wotb-tx2/android-evidence.incoming/release-staging/$PATCH_NAME" \
  --dest-dir /opt/wotb-tx2/runtime-content/android-release --lock /opt/wotb-tx2/.deploy.lock

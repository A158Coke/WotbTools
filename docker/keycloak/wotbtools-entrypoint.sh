#!/bin/sh
set -eu

echo "WotBTools Keycloak build=${WOTBTOOLS_BUILD_COMMIT:-unknown}"
exec /opt/keycloak/bin/kc.sh "$@"

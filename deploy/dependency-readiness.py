#!/usr/bin/env python3
"""Read-only, consumer-network checks for the production business API."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request


class ReadinessError(RuntimeError):
    pass


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise ReadinessError(f"required readiness input is missing: {name}")
    return value


def check_keycloak() -> None:
    # The endpoint is never invented here: dependency-readiness.sh validates it
    # against the canonical reviewed allowlist and passes the accepted value in,
    # so a missing value means no validation happened and the probe must refuse
    # to send the admin client secret anywhere.
    base = required("TX_KEYCLOAK_ADMIN_SERVER_URL").rstrip("/") + "/realms/wotbtools"
    with urllib.request.urlopen(base + "/.well-known/openid-configuration", timeout=8) as response:
        if response.status != 200:
            raise ReadinessError("Keycloak realm discovery did not return HTTP 200")
        discovery = json.load(response)
    if discovery.get("issuer") != "https://auth.wotbtools.com/realms/wotbtools":
        raise ReadinessError("Keycloak discovery issuer does not match the production realm")

    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": "wotbtools-admin-api",
            "client_secret": required("KEYCLOAK_ADMIN_CLIENT_SECRET"),
        }
    ).encode("utf-8")
    request = urllib.request.Request(base + "/protocol/openid-connect/token", data=body, method="POST")
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200:
            raise ReadinessError("Keycloak admin client authentication did not return HTTP 200")
        token = json.load(response).get("access_token")
    if not isinstance(token, str) or not token:
        raise ReadinessError("Keycloak did not issue an admin API client token")


def retry(label: str, check, attempts: int = 3) -> None:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            check()
            print(f"{label}: PASS", flush=True)
            return
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2)
    raise ReadinessError(f"{label}: FAIL ({type(last_error).__name__})")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] != "business-api":
        print("usage: dependency-readiness.py business-api", file=sys.stderr)
        return 2
    try:
        retry("keycloak-oidc-and-client", check_keycloak)
    except Exception as error:
        print(f"dependency readiness failed: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

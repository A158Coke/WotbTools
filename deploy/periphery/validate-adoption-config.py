#!/usr/bin/env python3
"""Validate an already-running Periphery config before lifecycle adoption.

The currently installed Alibaba config predates repository ownership and uses
Komodo's legacy singular ``core_address`` spelling plus implicit defaults for the
outbound server/identity fields. Canonicalize only those representation/default
spelling differences; every effective setting must otherwise equal the reviewed
target before the durable onboarding marker can be committed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import NoReturn

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Ubuntu 24.04 ships Python >= 3.11
    sys.exit("python >= 3.11 is required for Periphery adoption validation")


def fail(message: str) -> NoReturn:
    raise SystemExit(f"Periphery adoption config validation failed: {message}")


def load(path: Path) -> dict:
    try:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        fail(f"cannot read {path}: {error}")
    if not isinstance(data, dict):
        fail(f"{path} is not a TOML table")
    return data


def canonicalize(config: dict, label: str) -> dict:
    """Return the effective reviewed subset with Komodo defaults materialized.

    The live manually installed agent is allowed to differ from the repository
    file only in ways that are semantically identical in Komodo v2.3.3:

    * legacy ``core_address`` vs the canonical ``core_addresses`` list;
    * omission of outbound-mode / identity / operator booleans whose effective
      values are the explicit values committed in the reviewed target.

    Unknown or additional settings remain in the returned mapping, so the final
    equality comparison rejects every other semantic delta.
    """

    normalized = dict(config)

    singular_present = "core_address" in normalized
    plural_present = "core_addresses" in normalized
    if singular_present and plural_present:
        fail(f"{label} declares both core_address and core_addresses")
    if singular_present:
        value = normalized.pop("core_address")
        if not isinstance(value, str) or not value:
            fail(f"{label} core_address must be one non-empty string")
        normalized["core_addresses"] = [value]
    else:
        value = normalized.get("core_addresses")
        if not isinstance(value, list) or not value:
            fail(f"{label} must declare one Core address")
        if any(not isinstance(item, str) or not item for item in value):
            fail(f"{label} core_addresses must contain only non-empty strings")

    root = normalized.get("root_directory")
    if not isinstance(root, str) or not root.startswith("/"):
        fail(f"{label} root_directory must be one absolute path")

    cores = normalized["core_addresses"]
    if len(cores) != 1:
        fail(f"{label} must declare exactly one Core address")

    # With core_addresses configured, Komodo v2.3.3 defaults the inbound server
    # off. The manually bootstrapped Alibaba file omitted the explicit field.
    normalized.setdefault("server_enabled", False)

    # Periphery resolves an omitted identity/trust path under root_directory.
    # Materialize those defaults so the manual bootstrap can be adopted while an
    # explicit alternate path is rejected as a real identity change.
    normalized.setdefault("private_key", f"file:{root}/keys/periphery.key")
    normalized.setdefault("core_public_keys", [f"file:{root}/keys/core.pub"])

    normalized.setdefault("disable_terminals", False)
    normalized.setdefault("disable_container_terminals", False)
    normalized.setdefault("core_tls_insecure_skip_verify", False)

    if normalized["core_tls_insecure_skip_verify"] is not False:
        fail(f"{label} disables Core TLS verification")

    return normalized


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(
            "usage: validate-adoption-config.py <installed.toml> <reviewed.toml> <expected-connect-as>",
            file=sys.stderr,
        )
        return 2

    installed_path = Path(argv[1])
    reviewed_path = Path(argv[2])
    expected_connect_as = argv[3]
    if not expected_connect_as:
        fail("expected connect_as is empty")

    installed = canonicalize(load(installed_path), "installed config")
    reviewed = canonicalize(load(reviewed_path), "reviewed config")

    if reviewed.get("connect_as") != expected_connect_as:
        fail("reviewed config connect_as does not match the target profile")
    if installed.get("connect_as") != expected_connect_as:
        fail("installed connect_as does not match the reviewed target")

    if installed != reviewed:
        changed = sorted(
            key
            for key in set(installed) | set(reviewed)
            if installed.get(key) != reviewed.get(key)
        )
        fail(
            "installed effective config differs from the reviewed target in: "
            + ", ".join(changed)
        )

    print("Periphery adoption config validation: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

#!/usr/bin/env python3
"""Validate an already-running Periphery config before lifecycle adoption.

The currently installed Alibaba config predates repository ownership and may use
Komodo's legacy singular `core_address`, while the reviewed target config uses
`core_addresses`. Normalize only that representation difference; identity and Core
route must otherwise match exactly before the durable onboarding marker can be
committed.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Ubuntu 24.04 ships Python >= 3.11
    sys.exit("python >= 3.11 is required for Periphery adoption validation")


def fail(message: str) -> "NoReturn":
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


def core_addresses(config: dict, label: str) -> list[str]:
    singular_present = "core_address" in config
    plural_present = "core_addresses" in config
    if singular_present and plural_present:
        fail(f"{label} declares both core_address and core_addresses")

    if singular_present:
        value = config["core_address"]
        if not isinstance(value, str) or not value:
            fail(f"{label} core_address must be one non-empty string")
        return [value]

    value = config.get("core_addresses")
    if not isinstance(value, list) or not value:
        fail(f"{label} must declare one Core address")
    if any(not isinstance(item, str) or not item for item in value):
        fail(f"{label} core_addresses must contain only non-empty strings")
    return value


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

    installed = load(installed_path)
    reviewed = load(reviewed_path)

    reviewed_cores = core_addresses(reviewed, "reviewed config")
    installed_cores = core_addresses(installed, "installed config")
    if len(reviewed_cores) != 1:
        fail(f"reviewed target must declare exactly one Core address, found {len(reviewed_cores)}")
    if installed_cores != reviewed_cores:
        fail("installed Core address does not match the reviewed target")

    reviewed_connect_as = reviewed.get("connect_as")
    if reviewed_connect_as != expected_connect_as:
        fail("reviewed config connect_as does not match the target profile")
    if installed.get("connect_as") != expected_connect_as:
        fail("installed connect_as does not match the reviewed target")

    # A manually adopted host must not weaken TLS while claiming the reviewed
    # public HTTPS Core identity. Missing means the secure Komodo default.
    if installed.get("core_tls_insecure_skip_verify", False) is not False:
        fail("installed config disables Core TLS verification")

    print("Periphery adoption config validation: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

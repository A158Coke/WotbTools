#!/usr/bin/env python3
"""Contract test for the declarative Komodo resource root (K4.1+).

Validates `infra/komodo/resources/**/*.toml` structurally (never by grepping
descriptions):

  * every file parses as TOML;
  * only the reviewed resource types are declared (server, resource_sync, stack);
  * no duplicate name of the same resource type, across files;
  * the single ResourceSync carries the reviewed, non-destructive configuration;
  * exactly the reviewed production Servers are declared, in outbound mode, with
    the complete v2.3.3 `ServerConfig` field set at documented defaults;
  * exactly the reviewed Stack resources are declared with fail-closed configs;
  * no credential-looking key or inbound Periphery endpoint appears anywhere.

Komodo converts a partial `[server.config]` through the schema defaults before
diffing, so an omitted field is not "leave the live value alone" — that is why the
declared field set is pinned here.

Run: python3 scripts/ci/test-komodo-resources.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - environment guard
    sys.exit("python >= 3.11 is required (tomllib); no TOML dependency is added for this.")

REPO_ROOT = Path(__file__).resolve().parents[2]
RESOURCE_ROOT = REPO_ROOT / "infra" / "komodo" / "resources"
RESOURCE_PATH_VALUE = "infra/komodo/resources"

ALLOWED_TABLES = ("server", "resource_sync", "stack")
FORBIDDEN_TABLES = (
    "deployment", "build", "repo", "procedure", "action", "builder",
    "swarm", "alerter", "variable", "user_group",
)
ALLOWED_RESOURCE_KEYS = ("name", "description", "template", "tags", "deploy", "after", "config")
FORBIDDEN_KEY_NAMES = (
    "password", "secret", "token", "private_key", "onboarding_key", "git_account",
    "webhook_secret", "access_key", "api_key",
)
FORBIDDEN_KEY_SUFFIXES = ("_password", "_secret", "_token", "_private_key", "_onboarding_key")

SERVER_NAMES = ("yecao", "tx1", "tx2", "ali-sh-asset-01")
SERVER_CONFIG_FIELDS = {
    "address": "",
    "insecure_tls": True,
    "external_address": "",
    "region": "",
    "enabled": True,
    "auto_rotate_keys": True,
    "passkey": "",
    "ignore_mounts": [],
    "auto_prune": True,
    "links": [],
    "stats_monitoring": True,
    "send_unreachable_alerts": True,
    "send_cpu_alerts": True,
    "send_mem_alerts": True,
    "send_disk_alerts": True,
    "send_version_mismatch_alerts": True,
    "cpu_warning": 90.0,
    "cpu_critical": 99.0,
    "mem_warning": 75.0,
    "mem_critical": 95.0,
    "disk_warning": 75.0,
    "disk_critical": 95.0,
    "maintenance_windows": [],
}

MANAGED_METADATA = {"tags": [], "template": False}
RESOURCE_SYNC_CONFIG = {
    "git_provider": "github.com",
    "git_https": True,
    "repo": "A158Coke/WotBTools",
    "branch": "main",
    "resource_path": [RESOURCE_PATH_VALUE],
    "managed": False,
    "delete": False,
    "webhook_enabled": False,
    "include_resources": True,
    "include_variables": False,
    "include_user_groups": False,
    "pending_alert": True,
}
RESOURCE_SYNC_ALLOWED_KEYS = frozenset(RESOURCE_SYNC_CONFIG) | {
    "files_on_host", "linked_repo", "commit", "match_tags", "file_contents",
}
RESOURCE_SYNC_INERT_KEYS = {
    "files_on_host": False,
    "linked_repo": "",
    "commit": "",
    "match_tags": [],
    "file_contents": "",
}
RESOURCE_SYNC_FORBIDDEN_KEYS = ("git_account", "webhook_secret")

K7B_STACK_NAME = "wotbtools-frontend-shadow"
K7B_STACK_CONFIG = {
    "server": "tx2",
    "project_name": "wotbtools-frontend-shadow",
    "auto_pull": True,
    "run_build": False,
    "poll_for_updates": False,
    "auto_update": False,
    "auto_update_all_services": False,
    "destroy_before_deploy": False,
    "skip_secret_interp": False,
    "git_provider": "gitee.com",
    "git_https": True,
    "repo": "A158Coke/Wotbtools",
    "branch": "main",
    "commit": "",
    "clone_path": "",
    "reclone": False,
    "webhook_enabled": False,
    "webhook_force_deploy": False,
    "files_on_host": False,
    "run_directory": "deploy/tx",
    "file_paths": ["frontend-shadow.compose.yml"],
    "env_file_path": ".env",
    "send_alerts": True,
    "registry_provider": "",
    "registry_account": "",
    "extra_args": [],
    "build_extra_args": [],
    "compose_cmd_wrapper": "",
    "compose_cmd_wrapper_include": [],
    "ignore_services": [],
    "file_contents": "",
    "environment": "",
    "links": [],
}

# The host mutation lock owned by the Alibaba host's deploy owner. The Periphery
# lifecycle and the Komodo Stack deploy must serialize on this SAME lock; the
# wrapper must never introduce a second (Periphery-only) lock.
ASSET_HOST_LOCK = "/opt/wotb-asset/.deploy.lock"

ASSET_STACK_NAME = "wotbtools-asset-origin"
ASSET_STACK_CONFIG = {
    "server": "ali-sh-asset-01",
    "project_name": "wotbtools-asset-origin",
    "auto_pull": True,
    "run_build": False,
    "poll_for_updates": False,
    "auto_update": False,
    "auto_update_all_services": False,
    "destroy_before_deploy": False,
    "skip_secret_interp": False,
    "git_provider": "gitee.com",
    "git_https": True,
    "repo": "A158Coke/Wotbtools",
    "branch": "main",
    "commit": "",
    "clone_path": "",
    "reclone": False,
    "webhook_enabled": False,
    "webhook_force_deploy": False,
    "files_on_host": False,
    "run_directory": "deploy/assets",
    "file_paths": ["compose.yaml"],
    "config_files": [
        {"path": "Caddyfile", "services": ["caddy"], "requires": "redeploy"},
    ],
    "env_file_path": ".env",
    "send_alerts": True,
    "registry_provider": "",
    "registry_account": "",
    "extra_args": ["--force-recreate"],
    "build_extra_args": [],
    "compose_cmd_wrapper": (
        "flock --exclusive --nonblock /opt/wotb-asset/.deploy.lock -c '[[COMPOSE_COMMAND]]'"
    ),
    "compose_cmd_wrapper_include": ["up"],
    "ignore_services": [],
    "file_contents": "",
    "environment": "",
    "links": [],
}

STACK_CONFIGS = {
    K7B_STACK_NAME: K7B_STACK_CONFIG,
    ASSET_STACK_NAME: ASSET_STACK_CONFIG,
}

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)


def walk(node, path: tuple = ()):
    """Yield every (key-path, value) pair, recursing through tables and arrays."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield path + (key,), value
            yield from walk(value, path + (key,))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from walk(value, path + (index,))


def check_no_credentials(node, context: str) -> None:
    for key_path, value in walk(node):
        key = next((part for part in reversed(key_path) if isinstance(part, str)), "")
        lowered = key.lower()
        if lowered in FORBIDDEN_KEY_NAMES or lowered.endswith(FORBIDDEN_KEY_SUFFIXES):
            fail(f"{context}: forbidden credential-shaped key '{'.'.join(map(str, key_path))}'")
        if isinstance(value, str) and "8120" in value:
            fail(f"{context}: '{'.'.join(map(str, key_path))}' must not reference Periphery port 8120")
        if isinstance(value, str) and value.lower().startswith(("http://", "https://", "ws://", "wss://")):
            fail(f"{context}: '{'.'.join(map(str, key_path))}' must not carry an inbound Periphery address")


def load_files() -> dict[Path, dict]:
    if not RESOURCE_ROOT.is_dir():
        sys.exit(f"missing declarative resource root: {RESOURCE_ROOT}")
    files = sorted(RESOURCE_ROOT.rglob("*.toml"))
    if not files:
        sys.exit(f"no TOML declarations found under {RESOURCE_ROOT}")
    parsed: dict[Path, dict] = {}
    for path in files:
        try:
            parsed[path] = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as error:
            fail(f"{path.relative_to(REPO_ROOT)}: invalid TOML: {error}")
    return parsed


def check_resource_types(parsed: dict[Path, dict]) -> dict[str, dict[str, dict]]:
    """Returns {resource type: {name: declaration}}."""
    by_type: dict[str, dict[str, dict]] = {table: {} for table in ALLOWED_TABLES}
    for path, document in parsed.items():
        rel = path.relative_to(REPO_ROOT)
        for table in document:
            if table in FORBIDDEN_TABLES or table in {f"{name}s" for name in FORBIDDEN_TABLES}:
                fail(f"{rel}: declarative resources must not declare '{table}'")
            elif table not in ALLOWED_TABLES:
                fail(f"{rel}: unexpected resource type '{table}' (allowed: {', '.join(ALLOWED_TABLES)})")
        for table in ALLOWED_TABLES:
            entries = document.get(table, [])
            if not isinstance(entries, list):
                fail(f"{rel}: '{table}' must be declared as [[{table}]] tables")
                continue
            for index, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    fail(f"{rel}: '{table}' entry {index} is not a table")
                    continue
                name = entry.get("name")
                if not isinstance(name, str) or not name.strip():
                    fail(f"{rel}: '{table}' entry {index} has no name")
                    continue
                for key in entry:
                    if key not in ALLOWED_RESOURCE_KEYS:
                        fail(f"{rel}: {table} '{name}' has unreviewed key '{key}'")
                if name in by_type[table]:
                    fail(f"{rel}: duplicate {table} name '{name}'")
                by_type[table][name] = {"_file": rel, **entry}
    return by_type


def check_metadata(table: str, name: str, declaration: dict) -> None:
    if "description" not in declaration:
        fail(f"{table} '{name}': 'description' must be declared explicitly")
    elif not isinstance(declaration["description"], str):
        fail(f"{table} '{name}': description must be a string, found {declaration['description']!r}")
    for key, expected in MANAGED_METADATA.items():
        if key not in declaration:
            fail(f"{table} '{name}': '{key}' must be declared explicitly")
        elif declaration[key] != expected:
            fail(f"{table} '{name}': {key} must be {expected!r}, found {declaration[key]!r}")


def check_resource_sync(entries: dict[str, dict]) -> None:
    if len(entries) != 1:
        fail(f"declares exactly one resource_sync, found {sorted(entries) or '[]'}")
        return
    name, declaration = next(iter(entries.items()))
    if name != "wotbtools-main":
        fail(f"the resource_sync must be named 'wotbtools-main', found '{name}'")
    check_metadata("resource_sync", name, declaration)
    config = declaration.get("config")
    if not isinstance(config, dict):
        fail(f"resource_sync '{name}' has no [resource_sync.config] table")
        return
    for key, expected in RESOURCE_SYNC_CONFIG.items():
        if config.get(key) != expected:
            fail(f"resource_sync '{name}': {key} must be {expected!r}, found {config.get(key)!r}")
    for key in sorted(config):
        if key in RESOURCE_SYNC_FORBIDDEN_KEYS:
            fail(f"resource_sync '{name}': '{key}' is forbidden even when empty (public repository)")
        elif key not in RESOURCE_SYNC_ALLOWED_KEYS:
            fail(f"resource_sync '{name}': unreviewed config key '{key}' is not allowed")
    for key, expected in RESOURCE_SYNC_INERT_KEYS.items():
        if config.get(key, expected) != expected:
            fail(f"resource_sync '{name}': {key} must be {expected!r}, found {config.get(key)!r}")
    if config.get("resource_path") != [RESOURCE_PATH_VALUE]:
        fail(f"resource_sync '{name}': resource_path must be exactly ['{RESOURCE_PATH_VALUE}']")


def check_servers(entries: dict[str, dict]) -> None:
    if sorted(entries) != sorted(SERVER_NAMES):
        fail(f"declares exactly {sorted(SERVER_NAMES)}, found {sorted(entries)}")
    for name, declaration in sorted(entries.items()):
        context = f"server '{name}'"
        check_metadata("server", name, declaration)
        if declaration.get("deploy", False) is not False:
            fail(f"{context}: must not declare deploy = true")
        config = declaration.get("config")
        if not isinstance(config, dict):
            fail(f"{context}: has no [server.config] table")
            continue
        missing = sorted(set(SERVER_CONFIG_FIELDS) - set(config))
        if missing:
            fail(f"{context}: must declare complete v2.3.3 ServerConfig; missing: {missing}")
        extra = sorted(set(config) - set(SERVER_CONFIG_FIELDS))
        if extra:
            fail(f"{context}: unreviewed [server.config] field(s): {extra}")
        for key, expected in SERVER_CONFIG_FIELDS.items():
            if key not in config:
                continue
            found = config[key]
            if isinstance(expected, float):
                if not isinstance(found, float) or found != expected:
                    fail(f"{context}: {key} must be the TOML float {expected}, found {found!r}")
            elif isinstance(expected, bool):
                if found is not expected:
                    fail(f"{context}: {key} must be {expected}, found {found!r}")
            elif isinstance(expected, list):
                if found != expected:
                    fail(f"{context}: {key} must be {expected}, found {found!r}")
            elif found != expected:
                fail(f"{context}: {key} must be {expected!r}, found {found!r}")
        if config.get("address") != "":
            fail(f"{context}: address must stay empty so Periphery keeps connecting outbound")
        if config.get("passkey", "") != "":
            fail(f"{context}: passkey must stay empty")
        if "8120" in repr(config):
            fail(f"{context}: must not reference Periphery port 8120")


def check_stacks(entries: dict[str, dict]) -> None:
    expected_names = sorted(STACK_CONFIGS)
    if sorted(entries) != expected_names:
        fail(f"declares exactly stacks {expected_names}, found {sorted(entries)}")
        return
    for name, expected_config in STACK_CONFIGS.items():
        declaration = entries[name]
        check_metadata("stack", name, declaration)
        if declaration.get("deploy", False) is not False:
            fail(f"stack '{name}' must keep deploy = false; ResourceSync Apply is not workload deploy")
        config = declaration.get("config")
        if not isinstance(config, dict):
            fail(f"stack '{name}' has no [stack.config] table")
            continue
        missing = sorted(set(expected_config) - set(config))
        extra = sorted(set(config) - set(expected_config))
        if missing:
            fail(f"stack '{name}' is missing reviewed config keys: {missing}")
        if extra:
            fail(f"stack '{name}' has unreviewed config keys: {extra}")
        for key, expected in expected_config.items():
            if config.get(key) != expected:
                fail(f"stack '{name}': {key} must be {expected!r}, found {config.get(key)!r}")
        if config.get("webhook_enabled") is not False or config.get("auto_update") is not False:
            fail(f"stack '{name}' must never auto-deploy from webhook or image polling")
    # The Alibaba Stack deploy mutates the same host the Periphery lifecycle owns,
    # so the mutating Compose command must hold that host's existing deploy lock.
    asset = entries[ASSET_STACK_NAME]["config"]
    wrapper = asset.get("compose_cmd_wrapper")
    if not isinstance(wrapper, str) or not wrapper.strip():
        fail(f"stack '{ASSET_STACK_NAME}': compose_cmd_wrapper must hold the host lock "
             "across the mutating Compose command")
    else:
        if "[[COMPOSE_COMMAND]]" not in wrapper:
            fail(f"stack '{ASSET_STACK_NAME}': compose_cmd_wrapper must contain the "
                 "Komodo-required [[COMPOSE_COMMAND]] placeholder")
        if "flock" not in wrapper or "--nonblock" not in wrapper:
            fail(f"stack '{ASSET_STACK_NAME}': compose_cmd_wrapper must take a "
                 "non-blocking flock")
        lock_tokens = set(re.findall(r"[^\s'\"]+\.lock", wrapper))
        if lock_tokens != {ASSET_HOST_LOCK}:
            fail(f"stack '{ASSET_STACK_NAME}': compose_cmd_wrapper must lock only the "
                 f"existing host lock {ASSET_HOST_LOCK}, found {sorted(lock_tokens) or '[]'}")
    if asset.get("compose_cmd_wrapper_include") != ["up"]:
        fail(f"stack '{ASSET_STACK_NAME}': compose_cmd_wrapper_include must be exactly "
             "['up']; a pull must stay outside the host lock")


def main() -> int:
    parsed = load_files()
    by_type = check_resource_types(parsed)
    for table, entries in by_type.items():
        for name, declaration in entries.items():
            check_no_credentials(
                {key: value for key, value in declaration.items() if key != "_file"},
                f"{declaration['_file']}: {table} '{name}'",
            )
    check_resource_sync(by_type.get("resource_sync", {}))
    check_servers(by_type.get("server", {}))
    check_stacks(by_type.get("stack", {}))

    if failures:
        print("Declarative Komodo resource contract: FAIL", file=sys.stderr)
        for message in failures:
            print(f"  - {message}", file=sys.stderr)
        return 1
    declared = ", ".join(
        f"{table}={'+'.join(sorted(entries)) or '-'}" for table, entries in by_type.items()
    )
    print(f"Declarative Komodo resource contract: PASS ({declared})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
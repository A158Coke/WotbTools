#!/usr/bin/env python3
"""Keycloak migration: add a user attribute (default: region=CN) to every realm
user that does not already have it.

Idempotent and non-destructive by default:
  * users that already have the attribute are skipped (never overwritten);
  * the attribute is merged into the existing user representation, so other
    user attributes and fields are preserved;
  * dry-run is the default; pass --apply to write changes.

Auth uses the same client-credentials grant as the WotBTools backend
(KeycloakAdminUserService), so it works anywhere the admin client secret is
available (e.g. the VPS host with /opt/wotb/.env, or a local Keycloak):

  KEYCLOAK_ADMIN_SERVER_URL    default https://auth.wotbtools.com
  KEYCLOAK_ADMIN_REALM         default wotbtools
  KEYCLOAK_ADMIN_CLIENT_ID     default wotbtools-admin-api
  KEYCLOAK_ADMIN_CLIENT_SECRET required

Examples:
  python3 deploy/keycloak-add-region-attribute.py --dry-run
  python3 deploy/keycloak-add-region-attribute.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_SERVER_URL = "https://auth.wotbtools.com"
DEFAULT_REALM = "wotbtools"
DEFAULT_CLIENT_ID = "wotbtools-admin-api"
DEFAULT_ATTRIBUTE = "region"
DEFAULT_VALUE = "CN"
REQUEST_TIMEOUT_SECONDS = 30
PROGRESS_EVERY = 100


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--server-url",
        default=os.environ.get("KEYCLOAK_ADMIN_SERVER_URL") or DEFAULT_SERVER_URL,
    )
    parser.add_argument(
        "--realm",
        default=os.environ.get("KEYCLOAK_ADMIN_REALM") or DEFAULT_REALM,
    )
    parser.add_argument(
        "--client-id",
        default=os.environ.get("KEYCLOAK_ADMIN_CLIENT_ID") or DEFAULT_CLIENT_ID,
    )
    parser.add_argument(
        "--client-secret",
        default=os.environ.get("KEYCLOAK_ADMIN_CLIENT_SECRET"),
    )
    parser.add_argument("--attribute", default=DEFAULT_ATTRIBUTE)
    parser.add_argument("--value", default=DEFAULT_VALUE)
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument(
        "--max-users",
        type=int,
        default=0,
        help="only examine the first N users (for testing); 0 = all users",
    )
    parser.add_argument(
        "--list-limit",
        type=int,
        default=50,
        help="max usernames printed in dry-run output",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="also replace existing attribute values (default: skip such users)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write changes; the default is a dry run",
    )
    parser.add_argument("--dry-run", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: object | None = None,
    timeout: int = REQUEST_TIMEOUT_SECONDS,
) -> tuple[int, object | None]:
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            return resp.status, json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        snippet = exc.read(300).decode("utf-8", "replace")
        return exc.code, snippet
    except OSError as exc:
        fail(f"cannot reach Keycloak at {url}: {exc}")


def obtain_access_token(args: argparse.Namespace) -> str:
    if not args.client_secret:
        fail("KEYCLOAK_ADMIN_CLIENT_SECRET (or --client-secret) is required")
    endpoint = (
        f"{args.server_url.rstrip('/')}/realms/{args.realm}"
        "/protocol/openid-connect/token"
    )
    form = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": args.client_id,
            "client_secret": args.client_secret,
        }
    ).encode("utf-8")
    req = urllib.request.Request(endpoint, data=form, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        fail(f"token request failed (HTTP {exc.code})")
    except OSError as exc:
        fail(f"cannot reach Keycloak at {args.server_url}: {exc}")
    token = data.get("access_token") if isinstance(data, dict) else None
    if not token:
        fail("token response did not contain access_token")
    return token


def list_users(
    args: argparse.Namespace, token: str, first: int, page_size: int
) -> list[dict]:
    url = (
        f"{args.server_url.rstrip('/')}/admin/realms/{args.realm}/users"
        f"?first={first}&max={page_size}"
    )
    status, data = request_json(
        url, headers={"Authorization": f"Bearer {token}"}
    )
    if status != 200 or not isinstance(data, list):
        fail(f"list users failed (HTTP {status}): {str(data)[:300]}")
    return data


def get_user(args: argparse.Namespace, token: str, user_id: str) -> dict:
    url = f"{args.server_url.rstrip('/')}/admin/realms/{args.realm}/users/{user_id}"
    status, data = request_json(url, headers={"Authorization": f"Bearer {token}"})
    if status != 200 or not isinstance(data, dict):
        fail(f"read user {user_id} failed (HTTP {status}): {str(data)[:300]}")
    return data


def update_user(
    args: argparse.Namespace, token: str, user_id: str, user: dict
) -> None:
    url = f"{args.server_url.rstrip('/')}/admin/realms/{args.realm}/users/{user_id}"
    status, data = request_json(
        url,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        payload=user,
    )
    if status not in (200, 204):
        fail(f"update user {user_id} failed (HTTP {status}): {str(data)[:300]}")


def main() -> None:
    args = parse_args()
    if args.dry_run:
        args.apply = False
    token = obtain_access_token(args)

    total = 0
    already = 0
    missing = 0
    replaced = 0
    updated = 0
    to_update: list[str] = []
    first = 0

    while True:
        if args.max_users and total >= args.max_users:
            break
        page = list_users(args, token, first, args.page_size)
        if not page:
            break
        for item in page:
            if args.max_users and total >= args.max_users:
                break
            total += 1
            user_id = item.get("id")
            username = item.get("username") or user_id or "?"
            if total % PROGRESS_EVERY == 0:
                print(f"  ... examined {total} users", file=sys.stderr)

            full = get_user(args, token, user_id)
            attributes = full.get("attributes") or {}
            current = attributes.get(args.attribute)
            has_value = bool(current)

            if has_value and not args.overwrite:
                already += 1
                continue
            if has_value:
                replaced += 1
            else:
                missing += 1
            to_update.append(username)

            if args.apply:
                attributes[args.attribute] = [args.value]
                full["attributes"] = attributes
                update_user(args, token, user_id, full)
                updated += 1
        first += args.page_size
        if len(page) < args.page_size:
            break

    mode = "APPLY" if args.apply else "DRY-RUN (no changes written)"
    print(f"[{mode}] attribute={args.attribute} value={args.value} realm={args.realm}")
    print(f"  total examined : {total}")
    print(f"  already set    : {already}")
    print(f"  missing        : {missing}")
    if args.overwrite:
        print(f"  replaced       : {replaced}")
    if args.apply:
        print(f"  updated        : {updated}")
    else:
        print(f"  would update   : {len(to_update)}")

    if not args.apply and to_update:
        shown = to_update[: args.list_limit]
        for name in shown:
            print(f"    - {name}")
        if len(to_update) > len(shown):
            print(f"    ... and {len(to_update) - len(shown)} more")


if __name__ == "__main__":
    main()

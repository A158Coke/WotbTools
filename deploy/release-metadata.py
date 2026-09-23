#!/usr/bin/env python3
"""Strict production release identity for the two deployment hosts."""

import argparse
import datetime
import json
import os
import re
import stat
import sys
import tempfile


OWNERS = {
    "tx": {"business-api", "frontend", "keycloak"},
    "yecao": {"parser-worker", "minio"},
}
SHA = re.compile(r"[0-9a-f]{40}\Z")
TIME = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\Z")
TX_PREFIX = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+tencentyun\.com/[a-z0-9][a-z0-9._-]*\Z")


def fail(message):
    raise ValueError(message)


def valid_sha(value, label):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        fail(f"invalid {label}")


def repository(host, service, tx_prefix):
    if host == "tx":
        if not TX_PREFIX.fullmatch(tx_prefix or ""):
            fail("invalid TX registry namespace")
        return f"{tx_prefix}/wotbtools-{service}"
    return f"ghcr.io/a158coke/wotbtools-{service}"


def valid_image(image, host, service, tx_prefix):
    if not isinstance(image, dict) or set(image) != {"tag", "commitSha"}:
        fail(f"invalid image identity for {service}")
    valid_sha(image["commitSha"], f"image commit SHA for {service}")
    expected = f'{repository(host, service, tx_prefix)}:sha-{image["commitSha"][:12]}'
    if image["tag"] != expected:
        fail(f"invalid registry, repository or immutable tag for {service}")


def load(path, host, tx_prefix):
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
        if mode & 0o077:
            fail("production metadata permissions must be 0600 or stricter")
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"production metadata is unavailable or invalid: {exc}")
    if not isinstance(data, dict) or set(data) != {"schemaVersion", "services"} or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 2:
        fail("production metadata must use schemaVersion 2")
    services = data["services"]
    if not isinstance(services, dict) or not set(services) <= OWNERS[host]:
        fail("production metadata contains invalid service ownership")
    for service, entry in services.items():
        if not isinstance(entry, dict) or set(entry) != {"configSha", "image", "deployedAt"}:
            fail(f"invalid metadata entry for {service}")
        valid_sha(entry["configSha"], f"config SHA for {service}")
        if not isinstance(entry["deployedAt"], str) or not TIME.fullmatch(entry["deployedAt"]):
            fail(f"invalid deployment time for {service}")
        try:
            datetime.datetime.strptime(entry["deployedAt"], "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            fail(f"invalid deployment time for {service}")
        valid_image(entry["image"], host, service, tx_prefix)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "get", "update"))
    parser.add_argument("--file", required=True)
    parser.add_argument("--host", choices=OWNERS, required=True)
    parser.add_argument("--service")
    parser.add_argument("--field", choices=("tag", "commitSha", "configSha"))
    parser.add_argument("--config-sha")
    parser.add_argument("--image-tag")
    parser.add_argument("--image-commit-sha")
    parser.add_argument("--tx-prefix", default="")
    args = parser.parse_args()
    if args.service and args.service not in OWNERS[args.host]:
        fail("service does not belong to metadata host")
    data = load(args.file, args.host, args.tx_prefix)
    if args.action == "validate":
        if args.image_tag or args.image_commit_sha:
            if not args.service or not args.image_tag or not args.image_commit_sha:
                fail("service, image tag and source SHA are required together")
            valid_image({"tag": args.image_tag, "commitSha": args.image_commit_sha}, args.host, args.service, args.tx_prefix)
        return
    if not args.service:
        fail("service is required")
    entry = data["services"].get(args.service)
    if args.action == "get":
        if not entry:
            fail(f"production metadata has no identity for {args.service}")
        if args.field == "tag":
            print(entry["image"]["tag"])
        elif args.field == "commitSha":
            print(entry["image"]["commitSha"])
        elif args.field == "configSha":
            print(entry["configSha"])
        else:
            fail("field is required for get")
        return
    valid_sha(args.config_sha, "deployment config SHA")
    if bool(args.image_tag) != bool(args.image_commit_sha):
        fail("image tag and source SHA must be supplied together")
    if args.image_tag:
        image = {"tag": args.image_tag, "commitSha": args.image_commit_sha}
        valid_image(image, args.host, args.service, args.tx_prefix)
    elif entry:
        image = entry["image"]
    else:
        fail(f"production metadata has no identity for config-only {args.service}")
    data["services"][args.service] = {
        "configSha": args.config_sha,
        "image": image,
        "deployedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    directory = os.path.dirname(os.path.abspath(args.file))
    descriptor, temporary = tempfile.mkstemp(prefix=".production-release.", dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, args.file)
        parent = os.open(directory, os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

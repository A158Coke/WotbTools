"""Offline COS -> OSS reconciliation for Business image ledgers. No application imports."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
from uuid import UUID, uuid4

from stores import PublicAccessBlockRequired, configuration, open_stores

LIMITS = {"cover": 10 * 1024 * 1024, "avatar": 512 * 1024}
SCHEMA = """
CREATE TABLE run (id TEXT, started TEXT, topology TEXT);
CREATE TABLE image (
    namespace TEXT, id TEXT, object_key TEXT, status TEXT, content_type TEXT, size INTEGER,
    hash TEXT, refs INTEGER, owner_ok INTEGER, consumer TEXT,
    result TEXT NOT NULL DEFAULT 'unchecked', attempts INTEGER NOT NULL DEFAULT 0,
    write_attempted INTEGER NOT NULL DEFAULT 0, created_by_run INTEGER NOT NULL DEFAULT 0,
    source_hash TEXT, source_size INTEGER, target_hash TEXT, target_size INTEGER,
    UNIQUE(namespace, id)
);
CREATE INDEX image_key ON image(namespace, object_key);
CREATE TABLE inventory (side TEXT, namespace TEXT, object_key TEXT,
                        PRIMARY KEY(side, namespace, object_key)) WITHOUT ROWID;
"""


def ledger():
    import psycopg

    query = Path(__file__).with_name("ledger.sql").read_text(encoding="utf-8")
    # libpq uses PG* environment variables / service files. No DSN on the command line.
    with psycopg.connect() as pg:
        pg.read_only = True
        with pg.cursor(name="business_image_snapshot") as rows:
            rows.execute(query)
            yield from rows


def inventory_keys(topology, source, target):
    for side, store in (("source", source), ("target", target)):
        for ns, prefix in topology["prefixes"].items():
            for key in store.keys(prefix):
                yield side, ns, key


def snapshot(db, topology, rows, source, target):
    started = datetime.now(timezone.utc).isoformat()
    db.executescript(SCHEMA)
    with db:
        db.executemany("""INSERT INTO image(namespace,id,object_key,status,content_type,size,hash,
                          refs,owner_ok,consumer) VALUES(?,?,?,?,?,?,?,?,?,?)""", rows)
        db.executemany("INSERT INTO inventory VALUES(?,?,?)", inventory_keys(topology, source, target))
        # Only a complete snapshot gets an identity and can be processed.
        db.execute("INSERT INTO run VALUES(?,?,?)", (str(uuid4()), started,
                                                    json.dumps(topology, sort_keys=True)))


def valid_row(row, prefix):
    try:
        canonical = str(UUID(row["id"]))
    except ValueError:
        return False
    return (canonical == row["id"] and row["object_key"] == prefix + canonical
            and row["status"] in ("READY", "PENDING") and row["owner_ok"]
            and (row["status"] == "READY" or not row["refs"])
            and 0 < row["size"] <= LIMITS[row["namespace"]]
            and row["content_type"] in ("image/png", "image/jpeg")
            and bool(re.fullmatch(r"[a-f0-9]{64}", row["hash"])))


def check_object(store, row, evidence, side):
    obj = store.get(row["object_key"], row["size"] + 1)
    if obj is None:
        return "missing", None
    mime, body = obj
    if len(body) > row["size"]:
        return "conflict", None  # Bounded GET; a partial digest is not an object hash.
    digest = hashlib.sha256(body).hexdigest()
    evidence[side + "_hash"] = digest
    evidence[side + "_size"] = len(body)
    signature = b"\x89PNG\r\n\x1a\n" if row["content_type"] == "image/png" else b"\xff\xd8\xff"
    if (len(body), digest, mime) != (row["size"], row["hash"], row["content_type"]) or not body.startswith(signature):
        return "conflict", None
    return "match", body


def reconcile(db, row, prefix, source, target, copy, evidence):
    if not valid_row(row, prefix):
        return "invalid_ledger"
    src, body = check_object(source, row, evidence, "source")
    if src == "conflict":
        return "source_conflict"
    if src == "missing" and row["status"] == "READY":
        return "source_missing_ready"
    dst, _ = check_object(target, row, evidence, "target")
    if src == "missing":
        return "pending_absent" if dst == "missing" else "target_without_source"
    if dst == "conflict":
        return "target_conflict"
    if dst == "missing":
        if not copy:
            return "target_missing"
        # Persist intent before the request: a lost response must not imply ownership.
        with db:
            db.execute("UPDATE image SET write_attempted=1 WHERE rowid=?", (row["rowid"],))
        if target.create(row["object_key"], row["content_type"], body):
            with db:
                db.execute("UPDATE image SET created_by_run=1 WHERE rowid=?", (row["rowid"],))
        else:
            # A competing writer chose the object's ACL. Re-check the bucket safeguard.
            target.require_public_access_block()
        dst, _ = check_object(target, row, evidence, "target")
        if dst != "match":
            return "target_" + dst
    return "verified"


def process(db, topology, source, target, copy, limit):
    run = db.execute("SELECT topology FROM run").fetchone()
    if not run or json.loads(run[0]) != topology:
        raise ValueError("Incomplete snapshot or different storage configuration")
    target.require_public_access_block()
    if copy:
        target.check_destination()
    # Freeze the work list before updating attempts/results. A first-row failure must
    # not starve later rows in repeated bounded batches. Verify always re-reads both stores.
    db.execute("DROP TABLE IF EXISTS temp.queue")
    db.execute("""CREATE TEMP TABLE queue AS SELECT rowid AS image_id FROM image
                  WHERE NOT ? OR result NOT IN ('verified','pending_absent')
                  ORDER BY attempts,rowid LIMIT ?""", (copy, limit or -1))
    for entry in db.execute("SELECT image_id FROM queue ORDER BY rowid"):
        row = db.execute("SELECT rowid,* FROM image WHERE rowid=?", (entry[0],)).fetchone()
        evidence = dict.fromkeys(("source_hash", "source_size", "target_hash", "target_size"))
        try:
            result = reconcile(db, row, topology["prefixes"][row["namespace"]],
                               source, target, copy, evidence)
        except Exception as exc:
            # SDK exception text can contain signed URLs or headers.
            result = "error_" + type(exc).__name__
        with db:
            db.execute("""UPDATE image SET result=:result, attempts=attempts+1,
                          source_hash=:source_hash,source_size=:source_size,
                          target_hash=:target_hash,target_size=:target_size WHERE rowid=:id""",
                       {**evidence, "result": result, "id": row["rowid"]})


def verify_inventory(db, topology, source, target):
    # Publish the new listing only after all four prefix scans and the privacy check succeed.
    with db:
        db.execute("CREATE TABLE IF NOT EXISTS verify_inventory AS SELECT * FROM inventory WHERE 0")
        db.execute("DELETE FROM verify_inventory")
        db.executemany("INSERT INTO verify_inventory VALUES(?,?,?)", inventory_keys(topology, source, target))
        target.require_public_access_block()


def summary(db, fresh_inventory=False):
    groups = [dict(row) for row in db.execute("""SELECT namespace,status,consumer,result,
              count(*) AS count,sum(size) AS ledger_bytes FROM image
              GROUP BY namespace,status,consumer,result ORDER BY namespace,status,consumer,result""")]
    table = "verify_inventory" if fresh_inventory else "inventory"
    new_count = "" if not fresh_inventory else """, count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM inventory s WHERE (s.side,s.namespace,s.object_key) =
              (i.side,i.namespace,i.object_key))) AS new_since_snapshot"""
    extras = [dict(row) for row in db.execute(f"""SELECT side,namespace,count(*) AS count {new_count} FROM {table} i
              WHERE NOT EXISTS (SELECT 1 FROM image l WHERE l.namespace=i.namespace
                                AND l.object_key=i.object_key) GROUP BY side,namespace""")]
    print(json.dumps({"snapshot": db.execute("SELECT id FROM run").fetchone()[0],
                      "ledger": groups, "untracked_objects": extras}, ensure_ascii=False))
    return int(bool(extras or any(g["result"] not in ("verified", "pending_absent") for g in groups)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("snapshot", "verify", "copy"))
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--limit", type=int, help="maximum ledger rows processed in this invocation")
    args = parser.parse_args(argv)
    if args.limit is not None and (args.limit < 1 or args.action != "copy"):
        parser.error("--limit requires copy and a positive row count")
    topology = configuration()
    source, target = open_stores(topology)
    if args.action == "snapshot":
        # Refuse to replace a previous audit trail, even if the earlier scan failed.
        fd = os.open(args.manifest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    with closing(sqlite3.connect(args.manifest.resolve().as_uri() + "?mode=rw", uri=True)) as db:
        db.row_factory = sqlite3.Row
        # Keep this worker's file lock across the individual durable checkpoints.
        db.execute("PRAGMA locking_mode=EXCLUSIVE")
        db.execute("BEGIN EXCLUSIVE")
        db.commit()
        if args.action == "snapshot":
            snapshot(db, topology, ledger(), source, target)
            summary(db)
            return 0
        process(db, topology, source, target, args.action == "copy", args.limit)
        if args.action == "verify":
            verify_inventory(db, topology, source, target)
            return summary(db, fresh_inventory=True)
        target.require_public_access_block()
        return summary(db)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        sys.exit(main())
    except PublicAccessBlockRequired as exc:
        sys.exit(str(exc))
    except Exception as exc:
        sys.exit("Snapshot/operation incomplete (" + type(exc).__name__ + ")")

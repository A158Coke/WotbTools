#!/usr/bin/env python3
"""Remove retired WARGAMING_API Hundred submissions safely.

The command is deliberately read-only unless both --apply and the exact
confirmation token are supplied.  PostgreSQL access uses psycopg (v3 or v2)
when run in the operations environment; no database credentials are stored in
the repository.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


SOURCE = "WARGAMING_API"
MANUAL = "MANUAL"
CONFIRMATION = "REMOVE-HUNDRED-WG-DATA"
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
MANIFEST_VERSION = 1
MANIFEST_KEYS = frozenset({"version", "source", "replay_dir", "hashes"})


@dataclass(frozen=True)
class Baseline:
    manual_by_status: tuple[tuple[str, int], ...]
    hall_of_fame_rows: int


@dataclass(frozen=True)
class Report:
    source_by_status: tuple[tuple[str, int], ...]
    submission_count: int
    evidence_count: int
    candidate_hashes: int
    preserved_hashes: int = 0
    deletable_hashes: int = 0
    deleted_files: int = 0
    missing_files: int = 0


class Database:
    """Small DB-API wrapper with a PostgreSQL placeholder-independent API."""

    def __init__(self, connection: Any):
        self.connection = connection

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[tuple[Any, ...]]:
        cursor = self.connection.cursor()
        try:
            cursor.execute(sql, tuple(params))
            return list(cursor.fetchall())
        finally:
            cursor.close()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        cursor = self.connection.cursor()
        try:
            cursor.execute(sql, tuple(params))
            return cursor.rowcount
        finally:
            cursor.close()


def load_connection(dsn: str) -> Any:
    try:
        import psycopg  # type: ignore

        return psycopg.connect(dsn)
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return psycopg2.connect(dsn)
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 in the operations environment") from exc


def placeholders(values: list[int]) -> str:
    if not values:
        raise ValueError("empty identifier list")
    return ",".join("%s" for _ in values)


def read_baseline(db: Database) -> Baseline:
    manual = db.query(
        "SELECT status, COUNT(*) FROM hundred_battle_submission "
        "WHERE verification_source = %s GROUP BY status ORDER BY status",
        (MANUAL,),
    )
    hof = db.query("SELECT COUNT(*) FROM hall_of_fame_record")[0][0]
    return Baseline(tuple((str(status), int(count)) for status, count in manual), int(hof))


def inspect(db: Database) -> tuple[Report, Baseline, list[int], set[str]]:
    baseline = read_baseline(db)
    source_by_status = db.query(
        "SELECT status, COUNT(*) FROM hundred_battle_submission "
        "WHERE verification_source = %s GROUP BY status ORDER BY status",
        (SOURCE,),
    )
    ids = [int(row[0]) for row in db.query(
        "SELECT id FROM hundred_battle_submission WHERE verification_source = %s ORDER BY id",
        (SOURCE,),
    )]
    hashes: set[str] = set()
    if ids:
        marks = placeholders(ids)
        rows = db.query(
            f"SELECT sha256 FROM hundred_battle_replay_evidence WHERE submission_id IN ({marks})",
            ids,
        )
        hashes = {str(row[0]) for row in rows if HASH_RE.fullmatch(str(row[0]))}
        evidence_count = len(rows)
    else:
        evidence_count = 0
    report = Report(
        tuple((str(status), int(count)) for status, count in source_by_status),
        sum(int(count) for _, count in source_by_status),
        evidence_count,
        len(hashes),
    )
    return report, baseline, ids, hashes


def print_report(report: Report, dry_run: bool) -> None:
    mode = "DRY-RUN" if dry_run else "APPLY"
    print(f"Cleanup mode: {mode}")
    print(f"WARGAMING_API submissions: {report.submission_count}")
    print(f"WARGAMING_API evidence rows: {report.evidence_count}")
    print(f"candidate shared replay hashes: {report.candidate_hashes}")
    for status, count in report.source_by_status:
        print(f"  status={status}: {count}")
    if dry_run:
        print("would delete: WARGAMING_API evidence and submissions after transaction checks")
        print("would preserve: hashes still referenced by MANUAL evidence or Hall of Fame")
    else:
        print(f"preserved shared hashes: {report.preserved_hashes}")
        print(f"deletable shared hashes: {report.deletable_hashes}")
        print(f"deleted replay files: {report.deleted_files}")
        print(f"missing replay files (already absent): {report.missing_files}")


def delete_rows(db: Database, ids: list[int]) -> None:
    if not ids:
        return
    marks = placeholders(ids)
    # V19 owns the FK from evidence to submission: child rows first.
    db.execute(f"DELETE FROM hundred_battle_replay_evidence WHERE submission_id IN ({marks})", ids)
    db.execute(
        f"DELETE FROM hundred_battle_submission WHERE id IN ({marks}) AND verification_source = %s",
        [*ids, SOURCE],
    )


def referenced_hashes(db: Database, hashes: set[str], excluded_submission_ids: Iterable[int] = ()) -> set[str]:
    if not hashes:
        return set()
    values = sorted(hashes)
    marks = ",".join("%s" for _ in values)
    excluded_ids = sorted({int(value) for value in excluded_submission_ids})
    evidence_sql = f"SELECT sha256 FROM hundred_battle_replay_evidence WHERE sha256 IN ({marks})"
    evidence_params: list[Any] = list(values)
    if excluded_ids:
        excluded_marks = ",".join("%s" for _ in excluded_ids)
        evidence_sql += f" AND submission_id NOT IN ({excluded_marks})"
        evidence_params.extend(excluded_ids)
    referenced = set(str(row[0]) for row in db.query(
        evidence_sql,
        evidence_params,
    ))
    referenced.update(str(row[0]) for row in db.query(
        f"SELECT replay_hash FROM hall_of_fame_record WHERE replay_hash IN ({marks})",
        values,
    ))
    return referenced


def remove_unreferenced_files(db: Database, replay_dir: Path, hashes: set[str]) -> tuple[int, int, int, int]:
    preserved = referenced_hashes(db, hashes)
    deletable = hashes - preserved
    deleted = 0
    missing = 0
    for digest in sorted(deletable):
        if not HASH_RE.fullmatch(digest):
            raise RuntimeError("unexpected replay hash returned by database")
        path = replay_dir / f"{digest}.wotbreplay"
        if path.exists():
            if not path.is_file():
                raise RuntimeError(f"replay path is not a regular file: {path}")
            path.unlink()
            deleted += 1
        else:
            missing += 1
    return len(preserved), len(deletable), deleted, missing


def load_manifest(path: Path, replay_dir: Path) -> set[str]:
    """Load the resumable replay deletion set without accepting user data fields."""
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid cleanup manifest: {path}") from exc
    if not isinstance(payload, dict) or set(payload) != MANIFEST_KEYS:
        raise RuntimeError("cleanup manifest contains unexpected fields")
    if payload["version"] != MANIFEST_VERSION or payload["source"] != SOURCE:
        raise RuntimeError("cleanup manifest version or source is invalid")
    if payload["replay_dir"] != str(replay_dir.resolve()):
        raise RuntimeError("cleanup manifest replay directory does not match --replay-dir")
    hashes = payload["hashes"]
    if not isinstance(hashes, list) or any(not isinstance(value, str) or not HASH_RE.fullmatch(value)
                                           for value in hashes):
        raise RuntimeError("cleanup manifest contains an invalid replay hash")
    return set(hashes)


def save_manifest(path: Path, replay_dir: Path, hashes: set[str]) -> None:
    """Atomically persist only the replay hashes needed for a later retry."""
    if any(not HASH_RE.fullmatch(value) for value in hashes):
        raise RuntimeError("refusing to persist an invalid replay hash")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                        prefix=f".{path.name}.", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump({
                "hashes": sorted(hashes),
                "replay_dir": str(replay_dir.resolve()),
                "source": SOURCE,
                "version": MANIFEST_VERSION,
            }, handle, indent=2, sort_keys=True)
            handle.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def verify(db: Database, baseline: Baseline) -> None:
    remaining_source = db.query(
        "SELECT COUNT(*) FROM hundred_battle_submission WHERE verification_source = %s",
        (SOURCE,),
    )[0][0]
    remaining_evidence = db.query(
        "SELECT COUNT(*) FROM hundred_battle_replay_evidence e "
        "JOIN hundred_battle_submission s ON s.id = e.submission_id "
        "WHERE s.verification_source = %s",
        (SOURCE,),
    )[0][0]
    snapshots = db.query(
        "SELECT COUNT(*) FROM hundred_battle_submission WHERE "
        "official_account_battle_count IS NOT NULL OR official_tank_battle_count IS NOT NULL "
        "OR official_tank_damage_dealt IS NOT NULL OR official_average_damage IS NOT NULL "
        "OR verified_at IS NOT NULL OR verified_server IS NOT NULL"
    )[0][0]
    manual_rows = db.query(
        "SELECT status, COUNT(*) FROM hundred_battle_submission "
        "WHERE verification_source = %s GROUP BY status ORDER BY status",
        (MANUAL,),
    )
    hof_rows = int(db.query("SELECT COUNT(*) FROM hall_of_fame_record")[0][0])
    current_manual = tuple((str(status), int(count)) for status, count in manual_rows)
    if int(remaining_source) or int(remaining_evidence) or int(snapshots):
        raise RuntimeError("Cleanup verification: FAIL (WG rows, evidence, or snapshots remain)")
    if current_manual != baseline.manual_by_status or hof_rows != baseline.hall_of_fame_rows:
        raise RuntimeError("Cleanup verification: FAIL (MANUAL or Hall of Fame baseline changed)")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=os.environ.get("WOTB_DATABASE_URL") or os.environ.get("DATABASE_URL"),
                        help="PostgreSQL DSN (default: WOTB_DATABASE_URL or DATABASE_URL)")
    parser.add_argument("--replay-dir", type=Path,
                        default=Path(os.environ["HOF_REPLAY_DIR"]) if os.environ.get("HOF_REPLAY_DIR") else None)
    parser.add_argument("--manifest", type=Path,
                        help="resumable deletion manifest (default: <replay-dir>/.cleanup-hundred-wargaming-api.json)")
    parser.add_argument("--apply", action="store_true", help="perform deletion after confirmation")
    parser.add_argument("--confirm", help=f"must equal {CONFIRMATION}")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.apply and args.confirm != CONFIRMATION:
        print("Refusing apply: --apply requires the exact --confirm token", file=sys.stderr)
        return 2
    if not args.dsn:
        print("Missing --dsn (or WOTB_DATABASE_URL/DATABASE_URL); no changes made", file=sys.stderr)
        return 2
    if args.apply and args.replay_dir is None:
        print("Missing --replay-dir (or HOF_REPLAY_DIR); no changes made", file=sys.stderr)
        return 2

    replay_dir = args.replay_dir.resolve() if args.apply else None
    manifest_path = args.manifest.resolve() if args.manifest else (
        replay_dir / ".cleanup-hundred-wargaming-api.json" if replay_dir else None)
    connection = None
    try:
        connection = load_connection(args.dsn)
        db = Database(connection)
        report, baseline, ids, hashes = inspect(db)
        if not args.apply:
            print_report(report, True)
            return 0
        pending_manifest_hashes = load_manifest(manifest_path, replay_dir)
        candidate_hashes = hashes | pending_manifest_hashes
        # Calculate the protected set before deleting DB evidence, then checkpoint
        # only the hashes that may need filesystem removal before the transaction.
        deletion_hashes = candidate_hashes - referenced_hashes(db, candidate_hashes, ids)
        save_manifest(manifest_path, replay_dir, deletion_hashes)
        delete_rows(db, ids)
        if ids:
            connection.commit()
        preserved, deletable, deleted, missing = remove_unreferenced_files(
            db, replay_dir, deletion_hashes)
        verify(db, baseline)
        result = Report(report.source_by_status, report.submission_count, report.evidence_count,
                        len(candidate_hashes), preserved, deletable, deleted, missing)
        print_report(result, False)
        manifest_path.unlink()
        print("Cleanup verification: PASS")
        return 0
    except Exception as exc:  # operational tool: fail closed and non-zero
        if connection is not None:
            try:
                connection.rollback()
            except Exception:
                pass
        print(f"Cleanup verification: FAIL ({exc})", file=sys.stderr)
        return 1
    finally:
        if connection is not None:
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())

"""Exercise the live ledger query using the repository migrations in a disposable PostgreSQL."""
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
import precopy


class LedgerTest(unittest.TestCase):
    def test_live_and_unattached_images(self):
        import pgserver  # test-only dependency, documented in the operations guide

        pg = pgserver.get_server(tempfile.mkdtemp(), cleanup_mode="delete")
        self.addCleanup(pg.cleanup)
        connection = psycopg.conninfo.conninfo_to_dict(pg.get_uri())
        # Never inherit a developer's default database/service for this fixture.
        settings = {"PGHOST": connection["host"], "PGPORT": connection.get("port", "5432"),
                    "PGUSER": connection["user"], "PGDATABASE": connection["dbname"]}
        migrations = (Path(__file__).resolve().parents[2] /
                      "java/wotb-web/src/main/resources/db/migration")
        ids = [str(uuid4()) for _ in range(6)]
        digest = hashlib.sha256(b"x").hexdigest()
        with patch.dict(os.environ, settings, clear=True):
            with psycopg.connect() as db:
                for version in ("V33", "V35", "V37"):
                    db.execute(next(migrations.glob(version + "__*.sql")).read_text(encoding="utf-8"))
                db.execute("""INSERT INTO tournament_broadcast_season(server,year,name,created_at)
                              VALUES ('CN',2026,'A',now()), ('EU',2026,'B',now())""")
                db.execute("INSERT INTO tournament_broadcast_category(season_id,type) VALUES (1,'POINTS')")
                db.execute("INSERT INTO tournament_broadcast_node(category_id,root_key) VALUES (1,0)")
                for season, uid in enumerate(ids[:2], 1):
                    db.execute("""INSERT INTO tournament_broadcast_cover
                               (id,season_id,object_key,status,content_type,size,hash,created_at)
                               VALUES (%s,%s,%s,'READY','image/png',1,%s,now())""",
                               (uid, season, "covers/" + uid, digest))
                    db.execute("""INSERT INTO tournament_broadcast_replay
                               (node_id,title,url,match_date,day_number,teams,perspective,cover_id,created_at)
                               VALUES (1,'test','url',current_date,1,'[1,2]','POV',%s,now())""", (uid,))
                for i, uid in enumerate(ids[2:]):
                    status = "PENDING" if i == 3 else "READY"
                    db.execute("""INSERT INTO creator_avatar(id,object_key,status,content_type,size,hash,created_at)
                                  VALUES (%s,%s,%s,'image/png',1,%s,now()-interval '48 hours')""",
                               (uid, "avatars/" + uid, status, digest))
                db.execute("""INSERT INTO creator(type,bilibili_uid,name,avatar_id,created_at)
                              VALUES ('UP','123','UP',%s,now()),('VIDEO','BV0123456789','VIDEO',%s,now())""",
                           (ids[2], ids[3]))
            rows = {row[1]: row for row in precopy.ledger()}
        self.assertEqual(set(rows), set(ids))
        self.assertEqual(rows[ids[0]][7:], (1, True, "BROADCAST"))
        self.assertEqual(rows[ids[1]][7:], (1, False, "BROADCAST"))
        self.assertEqual(rows[ids[2]][7:], (1, True, "UP"))
        self.assertEqual(rows[ids[3]][7:], (1, True, "VIDEO"))
        self.assertEqual(rows[ids[4]][3], "READY")
        self.assertEqual(rows[ids[4]][7:], (0, True, None))
        self.assertEqual(rows[ids[5]][3], "PENDING")


if __name__ == "__main__":
    unittest.main()

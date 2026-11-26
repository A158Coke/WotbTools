from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest
from urllib.parse import parse_qs, urlsplit

import oss2
from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosServiceError

from stores import CosSource, OssTarget


class StorageFixture(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, body, status=200, mime="application/xml"):
        self.send_response(status)
        self.send_header("content-type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, code, status):
        self.reply(f"<Error><Code>{code}</Code><Message>fixture</Message>"
                   f"<Resource>/covers/key</Resource><RequestId>test</RequestId></Error>".encode(), status)

    def do_GET(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query, keep_blank_values=True)
        if "acl" in query:
            self.reply(f"<AccessControlPolicy><AccessControlList><Grant>{self.server.acl}</Grant>"
                       "</AccessControlList></AccessControlPolicy>".encode())
        elif "versioning" in query:
            self.reply(f"<VersioningConfiguration>{self.server.version}</VersioningConfiguration>".encode())
        elif "prefix" in query:
            second = bool(query.get("marker", [""])[0] or query.get("continuation-token", [""])[0])
            key = query["prefix"][0] + ("b" if second else "a")
            marker = "" if second else f"<NextMarker>{key}</NextMarker><NextContinuationToken>p2</NextContinuationToken>"
            self.reply(f"""<ListBucketResult><IsTruncated>{str(not second).lower()}</IsTruncated>{marker}
                <Contents><Key>{key}</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified>
                <ETag>etag</ETag><Type>Normal</Type><Size>5</Size><StorageClass>Standard</StorageClass>
                </Contents></ListBucketResult>""".encode())
        elif url.path.endswith("denied"):
            self.fail("AccessDenied", 403)
        elif url.path.endswith("wrong-bucket"):
            self.fail("NoSuchBucket", 404)
        elif url.path.endswith("absent"):
            self.fail("NoSuchKey", 404)
        else:
            self.reply(b"12345678", mime="image/png")

    def do_PUT(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.received.append((self.headers["x-oss-forbid-overwrite"],
                                     self.headers["x-oss-object-acl"], self.headers["Content-Type"], body))
        if len(self.server.received) > 1:
            self.fail("FileAlreadyExists", 409)
        else:
            self.reply(b"")


class StoreProtocolTest(unittest.TestCase):
    def setUp(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), StorageFixture)
        server.received = []
        server.acl = "private"
        server.version = ""
        self.addCleanup(server.server_close)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        self.server = server
        port = server.server_port
        client = CosS3Client(CosConfig(Region="ap-shanghai", SecretId="fixture", SecretKey="fixture",
                                        IP="127.0.0.1", Port=port, Scheme="http"))
        self.source = CosSource(client, "fixture-123456")
        bucket = oss2.Bucket(oss2.Auth("fixture", "fixture"), f"http://127.0.0.1:{port}",
                             "fixture", is_cname=True)
        self.target = OssTarget(bucket)

    def test_real_sdk_pagination_reads_and_precise_404(self):
        for store in (self.source, self.target):
            with self.subTest(store=type(store).__name__):
                self.assertEqual(list(store.keys("covers/")), ["covers/a", "covers/b"])
                self.assertEqual(store.get("covers/image", 4), ("image/png", b"1234"))
                self.assertIsNone(store.get("covers/absent", 4))
                for key in ("denied", "wrong-bucket"):
                    with self.assertRaises((CosServiceError, oss2.exceptions.ServerError)):
                        store.get("covers/" + key, 4)

    def test_conditional_private_put_and_collision(self):
        self.assertTrue(self.target.create("covers/example", "image/png", b"first"))
        self.assertFalse(self.target.create("covers/example", "image/png", b"second"))
        self.assertEqual(self.server.received[0], ("true", "private", "image/png", b"first"))

    def test_copy_requires_private_unversioned_destination(self):
        self.target.check_destination()
        for status in ("Enabled", "Suspended"):
            self.server.version = f"<Status>{status}</Status>"
            with self.assertRaises(ValueError):
                self.target.check_destination()
        self.server.version = ""
        self.server.acl = "public-read"
        with self.assertRaises(ValueError):
            self.target.check_destination()


if __name__ == "__main__":
    unittest.main()

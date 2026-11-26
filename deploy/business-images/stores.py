"""Migration-only SDK bindings. Source has no write operation; target has no delete."""
from contextlib import closing
import os
import re

import oss2
from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosServiceError


def configuration():
    env = os.environ
    prefixes = {"cover": env.get("BROADCAST_COS_PREFIX") or "league-broadcasts/covers/",
                "avatar": env.get("CREATOR_AVATAR_COS_PREFIX") or "creator-avatars/"}
    for prefix in prefixes.values():
        if not re.fullmatch(r"[a-z0-9][a-z0-9/_-]{0,180}/", prefix) or "//" in prefix:
            raise ValueError("Invalid Business namespace")
    if prefixes["cover"].startswith(prefixes["avatar"]) or prefixes["avatar"].startswith(prefixes["cover"]):
        raise ValueError("Overlapping Business namespaces")
    config = {"prefixes": prefixes}
    for name, pattern in (("COS_BUCKET", r"[a-z0-9][a-z0-9-]{1,49}-[0-9]{5,20}"),
                          ("OSS_BUCKET", r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]"),
                          ("COS_REGION", r"[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*"),
                          ("OSS_REGION", r"[a-z0-9]+(?:-[a-z0-9]+)+")):
        value = env["MIGRATION_" + name]
        if not re.fullmatch(pattern, value):
            raise ValueError("Invalid storage configuration: " + name)
        config[name] = value
    return config


def open_stores(config):
    env = os.environ
    cos = CosS3Client(CosConfig(Region=config["COS_REGION"], Scheme="https", Timeout=15,
                                SecretId=env["MIGRATION_COS_SECRET_ID"],
                                SecretKey=env["MIGRATION_COS_SECRET_KEY"],
                                Token=env["MIGRATION_COS_TOKEN"]))
    auth = oss2.StsAuth(env["MIGRATION_OSS_KEY_ID"], env["MIGRATION_OSS_KEY_SECRET"],
                        env["MIGRATION_OSS_TOKEN"], auth_version="v4")
    region = config["OSS_REGION"]
    bucket = oss2.Bucket(auth, f"https://oss-{region}.aliyuncs.com", config["OSS_BUCKET"],
                         region=region, connect_timeout=15)
    return CosSource(cos, config["COS_BUCKET"]), OssTarget(bucket)


class CosSource:
    def __init__(self, client, bucket):
        self.client = client
        self.bucket = bucket

    def keys(self, prefix):
        marker = ""
        while True:
            page = self.client.list_objects(Bucket=self.bucket, Prefix=prefix, Marker=marker)
            for obj in page.get("Contents", ()):
                yield obj["Key"]
            if page["IsTruncated"] == "false":
                return
            next_marker = page["NextMarker"]
            if page["IsTruncated"] != "true" or next_marker <= marker:
                raise ValueError("Invalid COS pagination")
            marker = next_marker

    def get(self, key, limit):
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
        except CosServiceError as exc:
            if exc.get_status_code() == 404 and exc.get_error_code() == "NoSuchKey":
                return None
            raise
        raw = response["Body"].get_raw_stream()
        try:
            return raw.headers.get("Content-Type"), raw.read(limit, decode_content=False)
        finally:
            raw.close()
            raw.release_conn()


class OssTarget:
    def __init__(self, bucket):
        self.bucket = bucket

    def keys(self, prefix):
        for obj in oss2.ObjectIteratorV2(self.bucket, prefix=prefix):
            yield obj.key

    def check_destination(self):
        if self.bucket.get_bucket_acl().acl != "private":
            raise ValueError("Target requires a private bucket")
        if self.bucket.get_bucket_versioning().status is not None:
            raise ValueError("Conditional create requires an unversioned target")

    def get(self, key, limit):
        try:
            obj = self.bucket.get_object(key)
        except oss2.exceptions.NoSuchKey:
            return None
        with closing(obj.resp.response) as response:
            return obj.content_type, response.raw.read(limit, decode_content=False)

    def create(self, key, mime, body):
        headers = {"Content-Type": mime, "x-oss-forbid-overwrite": "true", "x-oss-object-acl": "private"}
        try:
            self.bucket.put_object(key, body, headers=headers)
        except oss2.exceptions.ServerError as exc:
            if exc.status == 409 and exc.code == "FileAlreadyExists":
                return False
            raise
        return True

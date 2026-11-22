#!/usr/bin/env bash
set -euo pipefail
if [ -z "${COS_SECRET_ID:-}" ] || [ -z "${COS_SECRET_KEY:-}" ] || [ -z "${COS_BUCKET:-}" ]; then
  {
    echo "state=skipped"
    echo "presigned_url="
  } >> "$GITHUB_OUTPUT"
  echo "::notice::runner→COS 段跳过：缺少 secrets.COS_RELEASE_SECRET_ID / secrets.COS_RELEASE_SECRET_KEY / vars.COS_RELEASE_BUCKET（接入方式见 docs/android/release-process.md §卸载链路体检）。TX1→网盘段仍会测量。"
  exit 0
fi
REGION="${COS_REGION:-ap-shanghai}"
export REGION
# 版本固定（不是「装最新」）：这一步带着生产 COS 凭证运行，不能让上游任意新版本自动进入
# 执行路径（供应链 + 可复现）；升级必须走代码改动与评审。完整哈希锁定（--require-hashes）
# 需要按平台维护锁文件，属后续工作。
python3 -m pip install --quiet --disable-pip-version-check 'cos-python-sdk-v5==1.9.44'
python3 - <<'PY'
import os
import socket
import time
from qcloud_cos import CosConfig, CosS3Client

region = os.environ["REGION"]
bucket = os.environ["COS_BUCKET"]
name = os.environ["PROBE_NAME"]
size = int(os.environ["PROBE_SIZE"])
path = os.environ["PROBE_PATH"]

client = CosS3Client(CosConfig(
    Region=region,
    SecretId=os.environ["COS_SECRET_ID"],
    SecretKey=os.environ["COS_SECRET_KEY"],
    Scheme="https",
))
host = "%s.cos.%s.myqcloud.com" % (bucket, region)
print("COS endpoint: https://%s" % host)
try:
    print("runner resolves %s -> %s" % (host, socket.gethostbyname(host)))
except OSError as error:
    print("runner cannot resolve %s: %s" % (host, error))

mib = size / (1024.0 * 1024.0)

def measure(label, key, part_mb, threads):
    started = time.time()
    client.upload_file(Bucket=bucket, Key=key, LocalFilePath=path,
                       PartSize=part_mb, MAXThread=threads)
    elapsed = time.time() - started
    rate = mib / elapsed
    print("%s: %d bytes in %.2fs (%.2f MiB/s, %.1f Mbit/s)" % (
        label, size, elapsed, rate, size * 8.0 / elapsed / 1e6))
    return elapsed, rate

# 8 路分片：part 大小取 mib//8（下限 1 MiB，COS 的最小 part 尺寸），保证**恰好 ≥8 个 part**——
# 否则 8..28 MiB 的小探针只切出 2–7 片，MAXThread=8 并发不起来，数字就不是 8 路测量。
part_mb = max(1, int(mib) // 8)
parts = (size + part_mb * 1024 * 1024 - 1) // (part_mb * 1024 * 1024)
print("parallel upload plan: PartSize=%d MiB, MAXThread=8, parts=%d" % (part_mb, parts))
single_seconds, single_mibps = measure(
    "runner->COS single flow (1 part)", "android/probe/%s.single" % name, max(1, int(mib)), 1)
parallel_seconds, parallel_mibps = measure(
    "runner->COS 8-way multipart", "android/probe/%s" % name, part_mb, 8)

head = client.head_object(Bucket=bucket, Key="android/probe/%s" % name)
head_size = int(head["Content-Length"])
print("COS HEAD android/probe/%s: Content-Length=%d (expected %d) ETag=%s" % (
    name, head_size, size, head.get("ETag", "<none>")))
if head_size != size:
    raise SystemExit("COS object size mismatch after upload: %d != %d" % (head_size, size))

url = client.get_presigned_url(
    Bucket=bucket, Key="android/probe/%s" % name, Method="GET", Expired=1800)
with open(os.environ["GITHUB_OUTPUT"], "a") as out:
    out.write("state=ok\n")
    out.write("presigned_url=%s\n" % url)
    out.write("single_seconds=%.2f\n" % single_seconds)
    out.write("single_mibps=%.2f\n" % single_mibps)
    out.write("parallel_seconds=%.2f\n" % parallel_seconds)
    out.write("parallel_mibps=%.2f\n" % parallel_mibps)
print("presigned GET URL issued (TTL 1800s, printed by the step env block); "
      "the object is deleted by the cleanup step at the end of this run")
PY

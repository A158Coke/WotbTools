#!/usr/bin/env python3
"""前端镜像不可变 tag 的 identity 口径一致性门禁（无 Docker / 无网络）。

## 事故背景（2026-10-10）

TX1 构建脚本的 identity 纳入 sponsor 内容指纹（第三个输入）后，**Frontend deploy** 与
**Frontend Replica** 两处仍在就地重算两输入 identity：每次 main 前端部署都以

    ERROR: ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend:sha-<另一枚> : not found

失败（Frontend 工作流自 `b2293f20` 起未再成功 —— 生产前端一直停在旧镜像）。

## 本测试锁死的口径

1. **唯一公式**（`deploy/tx/build-frontend-from-gitee.sh`，构建脚本是 tag 的定义者）：
   `sha256(source_sha + "\\n" + asset_base_url + "\\n" + sponsor_fingerprint)[0:12]`
2. **Frontend deploy**（`frontend.yml`）**不得**重算 identity —— 只能消费 build job 实产的
   镜像 ref（job outputs `image`）。就地重算是本事故的形态，静态禁止回归。
3. **Frontend Replica**（`frontend-replica.yml`）与公式同输入同序，sponsor 指纹必须经
   `deploy/tx/sponsor-fingerprint.sh` 派生（与构建侧同一语义）。
4. **真实运行数据点**（两个历史 run 的 `RESULT image=` 实测值）验证公式语义；并断言
   任意单个输入缺失都会得到不同 tag（这正是 deploy 侧两输入公式永远 not-found 的直接原因）。
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "deploy/tx/build-frontend-from-gitee.sh"
FRONTEND_WF = ROOT / ".github/workflows/frontend.yml"
REPLICA_WF = ROOT / ".github/workflows/frontend-replica.yml"
FINGERPRINT_SCRIPT = ROOT / "deploy/tx/sponsor-fingerprint.sh"

ASSET_BASE_URL = "https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com"
# 数据点来自两个真实 run 的构建日志（`RESULT image=...:sha-<12>`）：
#   76cf8acb… = Merge PR #581（Frontend run 38060016028 / build 侧 tag f52430fb1b7f）
#   e3ba28f0… = 事故期间的 main 提交（run 38046307993 / build 侧 tag ff0a703af8f8）
SPONSOR_FINGERPRINT = "75cdd72f1e1714cacd81cc6ce97e7918a58eb9657a2a224d965ca28d7578b2bf"
DATA_POINTS = [
    ("76cf8acbdfbcf9c53970d6e680cf039fb2fd34a7", "sha-f52430fb1b7f"),
    ("e3ba28f0a103ae345197978e51549345e7ca5359", "sha-ff0a703af8f8"),
]

# printf 的格式串（`%s\n%s\n%s`）与参数列表一起提取：参数顺序即 identity 输入顺序。
IDENTITY_RE = re.compile(
    r"""identity="\$\(printf\s+'(?P<fmt>[^']*)'\s+(?P<args>[^|]*?)\s*\|\s*sha256sum\s*\|\s*cut\s+-c1-12\)"""
)
NAME_ALIASES = {
    "$source_sha": "source_sha",
    "$SOURCE_SHA": "source_sha",
    "$asset_base_url": "asset_base_url",
    "$ASSET_BASE_URL": "asset_base_url",
    "$sponsor_fingerprint": "sponsor_fingerprint",
    "$SPONSOR_FINGERPRINT": "sponsor_fingerprint",
}


def identity_inputs(text: str) -> tuple[str, list[str]]:
    match = IDENTITY_RE.search(text)
    assert match, "identity 计算未找到（公式被改写成别的形态？）"
    tokens = (token.strip().strip('"') for token in match.group("args").split())
    names = [NAME_ALIASES.get(token, token) for token in tokens]
    return match.group("fmt"), names


def expected_identity(source_sha: str, fingerprint: str) -> str:
    digest = hashlib.sha256(f"{source_sha}\n{ASSET_BASE_URL}\n{fingerprint}".encode()).hexdigest()
    return f"sha-{digest[:12]}"


class IdentityFormula(unittest.TestCase):
    def test_builder_defines_three_input_formula(self) -> None:
        fmt, names = identity_inputs(BUILDER.read_text(encoding="utf-8"))
        self.assertEqual(fmt, r"%s\n%s\n%s")
        self.assertEqual(names, ["source_sha", "asset_base_url", "sponsor_fingerprint"])

    def test_replica_matches_builder_formula(self) -> None:
        text = REPLICA_WF.read_text(encoding="utf-8")
        fmt, names = identity_inputs(text)
        builder_fmt, builder_names = identity_inputs(BUILDER.read_text(encoding="utf-8"))
        self.assertEqual(fmt, builder_fmt)
        self.assertEqual(names, builder_names)
        self.assertIn("deploy/tx/sponsor-fingerprint.sh", text,
                      "Replica 的 sponsor 指纹必须经共享脚本派生（不得内联第三种取法）")

    def test_real_run_data_points(self) -> None:
        for source_sha, tag in DATA_POINTS:
            self.assertEqual(expected_identity(source_sha, SPONSOR_FINGERPRINT), tag)

    def test_dropping_any_input_changes_identity(self) -> None:
        sha = DATA_POINTS[0][0]
        full = expected_identity(sha, SPONSOR_FINGERPRINT)
        two_input = hashlib.sha256(f"{sha}\n{ASSET_BASE_URL}".encode()).hexdigest()[:12]
        self.assertNotEqual(full, f"sha-{two_input}",
                            "两输入（漏 sponsor 指纹）必须与三输入不同——这正是事故形态")
        replaced = expected_identity(sha, "0" * 64)
        self.assertNotEqual(full, replaced, "换 sponsor 内容必须换 tag（immutable 复用不得吞掉）")


class DeployConsumesPublishedImage(unittest.TestCase):
    def setUp(self) -> None:
        self.text = FRONTEND_WF.read_text(encoding="utf-8")
        # build job 的 job-level outputs（声明的位置无关，按整份文件断言这两条同时存在）。
        self.assertIn("image: ${{ steps.remote_build.outputs.image }}", self.text,
                      "build job 必须把实产镜像 ref 暴露为 job output")

    def test_deploy_reference_is_build_output(self) -> None:
        self.assertIn("immutable_ref='${{ needs.build.outputs.image }}'", self.text)

    def test_deploy_does_not_recompute_identity(self) -> None:
        deploy_block = self.text.split("- name: Reconcile only Frontend under the TX host lock", 1)
        self.assertEqual(len(deploy_block), 2, "deploy 的 reconcile 步骤未找到")
        body = deploy_block[1].split("\n      - ", 1)[0]
        self.assertNotIn("cut -c1-12", body,
                         "deploy 不得就地重算 identity（2026-10-10 事故形态：漏 sponsor 指纹输入）")


class FingerprintScript(unittest.TestCase):
    def test_missing_pin_prints_dash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = subprocess.run(["bash", str(FINGERPRINT_SCRIPT), tmp],
                                 check=True, capture_output=True, text=True).stdout
            self.assertEqual(out, "-\n")

    def test_pin_prints_artifact_sha(self) -> None:
        out = subprocess.run(["bash", str(FINGERPRINT_SCRIPT), str(ROOT)],
                             check=True, capture_output=True, text=True).stdout
        self.assertEqual(out.strip(), SPONSOR_FINGERPRINT)

    def test_incomplete_pin_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pin = Path(tmp) / "deploy/sponsor/content.json"
            pin.parent.mkdir(parents=True)
            pin.write_text('{"artifact": {"release": "v1"}}', encoding="utf-8")
            proc = subprocess.run(["bash", str(FINGERPRINT_SCRIPT), tmp],
                                  capture_output=True, text=True)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("incomplete artifact metadata", proc.stderr)


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)

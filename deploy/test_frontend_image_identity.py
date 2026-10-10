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
2. **Frontend deploy**（`frontend.yml` 的 reconcile 块）**同公式同输入**，且 identity **就地重算**
   ——不得走 job outputs（契约见 `scripts/ci/test-workflow-contract.sh`：GitHub 会把形似密钥的
   SHA/digest 打码）。sponsor 指纹经随包 stage 的 pin + `deploy/tx/sponsor-fingerprint.sh` 派生。
3. **Frontend Replica**（`frontend-replica.yml`）同样同输入同序，指纹经同一脚本派生。
4. **真实运行数据点**（两个历史 run 的 `RESULT image=` 实测值）验证公式语义；并断言
   任意单个输入缺失都会得到不同 tag（这正是 deploy 侧两输入公式永远 not-found 的直接原因）。
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "deploy/tx/build-frontend-from-gitee.sh"
FRONTEND_WF = ROOT / ".github/workflows/frontend.yml"
REPLICA_WF = ROOT / ".github/workflows/frontend-replica.yml"
FINGERPRINT_SCRIPT = ROOT / "deploy/tx/sponsor-fingerprint.sh"

ASSET_BASE_URL = "https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com"
# 数据点来自真实 run 的构建日志（`RESULT image=...:sha-<12>`）：
#   76cf8acb… = Merge PR #581（Frontend run 38060016028 / build 侧 tag f52430fb1b7f）
#   e3ba28f0… = 事故期间的 main 提交（run 38046307993 / build 侧 tag ff0a703af8f8）
SPONSOR_FINGERPRINT = "75cdd72f1e1714cacd81cc6ce97e7918a58eb9657a2a224d965ca28d7578b2bf"
DATA_POINTS = [
    ("76cf8acbdfbcf9c53970d6e680cf039fb2fd34a7", "sha-f52430fb1b7f"),
    ("e3ba28f0a103ae345197978e51549345e7ca5359", "sha-ff0a703af8f8"),
]
# 无 pin 数据点（复审复现，2026-10-10）：同一 source SHA 下 builder 归一化为空串得
# `sha-f1698ee92506`；若第三输入取 `-` 则得 `sha-6d521aeadd3e`（deploy/replica 曾算出后者）。
NO_PIN_SHA = "f84f49833c8251b81288c782c393d4fab8994e7e"
NO_PIN_BUILDER_TAG = "sha-f1698ee92506"
NO_PIN_DASH_TAG = "sha-6d521aeadd3e"

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

    def test_no_pin_identity_matches_builder_cli_normalization(self) -> None:
        """无 pin 时第三输入 = 构建器 CLI 归一化后的值（空串），不得是占位符 `-`。

        复审复现（2026-10-10）：同一 source SHA 下 builder=sha-f1698ee92506、
        deploy/replica=sha-6d521aeadd3e——两枚 tag 的真实值在此锁定。
        """
        builder_text = BUILDER.read_text(encoding="utf-8")
        # 归一化规则必须仍在构建器 CLI 入口（`-` ⇒ 空串），我们从源码解析而不是抄一份。
        self.assertRegex(
            builder_text,
            r'\[ "\$sponsor_fingerprint" != "-" \] \|\| sponsor_fingerprint=""',
            "构建器 CLI 的缺失值归一化规则改变了，identity 口径需重新对齐",
        )
        self.assertIn("<sponsor-fingerprint|->", builder_text,
                      "构建器 usage 里的 `-` 占位约定改变了")
        self.assertEqual(expected_identity(NO_PIN_SHA, ""), NO_PIN_BUILDER_TAG)
        self.assertNotEqual(expected_identity(NO_PIN_SHA, ""), NO_PIN_DASH_TAG)

    def test_dropping_any_input_changes_identity(self) -> None:
        sha = DATA_POINTS[0][0]
        full = expected_identity(sha, SPONSOR_FINGERPRINT)
        two_input = hashlib.sha256(f"{sha}\n{ASSET_BASE_URL}".encode()).hexdigest()[:12]
        self.assertNotEqual(full, f"sha-{two_input}",
                            "两输入（漏 sponsor 指纹）必须与三输入不同——这正是事故形态")
        replaced = expected_identity(sha, "0" * 64)
        self.assertNotEqual(full, replaced, "换 sponsor 内容必须换 tag（immutable 复用不得吞掉）")


class FrontendWorkflowDeployFormula(unittest.TestCase):
    """deploy 与 replica 都必须与构建脚本同公式同输入（就地重算，且不得跨 job outputs）。"""

    def setUp(self) -> None:
        self.text = FRONTEND_WF.read_text(encoding="utf-8")
        self.deploy_block = self.text.split("- name: Reconcile only Frontend under the TX host lock", 1)
        self.assertEqual(len(self.deploy_block), 2, "deploy 的 reconcile 步骤未找到")
        self.deploy_body = self.deploy_block[1].split("\n      - ", 1)[0]

    def test_deploy_matches_builder_formula(self) -> None:
        fmt, names = identity_inputs(self.deploy_body)
        builder_fmt, builder_names = identity_inputs(BUILDER.read_text(encoding="utf-8"))
        self.assertEqual(fmt, builder_fmt)
        self.assertEqual(names, builder_names)

    def test_deploy_derives_sponsor_fingerprint_on_tx(self) -> None:
        # 指纹必须由随包 stage 的 pin 就地派生（同一 source commit 的同一值），不得来自 runner 侧传递。
        self.assertIn("deploy/tx/sponsor-fingerprint.sh", self.deploy_body)
        self.assertIn("/opt/wotb-tx/deploy.incoming", self.deploy_body)

    def test_sponsor_pin_staging_is_split_and_guarded(self) -> None:
        # pin 可被删除：可选目录不能并入必选 scp（否则步骤失败），且必须单独拷到与必选步骤
        # 相同的 target（远端路径 deploy.incoming/deploy/sponsor/content.json 是 identity 输入）。
        self.assertNotIn("source: deploy/tx,deploy/sponsor", self.text,
                         "sponsor staging 不得合并进必选步骤（pin 缺失时整个目录不存在）")
        sponsor_step = self.text.split("- name: Stage sponsor pin when present", 1)
        self.assertEqual(len(sponsor_step), 2, "缺少独立且带守卫的 sponsor staging 步骤")
        body = sponsor_step[1].split("\n      - ", 1)[0]
        self.assertIn("if: ${{ hashFiles('deploy/sponsor/content.json') != '' }}", body)
        self.assertIn("source: deploy/sponsor", body)
        self.assertIn("target: /opt/wotb-tx/deploy.incoming", body)
        mandatory = self.text.split("- name: Stage TX runtime files", 1)[1].split("\n      - ", 1)[0]
        self.assertIn("source: deploy/tx\n", mandatory)

    def test_staged_identity_inputs_are_declared_production_inputs(self) -> None:
        # 远端派生 fingerprint 依赖的两个路径（新脚本 + pin）必须登记为生产输入：
        # push.paths 与 PRODUCTION_INPUT_PATHS 逐条相等（scripts/ci/test-workflow-contract.sh），
        # 且被 owner 过滤器覆盖（.github/ci-owner-paths.yml）。
        push_paths = self.text.split("    paths:\n", 1)[1].split("  workflow_dispatch:", 1)[0]
        for entry in ("deploy/tx/sponsor-fingerprint.sh", "deploy/sponsor/**"):
            self.assertIn(entry, push_paths)
            self.assertIn(entry, self.text.split("  PRODUCTION_INPUT_PATHS: |\n", 1)[1].split("concurrency:", 1)[0])
        owner_paths = (ROOT / ".github/ci-owner-paths.yml").read_text(encoding="utf-8")
        for entry in ("deploy/tx/sponsor-fingerprint.sh", "deploy/sponsor/**"):
            self.assertIn(f"'{entry}'", owner_paths)

    def test_identity_does_not_cross_job_outputs(self) -> None:
        # scripts/ci/test-workflow-contract.sh 的既有契约：GitHub 会对形似密钥的 SHA/digest 打码，
        # release identity 不得跨 job-output 边界（本地再挡一层，避免两处口径反向漂移）。
        self.assertNotIn("needs.build.outputs", self.text)
        build_block = self.text.split("\n  build:", 1)[1].split("\n  deploy:", 1)[0]
        self.assertNotIn("\n    outputs:", build_block)


class FingerprintScript(unittest.TestCase):
    def test_pin_prints_artifact_sha(self) -> None:
        out = subprocess.run(["bash", str(FINGERPRINT_SCRIPT), str(ROOT)],
                             check=True, capture_output=True, text=True).stdout
        self.assertEqual(out.strip(), SPONSOR_FINGERPRINT)

    def test_missing_pin_matches_builder_absent_token(self) -> None:
        """无 pin 时输出必须等于构建器 CLI 归一化后的第三输入（空串）——不是占位符 `-`。

        复审 P2（2026-10-10）：曾返回 `-`，同一 source SHA 下 deploy/replica 得到
        `sha-6d521aeadd3e`，而构建实产 `sha-f1698ee92506` ⇒ 永远 not found。
        """
        with tempfile.TemporaryDirectory() as tmp:
            out = subprocess.run(["bash", str(FINGERPRINT_SCRIPT), tmp],
                                 check=True, capture_output=True, text=True).stdout
            self.assertEqual(out, "\n", "无 pin 的指纹必须是空串（构建器 CLI 的归一化值）")
            self.assertEqual(out.strip(), "")
            self.assertNotEqual(out.strip(), "-")

    def test_incomplete_pin_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pin = Path(tmp) / "deploy/sponsor/content.json"
            pin.parent.mkdir(parents=True)
            pin.write_text('{"artifact": {"release": "v1"}}', encoding="utf-8")
            proc = subprocess.run(["bash", str(FINGERPRINT_SCRIPT), tmp],
                                  capture_output=True, text=True)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("incomplete artifact metadata", proc.stderr)


class StagingContinuity(unittest.TestCase):
    """'有 pin → 删除 pin' 的连续部署：远端不得残留旧 pin（复审 P2，2026-10-10）。"""

    def _prepare_step_script(self) -> str:
        workflow = yaml.safe_load(FRONTEND_WF.read_text(encoding="utf-8"))
        step = next(s for s in workflow["jobs"]["deploy"]["steps"]
                    if s.get("name") == "Prepare TX staging directories")
        return step["with"]["script"]

    def test_prepare_removes_removed_sponsor_pin(self) -> None:
        script = self._prepare_step_script()
        self.assertIn("WOTB_TX_ROOT", script,
                      "准备步骤需允许本地回归注入 root（默认路径不变）")
        with tempfile.TemporaryDirectory() as tmp:
            # 上一轮部署留下的旧文件：sponsor pin + tx 运行时文件
            stale_pin = Path(tmp) / "deploy.incoming/deploy/sponsor/content.json"
            stale_tx = Path(tmp) / "deploy.incoming/deploy/tx/deploy.sh"
            for path in (stale_pin, stale_tx):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("stale\n", encoding="utf-8")

            subprocess.run(["bash", "-c", script], check=True,
                           env={**os.environ, "WOTB_TX_ROOT": tmp})

            self.assertFalse(stale_pin.exists(), "旧 sponsor pin 必须被清掉")
            self.assertFalse(stale_tx.exists(), "旧 tx 文件必须被清掉")
            self.assertTrue((Path(tmp) / "deploy.incoming/deploy/tx").is_dir(),
                            "必选 tx 目录需重建（供必选 scp 落位）")
            # 清理后远端派生出的指纹 = 无 pin 值（与构建侧同一发布路径）
            out = subprocess.run(["bash", str(FINGERPRINT_SCRIPT),
                                  str(Path(tmp) / "deploy.incoming")],
                                 check=True, capture_output=True, text=True).stdout
            self.assertEqual(out.strip(), "")


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)

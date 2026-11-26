"""Consumer audit regression fixtures; no network or installed Android SDK required."""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import consumer_inventory as audit


class AndroidConsumersTest(unittest.TestCase):
    def test_annotated_tag_is_peeled_regardless_of_listing_order(self):
        a, b = "a" * 40, "b" * 40
        ref = "refs/tags/android-v5.4.1"
        self.assertEqual(audit.remote_tags([f"{a} {ref}^{{}}", f"{b} {ref}"]), {"5.4.1": a})
        with self.assertRaises(ValueError):
            audit.remote_tags([f"{a} {ref}^{{}}"])

    def test_catalog_keeps_floor_latest_and_requested_legacy_but_excludes_future(self):
        versions = ["3.17.0", "4.8.1", "5.4.1", "5.5.0", "5.7.2", "5.8.0"]
        tags = {v: str(n) * 40 for n, v in enumerate(versions)}
        def tagged(commit, path):
            version = next(v for v, sha in tags.items() if sha == commit)
            if path.endswith("gradle.properties"):
                return "wotbVersion=" + version + "\nwotbNativeBridgeVersion=4"
            if path.endswith(".kt"):
                return 'private const val REMOTE_ASSET_BASE = "https://assets.wotbtools.com"'
            return '{"bridgeVersion": 4}' if path.startswith("contracts/") else "{}"
        manifest = dict(latestVersionName="5.7.2", latestVersionCode=5007002, minSupportedVersionCode=5004001,
                        sourceSha=tags["5.7.2"])
        with patch.object(audit, "git_file", side_effect=tagged):
            rows = audit.catalog(manifest, tags, ["3.17.0"])["candidates"]
        self.assertEqual([r["version"] for r in rows], ["3.17.0", "5.4.1", "5.5.0", "5.7.2"])
        with self.assertRaises(ValueError):
            audit.catalog({**manifest, "sourceSha": tags["5.8.0"]}, tags, [])
        with self.assertRaisesRegex(ValueError, "floor 5004001"):
            audit.catalog(manifest, {"5.7.2": tags["5.7.2"]}, [])

    def test_verify_requires_exact_selection_from_saved_refs_including_historical(self):
        tags = {v: str(i) * 40 for i, v in enumerate(["3.17.0", "5.4.1", "5.5.0", "5.7.2", "6.0.0"])}
        manifest = dict(latestVersionName="5.7.2", latestVersionCode=5007002, minSupportedVersionCode=5004001,
                        sourceSha=tags["5.7.2"])
        required = audit.required_tags(manifest, tags, ["3.17.0"])
        rows = [{"version": v, "commit": sha} for v, sha in required.items()]
        data = dict(manifest=manifest, historicalVersions=["3.17.0"], requiredTags=required, candidates=rows)
        audit.validate_coverage(data, tags)
        for version in required:
            with self.subTest(missing=version), self.assertRaisesRegex(ValueError, "missing="):
                audit.validate_coverage({**data, "candidates": [r for r in rows if r["version"] != version]}, tags)
        for invalid in (rows + [rows[0]], rows + [{"version": "6.0.0", "commit": tags["6.0.0"]}],
                        [{**rows[0], "commit": "f" * 40}, *rows[1:]]):
            with self.assertRaises(ValueError):
                audit.validate_coverage({**data, "candidates": invalid}, tags)
        truncated = {v: sha for v, sha in required.items() if v != "5.5.0"}
        with self.assertRaisesRegex(ValueError, "saved remote tag snapshot"):
            audit.validate_coverage({**data, "requiredTags": truncated,
                                     "candidates": [r for r in rows if r["version"] in truncated]}, tags)

    def test_dex_requires_one_proxy_with_the_expected_load_instruction(self):
        current = "https://assets.wotbtools.com"
        descriptor = "  Class descriptor  : 'Lcom/wotbtools/app/AgentAssetProxy;'"
        method = f'00e: ff |000b: const-string/jumbo v10, "{current}" // string@1234'
        unrelated = "  Class descriptor  : 'Lother;'"
        self.assertEqual(audit.proxy_literal([unrelated, method, descriptor, method], current), current)
        for dump in ([unrelated, method], [descriptor, unrelated, method], [descriptor, method, descriptor],
                     [descriptor, method, method.replace(current, "https://different.example")]):
            with self.subTest(dump=dump), self.assertRaises(ValueError):
                audit.proxy_literal(dump, current)

    def test_staging_does_not_override_live_digest_or_hide_historical_tag_drift(self):
        sha = "a" * 40
        ident = dict(sourceSha=sha, versionCode=5007002, sha256="f" * 64, nativeBridgeVersion=4,
                     apkUrl="https://example.invalid/app.apk", bundleFileCount=1, bundleManifestSha256="b" * 64,
                     assetOrigin="/agent-assets")
        row = dict(version="5.7.2", commit=sha, pin={}, bridge={}, tagOrigin="https://assets.wotbtools.com")
        manifest = dict(latestVersionName=row["version"], latestVersionCode=ident["versionCode"],
                        sourceSha=sha, nativeBridgeVersion=4, apkUrl=ident["apkUrl"], apkSizeBytes=3, sha256=ident["sha256"])
        with TemporaryDirectory() as directory, patch.object(audit.contract, "apk_bundle_identity", return_value=ident):
            apk = Path(directory) / "test.apk"
            apk.write_bytes(b"APK")
            self.assertTrue(audit.verify_bundle(row, manifest, ident, apk)["tagMatchesStaging"])
            history = audit.verify_bundle({**row, "commit": "c" * 40}, {"latestVersionName": "6.0.0"}, ident, apk)
            self.assertFalse(history["tagMatchesStaging"])
            self.assertEqual(history["sourceSha"], sha)
            with self.assertRaises(ValueError):
                audit.verify_bundle(row, {**manifest, "sha256": "0" * 64}, ident, apk)
            with self.assertRaises(ValueError):
                audit.verify_bundle(row, manifest, {**ident, "apkSizeBytes": 2}, apk)


if __name__ == "__main__":
    unittest.main()

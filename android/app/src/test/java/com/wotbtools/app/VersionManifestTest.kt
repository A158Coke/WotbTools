package com.wotbtools.app

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class VersionManifestTest {
    private fun valid() = JSONObject()
        .put("schemaVersion", 1).put("latestVersionCode", 3028000)
        .put("latestVersionName", "3.28.0").put("minSupportedVersionCode", 3017007)
        .put("nativeBridgeVersion", 3).put("apkUrl", "https://wotbtools.com/download/android/update.apk")
        .put("sha256", "a".repeat(64))

    private fun patch() = JSONObject()
        .put("fromVersionCode", 3027000)
        .put("fromSha256", "b".repeat(64))
        .put("algorithm", "xdelta3-vcdiff")
        .put("url", "https://wotbtools.com/download/android/update.patch")
        .put("sha256", "c".repeat(64))
        .put("size", 12345678)

    @Test fun additivePatchesPreserveLegacyFullManifestAndExposeValidDirectPatch() {
        val original = VersionManifest.fromJson(valid().toString())
        assertTrue(original.patches.isEmpty())
        val candidate = VersionManifest.fromJson(valid().put("apkSizeBytes", 203738834)
            .put("patches", JSONArray().put(patch())).toString())
        assertEquals(original.apkUrl, candidate.apkUrl)
        assertEquals(original.sha256, candidate.sha256)
        assertEquals(1, candidate.patches.size)
        assertEquals(3027000, candidate.patches.single().fromVersionCode)
        assertEquals("b".repeat(64), candidate.patches.single().fromSha256)
        assertEquals("xdelta3-vcdiff", candidate.patches.single().algorithm)
        assertEquals(12345678L, candidate.patches.single().size)
        assertEquals(203738834L, candidate.apkSizeBytes)
    }

    @Test fun malformedOrAmbiguousPatchMetadataNeverDisablesFullUpdate() {
        val bad = listOf(
            patch().put("fromVersionCode", 3028000),
            patch().put("fromVersionCode", "3027000"),
            patch().put("fromVersionCode", -1),
            patch().put("fromSha256", "bad"),
            patch().put("sha256", "bad"),
            patch().put("url", "http://example.invalid/patch"),
            patch().put("url", "https://user@example.invalid/patch"),
            patch().put("algorithm", "unknown"),
            patch().put("size", 0),
            patch().put("size", 1.5),
            patch().put("size", "123"),
        )
        val original = VersionManifest.fromJson(valid().toString())
        for (entry in bad) {
            val parsed = VersionManifest.fromJson(valid().put("apkSizeBytes", 203738834)
                .put("patches", JSONArray().put(entry)).toString())
            assertTrue(entry.toString(), parsed.patches.isEmpty())
            assertEquals(original.apkUrl, parsed.apkUrl)
            assertEquals(original.sha256, parsed.sha256)
        }
        for (value in listOf(JSONObject.NULL, "invalid", JSONArray().put(patch()).put(patch()),
            JSONArray().put(patch()).put("invalid"), JSONArray().apply { repeat(33) { put(patch()) } })) {
            val parsed = VersionManifest.fromJson(valid().put("apkSizeBytes", 203738834).put("patches", value).toString())
            assertTrue(parsed.patches.isEmpty())
            assertEquals(original.apkUrl, parsed.apkUrl)
        }
    }

    @Test fun missingOrInvalidFullSizeDisablesOnlyDelta() {
        val original = VersionManifest.fromJson(valid().toString())
        for (size in listOf(JSONObject.NULL, 0, -1, 1.5, "100", 9_007_199_254_740_992L)) {
            val parsed = VersionManifest.fromJson(valid().put("patches", JSONArray().put(patch()))
                .put("apkSizeBytes", size).toString())
            assertNull(parsed.apkSizeBytes)
            assertTrue(parsed.patches.isEmpty())
            assertEquals(original.sha256, parsed.sha256)
        }
        val missing = VersionManifest.fromJson(valid().put("patches", JSONArray().put(patch())).toString())
        assertNull(missing.apkSizeBytes)
        assertTrue(missing.patches.isEmpty())
    }

    @Test fun rejectsUnsatisfiableFloorAndMalformedIntegrity() {
        for ((key, value) in listOf(
            "minSupportedVersionCode" to 3028001, "latestVersionCode" to -1,
            "sha256" to "", "sha256" to "g".repeat(64),
            "apkUrl" to "http://example.com/update.apk", "schemaVersion" to 2
        )) {
            assertThrows(IllegalArgumentException::class.java) {
                VersionManifest.fromJson(valid().put(key, value).toString())
            }
        }
    }

    @Test fun policyAndSchemaNeverCoerceFractionsNumericStringsOrOverflowingIntegers() {
        for (key in listOf("schemaVersion", "latestVersionCode", "minSupportedVersionCode", "nativeBridgeVersion")) {
            for (value in listOf(1.5, "1", JSONObject.NULL, true, Int.MAX_VALUE.toLong() + 1)) {
                assertThrows("$key=$value", IllegalArgumentException::class.java) {
                    VersionManifest.fromJson(valid().put(key, value).toString())
                }
            }
            assertThrows("missing $key", IllegalArgumentException::class.java) {
                VersionManifest.fromJson(valid().apply { remove(key) }.toString())
            }
        }
    }

    @Test fun requiredTextAndOptionalMetadataRejectNonStringProducerShapes() {
        for (key in listOf("latestVersionName", "apkUrl", "sha256", "publishedAt", "releaseNotes")) {
            assertThrows("$key is not a string", IllegalArgumentException::class.java) {
                VersionManifest.fromJson(valid().put(key, 123).toString())
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            VersionManifest.fromJson(valid().put("apkUrl", "https://").toString())
        }
    }

    @Test fun optionalMetadataUsesNullInsteadOfLiteralNullAndSupportsFloorAtLatest() {
        val manifest = VersionManifest.fromJson(valid()
            .put("minSupportedVersionCode", 3028000)
            .put("publishedAt", JSONObject.NULL).put("releaseNotes", "").toString())
        assertEquals(manifest.latestVersionCode, manifest.minSupportedVersionCode)
        assertNull(manifest.publishedAt)
        assertNull(manifest.releaseNotes)
    }
}

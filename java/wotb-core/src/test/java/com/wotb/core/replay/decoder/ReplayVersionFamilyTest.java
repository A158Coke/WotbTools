package com.wotb.core.replay.decoder;

import com.wotb.core.parse.ReplayVersionFamily;
import com.wotb.core.parse.SettlementFacts;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PR162/P1-6：单一 boundary-safe 版本家族匹配回归（exact OR family_*，拒绝畸形 chinaX）。 */
class ReplayVersionFamilyTest {

    @Test
    void verifiedFamiliesMatchExactAndUnderscoreSuffixes() {
        for (final String v : new String[]{
                "11.19.0_china",
                "11.19.0_china_apple",
                "11.19.0_china_apple_beta",
                "11.18.0_china",
                "11.18.0_china_apple"}) {
            assertEquals("verified", family(v), v);
        }
    }

    @Test
    void malformedChinaSuffixIsNotVerified() {
        for (final String v : new String[]{
                "11.19.0_chinaX",
                "11.19.0_chin",
                "11.18.0_chinaX",
                "11.20.0_china",
                "12.0.0_eu"}) {
            assertEquals("not-verified", family(v), v);
        }
    }

    private static String family(final String v) {
        if (ReplayVersionFamily.isCurrentVerified(v) || ReplayVersionFamily.isLegacyVerified(v)) {
            return "verified";
        }
        return "not-verified";
    }

    @Test
    void settlementSchemaAffirmedIsBoundarySafe() {
        assertTrue(SettlementFacts.isAffirmedFamily("11.19.0_china"));
        assertTrue(SettlementFacts.isAffirmedFamily("11.19.0_china_apple"));
        assertFalse(SettlementFacts.isAffirmedFamily("11.19.0_chinaX"),
                "11.19.0_chinaX 不得继承 verified settlement semantics");
        assertFalse(SettlementFacts.isAffirmedFamily("11.20.0_china"));
        assertFalse(SettlementFacts.isAffirmedFamily(null));
    }
}

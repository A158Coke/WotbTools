package com.wotb.core.parse;

import java.util.Locale;

/**
 * PR162/P1-6：<b>单一 boundary-safe 版本家族匹配权威</b>。所有 version-family 归一化 / 判断都由此类提供，
 * {@code parse}（SettlementFacts/ReplayParser）与 {@code replay.decoder/ReplayProtocolProfile} 共享，
 * 消除多处 prefix 列表与不一致的 {@code startsWith} 匹配。
 *
 * <p>边界规则统一为：<b>exact family</b> 或 <b>{@code family + "_..."}</b>（如
 * {@code 11.19.0_china_apple} / {@code 11.19.0_china_apple_beta}）。{@code 11.19.0_chinaX} 不应被当作
 * {@code 11.19} 家族，避免未来版本误继承 closed/verified semantics。</p>
 */
public final class ReplayVersionFamily {

    /** 当前 canonical 已验证家族（PR147 11.19 corpus authority）。 */
    public static final String CURRENT_VERIFIED_FAMILY = "11.19.0_china";
    /** 明确 legacy 验证的家族（repository fixtures/research 独立证明其 settlement 数值语义）。 */
    public static final String LEGACY_VERIFIED_FAMILY = "11.18.0_china";

    private ReplayVersionFamily() {
    }

    public static String normalize(final String clientVersion) {
        return clientVersion == null ? "" : clientVersion.trim().toLowerCase(Locale.ROOT);
    }

    /** 归一化后返回命中的 verified family（current/legacy），否则返回归一化原始串。 */
    public static String familyOf(final String clientVersion) {
        final String v = normalize(clientVersion);
        if (familyMatches(v, CURRENT_VERIFIED_FAMILY)) {
            return CURRENT_VERIFIED_FAMILY;
        }
        if (familyMatches(v, LEGACY_VERIFIED_FAMILY)) {
            return LEGACY_VERIFIED_FAMILY;
        }
        return v;
    }

    /** Boundary-safe 家族匹配：exact family 或 {@code family + "_..."}。 */
    public static boolean familyMatches(final String v, final String family) {
        return v.equals(family) || v.startsWith(family + "_");
    }

    public static boolean isCurrentVerified(final String clientVersion) {
        return CURRENT_VERIFIED_FAMILY.equals(familyOf(clientVersion));
    }

    public static boolean isLegacyVerified(final String clientVersion) {
        return LEGACY_VERIFIED_FAMILY.equals(familyOf(clientVersion));
    }

    /** settlement schema 是否已验证（current + legacy）；未知/未来/畸形（如 {@code ...X}）fail-closed。 */
    public static boolean isAffirmedFamily(final String clientVersion) {
        return isCurrentVerified(clientVersion) || isLegacyVerified(clientVersion);
    }
}

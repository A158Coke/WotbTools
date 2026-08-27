package com.wotb.core.replay.decoder;

import java.util.Locale;

/**
 * 版本门禁：closed replay semantics 只在已知兼容版本族上启用（计划 §A2）。
 *
 * <p>三级兼容性（container / settlement / event semantic decode）：
 * <ul>
 *   <li><b>container parse</b>（header / framing / terminator）：版本无关，永远执行；</li>
 *   <li><b>settlement parse</b>（battle_results.dat）：版本无关（字段号长期稳定）；</li>
 *   <li><b>event semantic decode</b>（Type10 49B / Type7 propId=3 HP / propId=2 炮塔偏航 /
 *       method38/36 等 closed semantics）：仅对已知版本族启用；未知版本 →
 *       raw-preserve + diagnostics，不得无条件沿用 numeric semantic。</li>
 * </ul>
 *
 * <p>已知版本族（证据：docs/research/replay）：
 * <ul>
 *   <li>CURRENT：{@code 11.19.0_china} / {@code 11.19.0_china_apple}（PR147 canonical corpus）；</li>
 *   <li>LEGACY_COMPATIBLE：{@code 11.18.0_china} / {@code 11.18.0_china_apple}
 *       （仓库既有 fixtures 实测同布局，如
 *       common/fixtures/replays/cw-training-15-14-example.wotbreplay = 11.18.0_china_apple）。</li>
 * </ul>
 */
public final class ReplayVersionGate {

    private static final String[] CURRENT_PREFIXES = {"11.19.0_china"};
    private static final String[] LEGACY_PREFIXES = {"11.18.0_china"};

    private ReplayVersionGate() {
    }

    /** closed semantics 是否允许（当前 canonical 家族 + legacy-compatible 家族）。 */
    public static boolean closedSemanticsAllowed(final String clientVersion) {
        final String v = normalize(clientVersion);
        return v != null && (matches(v, CURRENT_PREFIXES) || matches(v, LEGACY_PREFIXES));
    }

    /** 是否当前 canonical 版本族（11.19.0_china*）。 */
    public static boolean isCurrentFamily(final String clientVersion) {
        final String v = normalize(clientVersion);
        return v != null && matches(v, CURRENT_PREFIXES);
    }

    private static String normalize(final String clientVersion) {
        if (clientVersion == null || clientVersion.isBlank()) {
            return null;
        }
        return clientVersion.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean matches(final String version, final String[] prefixes) {
        for (final String prefix : prefixes) {
            if (version.equals(prefix) || version.startsWith(prefix + "_")) {
                return true;
            }
        }
        return false;
    }
}

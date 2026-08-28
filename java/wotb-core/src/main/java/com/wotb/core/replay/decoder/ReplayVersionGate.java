package com.wotb.core.replay.decoder;

import java.util.Locale;

/**
 * 版本门禁：PR147 closed replay semantics 只对已知兼容版本族启用（计划 §A2）。
 *
 * <p>三级兼容性（container / settlement / event semantic decode）：
 * <ul>
 *   <li><b>container parse</b>（header / framing / terminator）：版本无关，永远执行；</li>
 *   <li><b>settlement parse</b>（battle_results.dat）：版本无关（字段号长期稳定）；</li>
 *   <li><b>event semantic decode</b>（Type10 49B / Type7 propId=3 HP / propId=2 炮塔偏航 /
 *       method38 low16 / modifier IDs / component namespace / method36 field semantics 等
 *       PR147 closed semantics）：<b>仅对 {@code 11.19.0_china*} 当前 canonical 版本族启用</b>；
 *       未知/未来版本 → raw-preserve + diagnostics，不得无条件沿用 numeric semantic。</li>
 * </ul>
 *
 * <p>11.18 / 其它老版本只保留 container + settlement 兼容（仓库既有 fixtures 能解析
 * battle_results 与位置流），但<b>不自动获得</b> PR147 在 11.19 controlled replay 上证明的
 * closed numeric meanings（method38 位图 / modifier / component 命名空间 / method36 字段语义等）。
 * 证明来源：docs/research/replay（PR147 authoritative），见
 * research-completion-audit-11.19.md 与各 closure 文档。</p>
 *
 * <p>安全边界：未知版本必须 raw-preserve 且不 crash，绝不用已知版本 numeric semantic 假装解码。</p>
 */
public final class ReplayVersionGate {

    /** PR147 canonical corpus 版本族（controlled Quby→Maus 等证明 closed semantics）。 */
    private static final String[] CURRENT_PREFIXES = {"11.19.0_china"};

    private ReplayVersionGate() {
    }

    /** PR147 closed replay semantics 是否允许（仅 {@code 11.19.0_china*} canonical 家族）。 */
    public static boolean closedSemanticsAllowed(final String clientVersion) {
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

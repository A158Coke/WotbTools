package com.wotb.core.replay.decoder;

import com.wotb.core.parse.ReplayVersionFamily;

/**
 * Capability-based replay protocol profile (replaces the "client-version allowlist" model).
 *
 * <p>PR147 provides 11.19-proven facts; it does <b>not</b> mean WotBTools only ever supports 11.19.
 * Compatibility is decided per-capability against three layers, so a future version (e.g. 11.22) keeps
 * working for structurally-proven surfaces while version-scoped closed numeric semantics stay gated:</p>
 *
 * <ul>
 *   <li><b>Layer A — container/framing invariants</b>: version-independent; decoded when structural
 *       validation (magic/lengths/contiguous framing/terminator) passes.</li>
 *   <li><b>Layer B — stable structural layouts</b>: forward-compatible when the exact shape/invariants
 *       match the verified profile. Structural facts are produced; the trailing/raw bits stay raw.</li>
 *   <li><b>Layer C — closed numeric semantics</b> (sentinels/enums/bit-masks/cause-codes): strictly
 *       evidence-gated. Only verified versions inherit them; others {@code RAW / UNKNOWN}.</li>
 * </ul>
 *
 * <p>Confidence is decided per-fact, never by the raw version string ("11.19 = exact / 11.22 = unknown").
 * Structural capabilities use {@link Level#STRUCTURALLY_COMPATIBLE} for non-verified versions so the
 * decoder's exact-shape validation (not the version number) decides the outcome; a shape mismatch still
 * falls back to {@link Level#UNKNOWN} in the decoder. Closed semantics are only {@link Level#VERIFIED}
 * for the current 11.19 family.</p>
 */
public final class ReplayProtocolProfile {

    /** Protocol capability identifiers, grouped by evidence scope. */
    public enum Capability {
        // Layer B — stable structural layouts (shape-validatable, forward-compatible)
        TYPE10_LAYOUT,
        ENTITY_PROPERTY_ENVELOPE,
        ENTITY_METHOD_ENVELOPE,
        ENTITY_LIFECYCLE_LAYOUT,
        PARTICIPANT_MAPPING,
        TYPE14_STREAM_CLOSE,
        SETTLEMENT_SCHEMA,
        // Layer C — closed numeric semantics (strict evidence-gated)
        HP_POSITIVE_VALUE,
        TERMINAL_FFFD,
        TERMINAL_FFFE,
        ENTITY_TYPE_ID_SEMANTIC,
        METHOD_SEMANTICS,
        PROP_TURRET_YAW,
        METHOD36_AIM_RAY,
        METHOD38_SHOT_RESULT,
        TYPE31_GUN_MARKER,
        TYPE35_SESSION_DECISECOND,
        AMMO_SELECTION
    }

    /** Evidence/compatibility level for one capability. */
    public enum Level {
        /** Real fixtures / PR147 evidence prove layout + semantic for this client version. */
        VERIFIED,
        /** Shape/invariant matches a verified profile → safe to decode structural facts; closed semantics NOT inherited. */
        STRUCTURALLY_COMPATIBLE,
        /** Structure cannot be proven compatible → raw-preserve. */
        UNKNOWN
    }

    private ReplayProtocolProfile() {
    }

    /**
     * PR162/P1-6 (per-capability evidence matrix): 每个 capability 的 level 按 evidence 单独决定，<b>不是</b>
     * 「整个 family → 全部 VERIFIED」的 blanket。
     *
     * <ul>
     *   <li><b>11.19 (current)</b>: PR147 primary corpus → 全部 capability VERIFIED。</li>
     *   <li><b>11.18 (legacy)</b>: 仅 <b>独立 evidence</b>（PR147 corpus 为 11.18/11.19 + research/fixture/test）
     *       证明的结构 capability 才 VERIFIED；无独立证据的闭式数值语义（FFFE / method36/38 / Type31/35 /
     *       ammo / entityTypeId / method semantics / FFFD）不继承 → UNKNOWN。</li>
     *   <li><b>future / unknown</b>: 仅 deliberate 结构前向 capability → STRUCTURALLY_COMPATIBLE；闭式语义 / setting
     *       field-number 语义 → UNKNOWN。</li>
     * </ul>
     */
    public static Level levelOf(final String clientVersion, final Capability capability) {
        if (ReplayVersionFamily.isCurrentVerified(clientVersion)) {
            return Level.VERIFIED;
        }
        if (ReplayVersionFamily.isLegacyVerified(clientVersion)) {
            return legacyVerified(capability) ? Level.VERIFIED : Level.UNKNOWN;
        }
        return forwardCompatible(capability) ? Level.STRUCTURALLY_COMPATIBLE : Level.UNKNOWN;
    }

    /**
     * 11.18 legacy evidence（逐项可追）：
     * PR147 research corpus 为 <b>11.18.0_china_apple + 11.19.0_china_apple</b>（protocol.md §2），并包含
     * 11.18 样本对以下结构的独立证明：Type10（PositionDecoderTest 使用 11.18 上下文）、EntityProperty prop2
     * valueLen=2 九年来稳定（visibility/turret-direction）、EntityMethod method1 布局（EntityMethodDecoderVersionGateTest
     * 11.18）、entity-lifecycle（11.18 死亡/visibility 样本）、participant mapping（protocol.md #201 11.18 名册）、
     * settlement #24/#25/#105（SettlementCanonicalModelTest 11.19/11.18 无 #104）、Type14 stream-close（framing
     * 不变量）、正 HP 结构值。闭式数值语义（FFFE/method36/38/Type31/35/ammo/entityTypeId/method semantics/FFFD）
     * 只有 11.19 PR147 证明，无独立 11.18 evidence → UNKNOWN。
     */
    private static boolean legacyVerified(final Capability capability) {
        return switch (capability) {
            case TYPE10_LAYOUT, ENTITY_PROPERTY_ENVELOPE, ENTITY_METHOD_ENVELOPE, ENTITY_LIFECYCLE_LAYOUT,
                    PARTICIPANT_MAPPING, TYPE14_STREAM_CLOSE, SETTLEMENT_SCHEMA,
                    HP_POSITIVE_VALUE, PROP_TURRET_YAW -> true;
            case TERMINAL_FFFD, TERMINAL_FFFE, ENTITY_TYPE_ID_SEMANTIC, METHOD_SEMANTICS, METHOD36_AIM_RAY,
                    METHOD38_SHOT_RESULT, TYPE31_GUN_MARKER, TYPE35_SESSION_DECISECOND, AMMO_SELECTION -> false;
        };
    }

    /** 仅 deliberate 结构前向 capability（Layer B 结构布局 + 正 HP 结构值）对 future 给 STRUCTURALLY_COMPATIBLE。 */
    private static boolean forwardCompatible(final Capability capability) {
        return switch (capability) {
            case TYPE10_LAYOUT, ENTITY_PROPERTY_ENVELOPE, ENTITY_METHOD_ENVELOPE, ENTITY_LIFECYCLE_LAYOUT,
                    TYPE14_STREAM_CLOSE, HP_POSITIVE_VALUE -> true;
            case PARTICIPANT_MAPPING, SETTLEMENT_SCHEMA, PROP_TURRET_YAW, TERMINAL_FFFD, TERMINAL_FFFE,
                    ENTITY_TYPE_ID_SEMANTIC, METHOD_SEMANTICS, METHOD36_AIM_RAY, METHOD38_SHOT_RESULT,
                    TYPE31_GUN_MARKER, TYPE35_SESSION_DECISECOND, AMMO_SELECTION -> false;
        };
    }
}

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
 * <p>Confidence is decided per-fact / per-capability, never by the raw version string
 * ("11.19 = exact / 11.22 = unknown"). A capability is {@link Level#VERIFIED} only when its own evidence
 * (fixture/research/regression) supports that family; a capability is <b>not</b> automatically VERIFIED
 * across versions just because its family is "known". Closed numeric semantics do <b>not</b> inherit
 * across versions by default, but a specific semantic capability that has independent <b>11.18 legacy
 * evidence</b> (e.g. {@code PROP_TURRET_YAW}, {@code TERMINAL_FFFD}, {@code ENTITY_TYPE_ID_SEMANTIC},
 * ordinary positive HP) <b>is</b> VERIFIED for 11.18; the remaining closed semantics that lack such
 * evidence (e.g. {@code METHOD_SEMANTICS}, {@code TERMINAL_FFFE}, {@code METHOD36/38}, {@code TYPE31/35},
 * {@code AMMO_SELECTION}) are 11.19-only. Forward-compatible structural surfaces use
 * {@link Level#STRUCTURALLY_COMPATIBLE} for future versions, and the decoder's exact-shape validation
 * (not the version number) decides the outcome.</p>
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
        /** Type32 mobile flag=0 16-byte consumable-lifecycle semantic (wireCode→identity), 11.19 corpus proven. */
        TYPE32_CONSUMABLE_LIFECYCLE,
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
     *   <li><b>11.18 (legacy)</b>: 由 <b>独立 evidence</b>（PR147 corpus 为 11.18/11.19 + research/fixture/test，
     *       含 random-battle-example.wotbreplay = 11.18.0_china_apple）证明的 capability 才 VERIFIED —— 结构
     *       caps + 正 HP + {@code PROP_TURRET_YAW} + {@code TERMINAL_FFFD} + {@code ENTITY_TYPE_ID_SEMANTIC}；
     *       无独立 11.18 evidence 的闭式数值语义（{@code TERMINAL_FFFE / METHOD_SEMANTICS / METHOD36 / METHOD38 /
     *       TYPE31 / TYPE35 / AMMO_SELECTION}）不继承 → UNKNOWN（11.19-only）。</li>
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
     * PR162/P1-6：<b>single</b> numeric EntityMethod semantic authority（version + methodId）。
     * <ul>
     *   <li>11.19 current（PR147 primary）→ 所有 production method 语义 VERIFIED。</li>
     *   <li>11.18 legacy → 仅 Vehicle method1（health/state）有独立 evidence（Javadoc /
     *       EntityMethodDecoderVersionGateTest）→ VERIFIED；其它（0/4/5/17/20/27/29/36/38/47/48）UNKNOWN。</li>
     *   <li>future/unknown → UNKNOWN（envelope 结构仍可读取，numeric semantic 不继承）。</li>
     * </ul>
     */
    public static Level methodSemanticLevel(final String clientVersion, final int methodId) {
        if (ReplayVersionFamily.isCurrentVerified(clientVersion)) {
            return Level.VERIFIED;
        }
        if (ReplayVersionFamily.isLegacyVerified(clientVersion)) {
            return methodId == EntityMethodDecoder.SUBTYPE_VEHICLE_HEALTH_STATE
                    ? Level.VERIFIED : Level.UNKNOWN;
        }
        return Level.UNKNOWN;
    }

    /**
     * 11.18 legacy evidence（逐项可追）：
     * PR147 research corpus 为 <b>11.18.0_china_apple + 11.19.0_china_apple</b>（见 protocol.md），并包含
     * 11.18 样本对以下结构的独立证明：Type10（PositionDecoderTest 使用 11.18 上下文）、EntityProperty prop2
     * valueLen=2 九年来稳定（visibility/turret-direction）、EntityMethod method1 布局（EntityMethodDecoderVersionGateTest
     * 11.18）、entity-lifecycle（11.18 死亡/visibility 样本）、participant mapping（protocol.md #201 11.18 名册）、
     * settlement #24/#25/#105（SettlementCanonicalModelTest 11.19/11.18 无 #104）、Type14 stream-close（framing
     * 不变量）、正 HP 结构值、<b>FFFD 死亡终态</b> 与 <b>entityTypeId==2 → Vehicle 物化语义</b>
     * （random-battle-example.wotbreplay 即 11.18；PR147 corpus = 11.18/11.19）。
     * 仅以下闭式数值语义<b>无独立 11.18 evidence</b> → 11.18 保持 UNKNOWN（11.19-only）：
     * {@code TERMINAL_FFFE / METHOD_SEMANTICS / METHOD36 / METHOD38 / TYPE31 / TYPE35 / AMMO_SELECTION}。
     */
    private static boolean legacyVerified(final Capability capability) {
        return switch (capability) {
            case TYPE10_LAYOUT, ENTITY_PROPERTY_ENVELOPE, ENTITY_METHOD_ENVELOPE, ENTITY_LIFECYCLE_LAYOUT,
                    PARTICIPANT_MAPPING, TYPE14_STREAM_CLOSE, SETTLEMENT_SCHEMA,
                    HP_POSITIVE_VALUE, PROP_TURRET_YAW,
                    // 11.18 corpus（PR147 corpus = 11.18/11.19，random-battle-example.wotbreplay 即 11.18）
                    // 独立证明：entityTypeId==2 vehicle materialization（Type5 物化）与 FFFD 死亡终态。
                    TERMINAL_FFFD, ENTITY_TYPE_ID_SEMANTIC -> true;
            case TERMINAL_FFFE, METHOD_SEMANTICS, METHOD36_AIM_RAY,
                    METHOD38_SHOT_RESULT, TYPE31_GUN_MARKER, TYPE35_SESSION_DECISECOND,
                    TYPE32_CONSUMABLE_LIFECYCLE, AMMO_SELECTION -> false;
        };
    }

    /** 仅 deliberate 结构前向 capability（Layer B 结构布局 + 正 HP 结构值）对 future 给 STRUCTURALLY_COMPATIBLE。 */
    private static boolean forwardCompatible(final Capability capability) {
        return switch (capability) {
            case TYPE10_LAYOUT, ENTITY_PROPERTY_ENVELOPE, ENTITY_METHOD_ENVELOPE, ENTITY_LIFECYCLE_LAYOUT,
                    TYPE14_STREAM_CLOSE, HP_POSITIVE_VALUE -> true;
            case PARTICIPANT_MAPPING, SETTLEMENT_SCHEMA, PROP_TURRET_YAW, TERMINAL_FFFD, TERMINAL_FFFE,
                    ENTITY_TYPE_ID_SEMANTIC, METHOD_SEMANTICS, METHOD36_AIM_RAY, METHOD38_SHOT_RESULT,
                    TYPE31_GUN_MARKER, TYPE35_SESSION_DECISECOND,
                    TYPE32_CONSUMABLE_LIFECYCLE, AMMO_SELECTION -> false;
        };
    }

    // Decoder-local evidence queries. These are intentionally kept next to the capability evidence
    // matrix; callers must choose the capability that matches their packet shape or closed semantic.
    public static boolean closedSemanticsAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.METHOD_SEMANTICS) == Level.VERIFIED;
    }

    public static boolean type10LayoutAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.TYPE10_LAYOUT) != Level.UNKNOWN;
    }

    public static boolean basicVehiclePropertiesAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.ENTITY_PROPERTY_ENVELOPE) != Level.UNKNOWN;
    }

    public static boolean turretYawAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.PROP_TURRET_YAW) == Level.VERIFIED;
    }

    public static boolean methodLayoutAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.ENTITY_METHOD_ENVELOPE) != Level.UNKNOWN;
    }

    public static boolean methodSemanticAllowed(final String clientVersion, final int methodId) {
        return methodSemanticLevel(clientVersion, methodId) == Level.VERIFIED;
    }

    public static boolean methodSemanticsAllowed(final String clientVersion) {
        return closedSemanticsAllowed(clientVersion);
    }

    public static boolean participantMappingLayoutAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.PARTICIPANT_MAPPING) == Level.VERIFIED;
    }

    public static boolean damageLayoutAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.ENTITY_METHOD_ENVELOPE) == Level.VERIFIED;
    }

    public static boolean entityLifecycleLayoutAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.ENTITY_LIFECYCLE_LAYOUT) == Level.VERIFIED;
    }

    public static boolean positiveHpValueAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.HP_POSITIVE_VALUE) != Level.UNKNOWN;
    }

    public static boolean verifiedFffeTerminalAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.TERMINAL_FFFE) == Level.VERIFIED;
    }

    public static boolean method36Allowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.METHOD36_AIM_RAY) == Level.VERIFIED;
    }

    public static boolean method38Allowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.METHOD38_SHOT_RESULT) == Level.VERIFIED;
    }

    public static boolean gunMarkerAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.TYPE31_GUN_MARKER) == Level.VERIFIED;
    }

    public static boolean sessionDecisecondAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.TYPE35_SESSION_DECISECOND) == Level.VERIFIED;
    }

    public static boolean ammoSelectionAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.AMMO_SELECTION) == Level.VERIFIED;
    }

    public static boolean type32ConsumableLifecycleAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.TYPE32_CONSUMABLE_LIFECYCLE) == Level.VERIFIED;
    }

    public static boolean type14StreamCloseAllowed(final String clientVersion) {
        return levelOf(clientVersion, Capability.TYPE14_STREAM_CLOSE) != Level.UNKNOWN;
    }
}

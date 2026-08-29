package com.wotb.core.replay.decoder;

import com.wotb.core.parse.ReplayVersionFamily;

/**
 * Replay protocol version capability facade (delegates to {@link ReplayProtocolProfile}).
 *
 * <p>This is <b>not</b> a client-version allowlist. Each capability decides its own future policy
 * (see {@link ReplayProtocolProfile#levelOf}). A future version keeps decoding container/framing and the
 * deliberately forward-compatible structural surfaces (Type10 49B, generic Type7/Type8 envelope, ordinary
 * positive HP), while:
 * <ul>
 *   <li>entity-lifecycle (Type4/5/33) <b>fails closed</b> for future versions — there is currently no
 *       reliable version-independent invariant, so {@code entityLifecycleLayoutAllowed} requires VERIFIED;</li>
 *   <li>closed numeric semantics (sentinels / enums / bit-masks / cause-codes / method identity / prop2
 *       turret yaw / settlement field-number identity) degrade to {@code RAW/UNKNOWN}.</li>
 * </ul>
 * </p>
 *
 * <p>There is no global rule that "future keeps all structural capabilities": each gate consults its own
 * capability level, so capability can be forward-compatible (STRUCTURALLY_COMPATIBLE) or fail-closed
 * (UNKNOWN) as its evidence dictates.</p>
 */
public final class ReplayVersionGate {

    private ReplayVersionGate() {
    }

    /** PR147 closed numeric semantics (method36/38, Type31/39, AMMO select, TURRET yaw, shot bits): current family only. */
    public static boolean closedSemanticsAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.METHOD_SEMANTICS) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** Type10 49-byte transform layout: forward-compatible structural (shape-validated). */
    public static boolean type10LayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.TYPE10_LAYOUT) != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /** Vehicle EntityProperty envelope + prop2/prop3 structural decode: forward-compatible. */
    public static boolean basicVehiclePropertiesAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.ENTITY_PROPERTY_ENVELOPE)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /**
     * PR162/P0-2：prop2 turret-relative yaw 的<b>语义</b>（u16 * 360/65536 - 180°）只由
     * {@code PROP_TURRET_YAW} capability 授权。generic Type7 envelope（entityId/propId/valueLen/rawValue）
     * 只是结构可解析；future 版本不得因 envelope STRUCTURALLY_COMPATIBLE 就自动把 prop2 当 turret yaw。
     */
    public static boolean turretYawAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.PROP_TURRET_YAW) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** EntityMethod envelope + observed method layouts: forward-compatible structural. */
    public static boolean methodLayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.ENTITY_METHOD_ENVELOPE)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /**
     * PR162/P0-2：EntityMethod 的<b>语义</b>（method0/1/5/17/20/27/29 → 对应 semantic event）只在
     * canonical/legacy <b>VERIFIED family</b> 上被认可为 EXACT。future（STRUCTURALLY_COMPATIBLE）版本：
     * 只有 envelope 结构可前向读取（entityId/methodId/argLen/rawArgs），而 numeric method identity 与
     * method-specific args semantic 属 closed/version-scoped —— 未认证即 raw-preserve，不得无条件承接
     * 当前版本 EXACT semantic。
     */
    /**
     * PR162/P1-6：EntityMethod numeric semantic 只由 <b>单一</b> authority
     * {@link ReplayProtocolProfile#methodSemanticLevel} 决定 —— 本方法只是转发，不在这里维护版本/方法矩阵。
     */
    public static boolean methodSemanticAllowed(final String clientVersion, final int methodId) {
        return ReplayProtocolProfile.methodSemanticLevel(clientVersion, methodId)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** EntityMethod closed numeric semantics (winner/finish, damage, updateArena): current family only. */
    public static boolean methodSemanticsAllowed(final String clientVersion) {
        return closedSemanticsAllowed(clientVersion);
    }

    /**
     * Subtype48 updateArena2 participant-mapping (roster wrapper=1) + ARENA_PERIOD (wrapper=3) are
     * <b>structural</b> layout facts proven for the verified families (11.18 + 11.19): decoding the roster
     * maps entity→account and the BATTLE period anchor resolves the battle-relative clock, both essential
     * for 11.18 fixtures. Unverified future versions still raw-preserve (PARTICIPANT_MAPPING is not
     * fixture-proven forward-compatible), so this gate is {@code Level#VERIFIED} (verified family), never
     * a version if/else. Only the closed-semantic supremacy-points value stays 11.19-only.
     */
    public static boolean participantMappingLayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.PARTICIPANT_MAPPING)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /**
     * Subtype8 damage-method layout is proven for the verified families (11.18 + 11.19): the attacker /
     * victim / raw damage value / timing are decoded as a structural observation frame (the raw value is
     * non-authoritative — authoritative HP loss comes from Type7 prop3 deltas). It is not fixture-proven
     * forward-compatible, so it raw-preserves for unverified future versions (Level#VERIFIED, never a
     * version if/else). The closed-semantic interpretation stays separate.
     */
    public static boolean damageLayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.ENTITY_METHOD_ENVELOPE)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /**
     * PR162/P1-5: Entity-lifecycle (Type4 leave / Type5 materialization / Type33) numeric layout is
     * version-scoped class semantic (entityTypeId). Currently no independent version-invariant structural
     * predicate exists to prove a future Type5 shape is still the same materialization structure, so future
     * versions FAIL CLOSED (raw-preserve) rather than producing an EXACT MaterializationEvent.
     */
    public static boolean entityLifecycleLayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.ENTITY_LIFECYCLE_LAYOUT)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** Ordinary positive HP structural value: proven for verified + legacy, forward-compatible otherwise. */
    public static boolean positiveHpValueAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.HP_POSITIVE_VALUE)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /** Current-version verified 0xFFFE terminal classification: current family only. */
    public static boolean verifiedFffeTerminalAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.TERMINAL_FFFE) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** PR162/P0-3：method36 targeting/snapshot 语义只由 {@code METHOD36_AIM_RAY} capability 授权（非统一 closed gate）。 */
    public static boolean method36Allowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.METHOD36_AIM_RAY) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** PR162/P0-3：method38 shot-result 语义只由 {@code METHOD38_SHOT_RESULT} capability 授权。 */
    public static boolean method38Allowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.METHOD38_SHOT_RESULT) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** PR162/P0-3：Type31 gun-marker 语义只由 {@code TYPE31_GUN_MARKER} capability 授权。 */
    public static boolean gunMarkerAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.TYPE31_GUN_MARKER) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** PR162/P0-3：Type35 session-decisecond 语义只由 {@code TYPE35_SESSION_DECISECOND} capability 授权。 */
    public static boolean sessionDecisecondAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.TYPE35_SESSION_DECISECOND) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** PR162/P0-3：ammunition-selection 语义只由 {@code AMMO_SELECTION} capability 授权。 */
    public static boolean ammoSelectionAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.AMMO_SELECTION) == ReplayProtocolProfile.Level.VERIFIED;
    }

    /**
     * Type32 consumable-lifecycle semantic (wireCode→identity, state/clock/param layout) is a
     * 11.19-era closed numeric mapping (consumable-lifecycle.md). Independent 11.18 evidence is absent
     * ("validate code stability outside 11.19 China" is flagged remaining work), so legacy/future
     * versions fail closed → only the generic auxiliary-blob envelope is decoded, never an unproven
     * consumable identity. This is a per-capability gate, never a blanket if/else.
     */
    public static boolean type32ConsumableLifecycleAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion,
                ReplayProtocolProfile.Capability.TYPE32_CONSUMABLE_LIFECYCLE)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /**
     * Type14 packet-stream end/stop marker: a Layer B structural invariant (container/framing), so it is
     * VERIFIED for the verified families and STRUCTURALLY_COMPATIBLE for any shape-compatible version; only
     * a profile {@code UNKNOWN} (never for a structural capability) would raw-preserve. Wired here so the
     * capability/profile is actually consulted rather than the decoder unconditionally decoding Type14.
     */
    public static boolean type14StreamCloseAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.TYPE14_STREAM_CLOSE)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }
}

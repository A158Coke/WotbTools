package com.wotb.core.replay.decoder;

/**
 * Replay protocol version capability facade (delegates to {@link ReplayProtocolProfile}).
 *
 * <p>This is <b>not</b> a client-version allowlist. The structurally-proven layouts are forward-compatible
 * (see {@link ReplayProtocolProfile.Level#STRUCTURALLY_COMPATIBLE}); only version-scoped closed numeric
 * semantics (sentinels / enums / bit-masks / cause-codes) remain strictly evidence-gated. A future version
 * therefore keeps decoding container/framing, Type10 layout, EntityProperty envelope, entity lifecycle
 * layout and EntityMethod envelopes, while its unverified closed semantics degrade to {@code RAW/UNKNOWN}.</p>
 *
 * <p><b>Structural</b> entry points return {@code true} whenever the level is not {@code UNKNOWN}
 * (i.e. VERIFIED or STRUCTURALLY_COMPATIBLE) — the decoder still validates the exact shape, so a shape
 * mismatch falls back to UNKNOWN, and the version number never alone blocks a stable layout.</p>
 */
public final class ReplayVersionGate {

    private ReplayVersionGate() {
    }

    /** PR147 closed numeric semantics (method36/38, Type31/39, AMMO select, TURRET yaw, shot bits): current family only. */
    public static boolean closedSemanticsAllowed(final String clientVersion) {
        return ReplayProtocolProfile.closedSemanticLevel(clientVersion)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** Type10 49-byte transform layout: forward-compatible structural (shape-validated). */
    public static boolean type10LayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.structuralLevel(clientVersion)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /** Vehicle EntityProperty envelope + prop2/prop3 structural decode: forward-compatible. */
    public static boolean basicVehiclePropertiesAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.ENTITY_PROPERTY_ENVELOPE)
                != ReplayProtocolProfile.Level.UNKNOWN;
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
    public static boolean methodLayoutAffirmed(final String clientVersion) {
        return ReplayProtocolProfile.structuralLevel(clientVersion)
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
        return ReplayProtocolProfile.structuralLevel(clientVersion)
                == ReplayProtocolProfile.Level.VERIFIED;
    }

    /** Entity-lifecycle observer layout (Type4 leave / Type5 materialization / Type33: forward-compatible structural. */
    public static boolean entityLifecycleLayoutAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.ENTITY_LIFECYCLE_LAYOUT)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /** Ordinary positive HP structural value: proven for verified + legacy, forward-compatible otherwise. */
    public static boolean positiveHpValueAllowed(final String clientVersion) {
        return ReplayProtocolProfile.levelOf(clientVersion, ReplayProtocolProfile.Capability.HP_POSITIVE_VALUE)
                != ReplayProtocolProfile.Level.UNKNOWN;
    }

    /** Current-version verified 0xFFFE terminal classification: current family only. */
    public static boolean verifiedFffeTerminalAllowed(final String clientVersion) {
        return closedSemanticsAllowed(clientVersion);
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

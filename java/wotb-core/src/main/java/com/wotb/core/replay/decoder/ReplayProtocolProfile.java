package com.wotb.core.replay.decoder;

import java.util.Locale;

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

    private static final String CURRENT_VERIFIED_FAMILY = "11.19.0_china";
    private static final String LEGACY_VERIFIED_FAMILY = "11.18.0_china";

    private ReplayProtocolProfile() {
    }

    /** Level of a structural (Layer B) capability: VERIFIED for known families, STRUCTURALLY_COMPATIBLE otherwise. */
    public static Level structuralLevel(final String clientVersion) {
        final String f = familyOf(clientVersion);
        return (CURRENT_VERIFIED_FAMILY.equals(f) || LEGACY_VERIFIED_FAMILY.equals(f))
                ? Level.VERIFIED : Level.STRUCTURALLY_COMPATIBLE;
    }

    /** Level of a closed (Layer C) numeric-semantic capability: VERIFIED only for the current 11.19 family. */
    public static Level closedSemanticLevel(final String clientVersion) {
        return CURRENT_VERIFIED_FAMILY.equals(familyOf(clientVersion))
                ? Level.VERIFIED : Level.UNKNOWN;
    }

    /** Per-capability level resolution (single entry point for decoders/tests). */
    public static Level levelOf(final String clientVersion, final Capability capability) {
        return switch (capability) {
            case TYPE10_LAYOUT, ENTITY_PROPERTY_ENVELOPE, ENTITY_METHOD_ENVELOPE, ENTITY_LIFECYCLE_LAYOUT,
                    PARTICIPANT_MAPPING, TYPE14_STREAM_CLOSE, SETTLEMENT_SCHEMA -> structuralLevel(clientVersion);
            case HP_POSITIVE_VALUE ->
                    // ordinary positive HP is a structural value (recovered from the u16 envelope); the
                    // special sentinels are separate capabilities. Proven for the verified + legacy
                    // families; STRUCTURALLY_COMPATIBLE (exact-shape) for other versions.
                    (isCurrent(clientVersion) || isLegacy(clientVersion))
                            ? Level.VERIFIED : Level.STRUCTURALLY_COMPATIBLE;
            case TERMINAL_FFFD ->
                    // FFFD death terminal proven for 11.19 + 11.18 legacy fixtures; never inherited by future.
                    (isCurrent(clientVersion) || isLegacy(clientVersion))
                            ? Level.VERIFIED : Level.UNKNOWN;
            case TERMINAL_FFFE, METHOD_SEMANTICS, PROP_TURRET_YAW, METHOD36_AIM_RAY, METHOD38_SHOT_RESULT,
                    TYPE31_GUN_MARKER, TYPE35_SESSION_DECISECOND, AMMO_SELECTION -> closedSemanticLevel(clientVersion);
        };
    }

    private static boolean isCurrent(final String clientVersion) {
        return CURRENT_VERIFIED_FAMILY.equals(familyOf(clientVersion));
    }

    private static boolean isLegacy(final String clientVersion) {
        return LEGACY_VERIFIED_FAMILY.equals(familyOf(clientVersion));
    }

    private static String familyOf(final String clientVersion) {
        final String v = clientVersion == null ? "" : clientVersion.trim().toLowerCase(Locale.ROOT);
        if (familyMatches(v, CURRENT_VERIFIED_FAMILY)) {
            return CURRENT_VERIFIED_FAMILY;
        }
        if (familyMatches(v, LEGACY_VERIFIED_FAMILY)) {
            return LEGACY_VERIFIED_FAMILY;
        }
        return v;
    }

    /** Boundary-safe family match: exact version or {@code family + "_"} (e.g. {@code 11.19.0_china_apple}). */
    private static boolean familyMatches(final String v, final String family) {
        return v.equals(family) || v.startsWith(family + "_");
    }
}

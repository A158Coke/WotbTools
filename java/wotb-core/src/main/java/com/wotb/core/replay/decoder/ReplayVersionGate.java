package com.wotb.core.replay.decoder;

import java.util.Locale;

/**
 * Replay protocol version capabilities.
 *
 * <p>PR147 closed numeric semantics are current-version scoped. A small set of basic 11.18 surfaces
 * remains explicitly legacy-compatible because repository fixtures independently proved those layouts;
 * that compatibility must never be generalized to unknown/future versions.</p>
 */
public final class ReplayVersionGate {

    private static final String[] CURRENT_PREFIXES = {"11.19.0_china"};
    private static final String[] LEGACY_BASIC_PREFIXES = {"11.18.0_china"};

    private ReplayVersionGate() {
    }

    /** PR147 closed semantics: method36/38, Type31/39 and other current-only numeric meanings. */
    public static boolean closedSemanticsAllowed(final String clientVersion) {
        final String v = normalize(clientVersion);
        return v != null && matches(v, CURRENT_PREFIXES);
    }

    /** Type10 49-byte transform layout independently retained for current + explicit 11.18 legacy fixtures. */
    public static boolean type10LayoutAllowed(final String clientVersion) {
        final String v = normalize(clientVersion);
        return v != null && (matches(v, CURRENT_PREFIXES) || matches(v, LEGACY_BASIC_PREFIXES));
    }

    /** Vehicle EntityProperty envelope + prop2/prop3 basics, explicitly current + proved 11.18 legacy only. */
    public static boolean basicVehiclePropertiesAllowed(final String clientVersion) {
        final String v = normalize(clientVersion);
        return v != null && (matches(v, CURRENT_PREFIXES) || matches(v, LEGACY_BASIC_PREFIXES));
    }

    /** EntityMethod envelope + method0/1/5/17/20/27/29 observed layouts: current + proved 11.18 legacy only. */
    public static boolean methodLayoutAllowed(final String clientVersion) {
        final String v = normalize(clientVersion);
        return v != null && (matches(v, CURRENT_PREFIXES) || matches(v, LEGACY_BASIC_PREFIXES));
    }

    /** Whether the current-version 0xFFFE terminal classification may be used. */
    public static boolean verifiedFffeTerminalAllowed(final String clientVersion) {
        return closedSemanticsAllowed(clientVersion);
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
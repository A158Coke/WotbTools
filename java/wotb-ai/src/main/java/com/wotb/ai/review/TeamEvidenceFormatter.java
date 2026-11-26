package com.wotb.ai.review;

import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.util.PromptDataQuoter;

import java.util.Locale;

final class TeamEvidenceFormatter {
    private TeamEvidenceFormatter() {
    }

    static String formatScalar(final Object value) {
        if (value == null) {
            return "UNKNOWN";
        }
        if (value instanceof Number number
                && !Double.isFinite(number.doubleValue())) {
            return "UNKNOWN";
        }
        return String.valueOf(value);
    }

    static String quoteData(final Object value) {
        return PromptDataQuoter.quote(value, "UNKNOWN");
    }

    static String resolveMapName(final String mapCode) {
        return ReplayDisplayNames.mapName(mapCode);
    }

    static String format(final double value) {
        return String.format(Locale.ROOT, "%.1f", value);
    }

    static String formatNullable(final Double value) {
        return value == null || !Double.isFinite(value)
                ? "UNKNOWN" : format(value);
    }
}

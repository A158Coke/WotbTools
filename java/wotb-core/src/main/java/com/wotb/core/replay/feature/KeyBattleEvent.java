package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import org.springframework.util.StringUtils;

import java.util.List;

public record KeyBattleEvent(
        float clockSec,
        String type,
        String label,
        DecodeConfidence confidence,
        String source,
        List<Integer> relatedEntityIds
) {

    public KeyBattleEvent {
        if (!Float.isFinite(clockSec) || clockSec < 0) throw new IllegalArgumentException("clockSec invalid: " + clockSec);
        if (!StringUtils.hasText(type)) throw new IllegalArgumentException("type must not be null/blank");
        if (!StringUtils.hasText(label)) throw new IllegalArgumentException("label must not be null/blank");
        if (confidence == null) confidence = DecodeConfidence.UNKNOWN;
        if (source == null) source = "UNKNOWN";
        relatedEntityIds = relatedEntityIds == null ? List.of() : List.copyOf(relatedEntityIds);
    }

    public KeyBattleEvent(final float clockSec, final String type, final String label) {
        this(clockSec, type, label, DecodeConfidence.INFERRED, "LEGACY", List.of());
    }
}

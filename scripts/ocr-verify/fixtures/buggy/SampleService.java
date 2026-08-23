package com.wotb.verify;

import java.util.HashMap;
import java.util.Map;

/**
 * Controlled OCR verification fixture — contains a deliberate NPE bug.
 * Used by scripts/ocr-verify/verify-ocr.ps1 (Case 1: normal bug detection).
 */
public final class SampleService {
    private final Map<String, Integer> scores = new HashMap<>();

    public void recordScore(String player, int score) {
        scores.put(player, score);
    }

    /**
     * BUG: Integer autobox -> unboxing NPE when player has no recorded score.
     */
    public int getScore(String player) {
        Integer stored = scores.get(player); // null when absent
        return stored + 1;                  // NPE on absent player
    }
}

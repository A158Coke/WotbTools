package com.wotb.verify;

import java.util.HashMap;
import java.util.Map;

/**
 * Controlled OCR verification fixture — correct baseline (Case 5 base).
 */
public final class SampleService {
    private final Map<String, Integer> scores = new HashMap<>();

    public void recordScore(String player, int score) {
        scores.put(player, score);
    }

    public int getScore(String player) {
        return scores.getOrDefault(player, 0) + 1;
    }
}

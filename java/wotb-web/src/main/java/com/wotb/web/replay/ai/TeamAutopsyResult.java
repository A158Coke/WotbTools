package com.wotb.web.replay.ai;

import java.util.List;

/**
 * Team Autopsy（第 3 次调用）的结构化输出契约。
 * <p>判负 → {@code biggestLiabilities}（战犯，≥1，可多人）；判胜 → {@code mvps}（≥1）。
 * 每条结论必须带 evidence 与 confidence；无法可靠归因时 confidence 为 PARTIAL/UNKNOWN。</p>
 */
public record TeamAutopsyResult(
        List<AutopsyPlayer> players,
        List<AutopsyVerdict> mvps,
        List<AutopsyVerdict> biggestLiabilities,
        List<String> limitations
) {
    public TeamAutopsyResult {
        players = players == null ? List.of() : List.copyOf(players);
        mvps = mvps == null ? List.of() : List.copyOf(mvps);
        biggestLiabilities = biggestLiabilities == null
                ? List.of() : List.copyOf(biggestLiabilities);
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }

    public record AutopsyPlayer(String tank, String contribution, String confidence) {
    }

    public record AutopsyVerdict(
            String tank,
            String reason,
            List<String> evidence,
            String confidence
    ) {
        public AutopsyVerdict {
            evidence = evidence == null ? List.of() : List.copyOf(evidence);
        }
    }
}

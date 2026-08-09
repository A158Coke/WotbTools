package com.wotb.web.replay.ai;

import java.util.List;

/**
 * Team Autopsy（第 3 次调用）的结构化输出契约。
 * <p>判负 → {@code biggestLiabilities}（战犯，≥1，可多人）；判胜 → {@code mvps}（≥1）。
 * 所有玩家与 verdict 通过 {@code playerKey}（P1..P7）引用后端 roster，禁止使用坦克/昵称做身份键；
 * 最终渲染由后端按 playerKey 回查权威 nickname/tankName，不信任 LLM 返回的名称。</p>
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

    public record AutopsyPlayer(String playerKey, String contribution, String confidence) {
    }

    public record AutopsyVerdict(
            String playerKey,
            String reason,
            List<String> evidence,
            String confidence
    ) {
        public AutopsyVerdict {
            evidence = evidence == null ? List.of() : List.copyOf(evidence);
        }
    }
}

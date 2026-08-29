package com.wotb.web.replay.ai;

import java.util.List;

/**
 * Team Autopsy（team perspective 结算级 TEAM_AUTOPSY）的结构化输出契约。
 * <p>判负 → {@code biggestLiabilities}（渲染为「重点复查」，允许为空，可多人）；判胜 → {@code mvps}（渲染为「高贡献者」，允许为空）。
 * 所有玩家与 verdict 通过 {@code playerKey}（P1..P7）引用后端 roster，禁止使用坦克/昵称做身份键；
 * 最终渲染由后端按 playerKey 回查权威 nickname/tankName，不信任 LLM 返回的名称；playerKey 仅作
 * 内部 lookup，绝不进入用户可见正文。两者均为空 → 无 standout，
 * 渲染为空串（不输出 header/胜负/逐人贡献）。</p>
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
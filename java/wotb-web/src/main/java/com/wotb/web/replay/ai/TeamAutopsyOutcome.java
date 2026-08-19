package com.wotb.web.replay.ai;

import com.wotb.core.replay.feature.TeamAutopsyStats;

import java.util.List;

/**
 * Team Autopsy 成功结果 + 本方 roster（供最终渲染按 playerKey 回查权威昵称/坦克名）。
 */
public record TeamAutopsyOutcome(
        TeamAutopsyResult result,
        List<TeamAutopsyStats> roster
) {
    public TeamAutopsyOutcome {
        roster = roster == null ? List.of() : List.copyOf(roster);
    }
}

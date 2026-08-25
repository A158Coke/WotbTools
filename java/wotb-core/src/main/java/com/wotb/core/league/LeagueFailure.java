package com.wotb.core.league;

/** 一场训练赛/联赛回放的完整性校验失败（稳定英文错误码，前端三语映射）。 */
public record LeagueFailure(
        String fileName,
        String arenaId,
        String code) {

    /** 该失败应用到指定文件名（校验阶段尚未绑定文件名时使用）。 */
    public LeagueFailure withFileName(final String name) {
        return new LeagueFailure(name, arenaId, code);
    }

    /** 校验失败稳定错误码（与前端 api_errors / 文档契约一致）。 */
    public static final class Code {
        public static final String ARENA_ID_MISSING = "LEAGUE_ARENA_ID_MISSING";
        public static final String NOT_SEVEN_VS_SEVEN = "LEAGUE_NOT_SEVEN_VS_SEVEN";
        public static final String INVALID_TEAM = "LEAGUE_INVALID_TEAM";
        public static final String DUPLICATE_ACCOUNT_ID = "LEAGUE_DUPLICATE_ACCOUNT_ID";
        public static final String MISSING_TANK = "LEAGUE_MISSING_TANK";
        public static final String ROSTER_INCOMPLETE = "LEAGUE_ROSTER_INCOMPLETE";
        public static final String NO_DECISIVE_WINNER = "LEAGUE_NO_DECISIVE_WINNER";
        public static final String INVALID_STAT_FACTS = "LEAGUE_INVALID_STAT_FACTS";
        public static final String CONFLICTING_REPLAYS_FOR_ARENA = "CONFLICTING_REPLAYS_FOR_ARENA";

        private Code() {
        }
    }
}

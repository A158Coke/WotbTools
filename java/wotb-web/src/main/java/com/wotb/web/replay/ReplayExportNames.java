package com.wotb.web.replay;

import com.wotb.core.league.LeagueRatingMode;

/**
 * Replay XLSX 导出文件名规则（同步 ReplayService / 异步 ReplayExportJobService /
 * Processing result 复用路径共用同一契约，禁止散落字符串字面量）。
 *
 * <pre>
 * single any mode:  &lt;replay source name&gt;.xlsx
 * multi pure CW:    联赛汇总.xlsx
 * multi Standard:   回放汇总.xlsx
 * multi Mixed:      回放汇总.xlsx
 * </pre>
 */
public final class ReplayExportNames {

    /** 多场纯 League Rating（CW）汇总文件名。 */
    public static final String LEAGUE_AGGREGATE = "联赛汇总.xlsx";

    /** 多场 Standard / Mixed 汇总文件名（Replay Aggregate 不依赖 League Rating）。 */
    public static final String STANDARD_AGGREGATE = "回放汇总.xlsx";

    private ReplayExportNames() {
    }

    /** 多场汇总文件名：纯 League → {@link #LEAGUE_AGGREGATE}；Standard / Mixed → {@link #STANDARD_AGGREGATE}。 */
    public static String aggregate(final LeagueRatingMode mode) {
        return mode == LeagueRatingMode.LEAGUE_RATING ? LEAGUE_AGGREGATE : STANDARD_AGGREGATE;
    }
}

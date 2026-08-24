package com.wotb.web.replay.dto;

import java.util.List;

/**
 * /api/preview 的响应: 各场 + 汇总 + 去重/失败提示 + 列定义。
 * 单场玩家表已直接包含 Contribution / KAST / Impact（同一 PerformanceMetricsCalculator
 * 公式、同一 authoritative Battle/PlayerResult facts）；汇总表包含跨场 Contribution /
 * KAST / Impact / 多伤率 / 互换击杀。不再有独立「战斗表现」模块/字段。
 *
 * <p>League Rating 模式（训练赛/联赛回放）：{@code league} 携带 Rating 元数据与汇总；
 * 普通模式 {@code league=null}（契约兼容）。League 模式下 playerColumns/aggregateColumns
 * 由服务端调整为不含 contribution/kast/impact、包含 Rating 维度列。</p>
 *
 * <p>混合批次（普通 + 训练赛/联赛混传）：{@code leagueUnavailableCode} 携带
 * {@code MIXED_LEAGUE_AND_STANDARD_REPLAYS}（League Rating 不聚合混合批次；battles 仍按
 * 普通回放语义成功返回，plan §21）；其余场景为 null。</p>
 *
 * <p>{@code leagueMode} 与 {@code league} 是<b>两个独立状态</b>（review PR#134 BLOCKER 3）：
 * {@code leagueMode=true} = 这是 CW UI（CW 列契约 / Player Drawer / sticky pair /
 * Performance metrics 可用 / Rating 列可存在），由批次模式（训练赛/联赛）决定；
 * {@code league} 仅决定本场/批次是否有 League Rating 结果（Rating-ineligible 场次
 * league=null 但 leagueMode 仍为 true，Rating/七维显示 "--"）。禁止用 league != null 推断 CW。</p>
 */
public record PreviewResponse(List<BattleDto> battles,
                              List<AggRow> aggregate,
                              List<String[]> duplicates,
                              List<String[]> failures,
                              List<ColumnDef> playerColumns,
                              List<ColumnDef> aggregateColumns,
                              LeagueRatingDto league,
                              String leagueUnavailableCode,
                              boolean leagueMode) {
}

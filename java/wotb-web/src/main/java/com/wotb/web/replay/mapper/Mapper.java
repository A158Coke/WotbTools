package com.wotb.web.replay.mapper;

import com.wotb.core.AggregateColumns;
import com.wotb.core.Columns;
import com.wotb.core.league.LeagueColumns;
import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.league.LeagueRatingBatchAggregator;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.PlayerLeagueRating;
import com.wotb.core.league.PlayerLeagueSummary;
import com.wotb.core.league.PlayerVehicleUsage;
import com.wotb.core.league.TeamLeagueRating;
import com.wotb.core.league.TeamLeagueSummary;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import com.wotb.core.stats.Aggregator;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.core.stats.Players;
import com.wotb.web.replay.dto.AggRow;
import com.wotb.web.replay.dto.BattleDto;
import com.wotb.web.replay.dto.ColumnDef;
import com.wotb.web.replay.dto.LeagueBattleDto;
import com.wotb.web.replay.dto.LeagueColumnDef;
import com.wotb.web.replay.dto.LeagueFailureDto;
import com.wotb.web.replay.dto.LeaguePlayerSummaryDto;
import com.wotb.web.replay.dto.LeagueRatingDto;
import com.wotb.web.replay.dto.LeagueRatingQualityDto;
import com.wotb.web.replay.dto.LeagueTeamDto;
import com.wotb.web.replay.dto.LeagueTeamSummaryDto;
import com.wotb.web.replay.dto.LeagueVehicleUsageDto;
import com.wotb.web.replay.dto.PlayerRow;
import com.wotb.web.replay.dto.PreviewResponse;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** model -> 前端 DTO（复用 core 列 key；展示值转换为稳定英文码）。 */
public final class Mapper {

    private Mapper() {
    }

    /** 玩家表列定义 (纯数据: key + 是否数值; 中文名由前端映射)。 */
    public static List<ColumnDef> playerColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        for (final Columns.Column c : Columns.PLAYER) {
            out.add(new ColumnDef(c.key(), c.num()));
        }
        return out;
    }

    /** 汇总表列定义：消费 canonical {@link AggregateColumns}（key/numeric/getter 单一事实源，
     * 与 Excel AggregateSheets 共用；本层不维护平行 schema）。 */
    public static List<ColumnDef> aggregateColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        for (final AggregateColumns.CoreColumn c : AggregateColumns.CORE) {
            out.add(new ColumnDef(c.key(), c.numeric()));
        }
        for (final AggregateColumns.PerfColumn c : AggregateColumns.PERFORMANCE) {
            out.add(new ColumnDef(c.key(), c.numeric()));
        }
        return out;
    }

    // ---- League Rating 列定义（key 单一来源 LeagueColumns；显示名前端三语 / 导出中文） ----

    /** League 模式单场玩家列：标准列（含 contribution/kast/impact，Performance Metrics 保留在 CW）
     * + Rating 维度 + 占点原始字段（contribution/kast/impact 是 Replay Performance Metrics，
     * 不是 League Rating 维度，必须保留在 CW 单场表，不得进入七维 Rating/Radar）。 */
    public static List<ColumnDef> leaguePlayerColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        out.add(new ColumnDef("nickname", false));
        out.add(new ColumnDef(LeagueColumns.RATING, true));
        for (final Columns.Column c : Columns.PLAYER) {
            if (c.key().equals("nickname")) {
                continue;
            }
            out.add(new ColumnDef(c.key(), c.num()));
        }
        for (final String key : LeagueColumns.DIM_KEYS) {
            out.add(new ColumnDef(key, true));
        }
        out.add(new ColumnDef(LeagueColumns.VICTORY_POINTS_EARNED, true));
        // victory_points_seized 保留为 backend fact，CW Rating 主 UI 不展示
        return out;
    }

    /** Rating 列元数据（固定/满分/默认可见/分组）。 */
    public static List<LeagueColumnDef> leagueColumnDefs() {
        final List<LeagueColumnDef> out = new ArrayList<>();
        out.add(new LeagueColumnDef(LeagueColumns.RATING, true,
                PlayerLeagueRating.MAX_FINAL, true, true, "rating"));
        for (int d = 0; d < LeagueColumns.DIM_KEYS.size(); d++) {
            out.add(new LeagueColumnDef(LeagueColumns.dimKey(d), true,
                    LeagueColumns.dimMax(d), false, false, "rating"));
        }
        out.add(new LeagueColumnDef(LeagueColumns.VICTORY_POINTS_EARNED, true, 0, false, false, "battle"));
        // victory_points_seized 不进入 Rating 列系统（backend fact 保留，UI 不展示）
        return out;
    }

    /** League 模式汇总列：标准汇总列完整保留（含跨场 contribution/kast/impact；
     * Performance Metrics 属于 Replay 数据，CW 汇总表必须可显示）。 */
    public static List<ColumnDef> leagueAggregateColumns() {
        return aggregateColumns();
    }

    /** League 批次选手汇总列。 */
    public static List<ColumnDef> leaguePlayerSummaryColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        out.add(new ColumnDef("nickname", false));
        out.add(new ColumnDef("clan", false));
        out.add(new ColumnDef("battles", true));
        // 评分场次（rated-only 样本，与 Replay Aggregate 的解析场次 battles 分开）
        out.add(new ColumnDef("rated_battles", true));
        out.add(new ColumnDef(LeagueColumns.RATING, true));
        // V5 explainability：Raw Observed Median（默认可隐藏，非主 Rating）
        out.add(new ColumnDef(LeagueColumns.RATING_RAW_MEDIAN, true));
        for (final String key : LeagueColumns.DIM_KEYS) {
            out.add(new ColumnDef(key, true));
        }
        out.add(new ColumnDef("mvp_count", true));
        out.add(new ColumnDef("wins", true));
        out.add(new ColumnDef("damage_total", true));
        out.add(new ColumnDef("assist_total", true));
        out.add(new ColumnDef("kills_total", true));
        // 跨场 Performance Metrics（与 resp.aggregate 同一全部已解析场次样本）
        out.add(new ColumnDef("contribution", true));
        out.add(new ColumnDef("kast", true));
        out.add(new ColumnDef("impact", true));
        return out;
    }

    /** League 批次战队汇总列。 */
    public static List<ColumnDef> leagueTeamSummaryColumns() {
        final List<ColumnDef> out = new ArrayList<>();
        out.add(new ColumnDef("team_name", false));
        out.add(new ColumnDef("battles", true));
        out.add(new ColumnDef(LeagueColumns.RATING, true));
        for (final String key : LeagueColumns.DIM_KEYS) {
            out.add(new ColumnDef(key, true));
        }
        out.add(new ColumnDef("wins", true));
        return out;
    }

    // ---- Battle / 单场 ----

    public static BattleDto toBattle(final Battle b, final String sourceName, final Tankopedia tp) {
        return toBattle(b, null, sourceName, tp, null, false);
    }

    /**
     * League 模式时注入 Rating 单元格与单场元数据（普通模式 league 参数为 null）。
     *
     * @param league    该场评分结果；Rating-ineligible 场次为 null（Battle 仍正常展示，
     *                  Rating 列留空——Replay validity and Rating eligibility are independent;
     *                  Rating-ineligible parsed battles remain valid Replay results）
     * @param leagueMode 整个批次是否为 League Rating 模式（决定是否注入 Rating 列元数据 /
     *                   CW UI 语义；contribution/kast/impact 保留；
     *                   Rating-ineligible 场次 league==null 但 leagueMode 仍为 true）
     */
    public static BattleDto toBattle(final Battle b, final String sourceName, final Tankopedia tp,
                                     final LeagueRatingResult league, final boolean leagueMode) {
        return toBattle(b, null, sourceName, tp, league, leagueMode);
    }

    /** Battle DTO mapping with the authoritative Processing source identity. */
    public static BattleDto toBattle(final Battle b, final String sourceId, final String sourceName,
                                     final Tankopedia tp, final LeagueRatingResult league,
                                     final boolean leagueMode) {
        final List<PlayerRow> rows = new ArrayList<>();
        final Map<Long, PlayerLeagueRating> leagueByAccount = new LinkedHashMap<>();
        if (league != null) {
            for (final PlayerLeagueRating plr : league.players()) {
                leagueByAccount.put(plr.accountId(), plr);
            }
        }
        for (final PlayerResult p : Players.sorted(b.players)) {
            Players.enrich(p, tp);
            final Map<String, Object> cells = new LinkedHashMap<>();
            for (final Columns.Column c : Columns.PLAYER) {
                // 单场 Performance Metrics（contribution/kast/impact）在 League 模式同样保留
                // （表现指标 ≠ Rating 维度；由调用方 populateBattle 回填）
                cells.put(c.key(), playerValue(c, p));
            }
            if (league != null) {
                final PlayerLeagueRating plr = leagueByAccount.get(p.accountId);
                if (plr != null) {
                    cells.put(LeagueColumns.RATING, r1(plr.finalRating()));
                    // 七维顺序单一来源：dimensionScores()（与 LeagueColumns.DIM_KEYS 严格一致）
                    for (int d = 0; d < LeagueColumns.DIM_KEYS.size(); d++) {
                        cells.put(LeagueColumns.dimKey(d), r1(plr.dimensionScores().get(d)));
                    }
                }
                cells.put(LeagueColumns.VICTORY_POINTS_EARNED, p.victoryPointsEarned);
                cells.put(LeagueColumns.VICTORY_POINTS_SEIZED, p.victoryPointsSeized);
            } else if (leagueMode) {
                // Rating-ineligible league 场次：占点原始字段是 battle facts，仍应输出
                cells.put(LeagueColumns.VICTORY_POINTS_EARNED, p.victoryPointsEarned);
                cells.put(LeagueColumns.VICTORY_POINTS_SEIZED, p.victoryPointsSeized);
            }
            rows.add(new PlayerRow(cells, p.team));
        }
        return new BattleDto(b.arenaId, b.mapName, b.version, b.durationS,
                b.startTime, b.winnerTeam, sourceId, sourceName, rows, leagueBattleDto(league, b));
    }

    private static LeagueBattleDto leagueBattleDto(final LeagueRatingResult league, final Battle battle) {
        if (league == null) {
            return null;
        }
        return new LeagueBattleDto(
                league.mvp() == null ? "" : league.mvp().nickname(),
                league.mvp() == null ? 0 : league.mvp().accountId(),
                league.team1() == null || league.team1().teamBest() == null
                        ? "" : league.team1().teamBest().nickname(),
                league.team1() == null || league.team1().teamBest() == null
                        ? 0 : league.team1().teamBest().accountId(),
                league.team2() == null || league.team2().teamBest() == null
                        ? "" : league.team2().teamBest().nickname(),
                league.team2() == null || league.team2().teamBest() == null
                        ? 0 : league.team2().teamBest().accountId(),
                leagueTeamDto(league.team1(), battle),
                leagueTeamDto(league.team2(), battle));
    }

    private static LeagueTeamDto leagueTeamDto(final TeamLeagueRating team, final Battle battle) {
        if (team == null) {
            return null;
        }
        return new LeagueTeamDto(
                team.team(),
                LeagueRatingBatchAggregator.teamKey(battle, team),
                r1(team.teamRating()),
                team.dimensionAverages().stream().map(Mapper::r1).toList(),
                team.autoName(),
                team.nameSource(),
                team.teamBest() == null ? "" : team.teamBest().nickname(),
                team.teamBest() == null ? 0 : team.teamBest().accountId());
    }

    // ---- 汇总 ----

    public static List<AggRow> toAggregate(final Map<Long, Agg> aggMap,
                                        final Map<Long, PerformanceMetricsCalculator.Row> perfById) {
        final List<Agg> list = new ArrayList<>(aggMap.values());
        list.sort((x, y) -> Double.compare(y.avg(y.damage), x.avg(x.damage)));
        final List<AggRow> out = new ArrayList<>();
        for (final Agg a : list) {
            final Map<String, Object> cells = new LinkedHashMap<>();
            for (final AggregateColumns.CoreColumn c : AggregateColumns.CORE) {
                cells.put(c.key(), c.get().apply(a));
            }
            final PerformanceMetricsCalculator.Row perf = perfById.get(a.accountId);
            // 跨场表现派生列：canonical getter 单一来源（HP 全部 UNKNOWN 时
            // contribution/kast/多伤率 unavailable → null，UI 显示 "--"；impact/tradedDeaths 恒有值）
            for (final AggregateColumns.PerfColumn c : AggregateColumns.PERFORMANCE) {
                cells.put(c.key(), perf == null ? null : c.get().apply(perf));
            }
            out.add(new AggRow(cells, a.team));
        }
        return out;
    }

    private static double r1(final double v) {
        return Math.round(v * 10) / 10.0;
    }

    /** 经 Tankopedia 选择最常使用坦克（选择逻辑见 {@link #selectMostUsedVehicle}）。 */
    private static LeagueVehicleUsageDto mostUsedVehicle(final PlayerLeagueSummary s, final Tankopedia tp) {
        return selectMostUsedVehicle(s.vehicleUsage(), id -> vehicleName(id, tp));
    }

    /** 从已累计的坦克使用直方图中选出「最常使用坦克」（可独立单测，不依赖 Tankopedia）。
     * 规则：先确定最大使用场次，只处理使用次数等于最大的候选；每个候选只解析一次官方名；
     * 排除 null / 空白 / 占位名（如 {@code #<tankId>}）等非权威名称；剩余候选按官方名
     * 忽略大小写升序 → tankId 升序。若无任何可可靠命名的最大次数候选 → null；
     * 不退回使用次数较少的坦克（不伪造坦克，不参与 Rating 计算）。
     */
    static LeagueVehicleUsageDto selectMostUsedVehicle(final List<PlayerVehicleUsage> usage,
                                                       final Function<Long, String> nameOf) {
        if (usage == null || usage.isEmpty()) {
            return null;
        }
        final int maxBattles = usage.stream().mapToInt(PlayerVehicleUsage::battles).max().orElse(-1);
        final List<VehicleCandidate> candidates = usage.stream()
                .filter(u -> u.battles() == maxBattles)
                .map(u -> new VehicleCandidate(u.tankId(), u.battles(), nameOf.apply(u.tankId())))
                .filter(c -> isAuthoritativeName(c.name))
                .sorted(Comparator
                        .comparing((VehicleCandidate c) -> c.name, String.CASE_INSENSITIVE_ORDER)
                        .thenComparingLong(VehicleCandidate::tankId))
                .toList();
        if (candidates.isEmpty()) {
            return null;
        }
        final VehicleCandidate best = candidates.get(0);
        return new LeagueVehicleUsageDto(best.tankId, best.name, best.battles);
    }

    /** 是否为可靠官方坦克名：非 null、非空白、非占位名（Tankopedia 对未知 ID 返回 {@code "#<tankId>"}）。 */
    private static boolean isAuthoritativeName(final String name) {
        if (name == null) {
            return false;
        }
        final String trimmed = name.trim();
        return !trimmed.isEmpty() && !trimmed.startsWith("#");
    }

    /** 最常使用坦克候选：tankId + 使用场次 + 已解析官方名（可能为 null/占位，由调用方过滤）。 */
    private record VehicleCandidate(long tankId, int battles, String name) {
    }

    /** 经单一事实源 Tankopedia 解析坦克官方名；无该车、未加载或为占位名（#<tankId>）时返回 null。 */
    static String vehicleName(final long tankId, final Tankopedia tp) {
        if (tp == null) {
            return null;
        }
        final TankInfo info = tp.info(tankId);
        if (info == null) {
            return null;
        }
        return isAuthoritativeName(info.name()) ? info.name() : null;
    }

    private static Object playerValue(final Columns.Column column, final PlayerResult player) {
        return switch (column.key()) {
            case "tank_type" -> VehicleCodes.classCode(player.tankType);
            case "tank_nation" -> VehicleCodes.nationCode(player.tankNation);
            case "survived_label" -> player.survived ? "SURVIVED" : "DESTROYED";
            default -> column.get().apply(player);
        };
    }

    /**
     * 由已处理的 authoritative Battle 列表构建完整 Preview 响应（Preview 与
     * Replay Processing Job result 共用同一 DTO 构建）。
     *
     * <p><b>只读消费契约</b>：battles 必须已是完整 facts 管线产出
     * （Replays.collect + processFull + populateBattle 各一次），
     * 本方法<b>不</b>再执行任何会 mutate 共享 Battle 的 enrichment——事实层 enrich 由
     * 数据集创建方保证（ReplayProcessingJobService 的 full processing 链；同步
     * preview 已废弃为 410）。display 派生（tankName/tankType 等）仍在本
     * 层 {@link #toBattle} 内完成（与 Excel 写入器 SingleBattleSheets 内部行为一致，
     * 确定性幂等覆盖）。</p>
     */
    /**
     * League 模式：battles 为<b>全部</b>成功解析的 Battle（含 Rating-ineligible 场次），
     * 每场 Rating 经 {@link LeagueRatingBatch#resultFor} 按 arenaId identity 绑定
     * （不依赖数组 index——battles.size() 可大于 battleResults.size()）。
     */
    public static PreviewResponse toPreviewResponse(final List<Battle> battles,
                                                    final List<String> battleSourceNames,
                                                    final List<String[]> duplicates,
                                                    final List<String[]> failures,
                                                    final Tankopedia tp,
                                                    final LeagueRatingBatch league) {
        return toPreviewResponse(battles, battleSourceNames, duplicates, failures, tp, league, null);
    }

    /**
     * 完整 Preview 构建：league != null → League 模式；否则普通模式。
     * leagueUnavailableCode 非 null（混合批次 MIXED_LEAGUE_AND_STANDARD_REPLAYS）
     * 时按普通模式输出 battles/aggregate，同时携带 League 不可用提示码。
     */
    public static PreviewResponse toPreviewResponse(final List<Battle> battles,
                                                    final List<String> battleSourceNames,
                                                    final List<String[]> duplicates,
                                                    final List<String[]> failures,
                                                    final Tankopedia tp,
                                                    final LeagueRatingBatch league,
                                                    final String leagueUnavailableCode) {
        return toPreviewResponse(battles, null, battleSourceNames, duplicates, failures, tp,
                league, leagueUnavailableCode);
    }

    /** Complete Preview mapping with source identity aligned to the authoritative Battle list. */
    public static PreviewResponse toPreviewResponse(final List<Battle> battles,
                                                    final List<String> battleSourceIds,
                                                    final List<String> battleSourceNames,
                                                    final List<String[]> duplicates,
                                                    final List<String[]> failures,
                                                    final Tankopedia tp,
                                                    final LeagueRatingBatch league,
                                                    final String leagueUnavailableCode) {
        final List<BattleDto> battlesDto = new ArrayList<>();
        for (int i = 0; i < battles.size(); i++) {
            final Battle battle = battles.get(i);
            final LeagueRatingResult battleLeague = league == null ? null : league.resultFor(battle.arenaId);
            final String sourceId = battleSourceIds != null && i < battleSourceIds.size()
                    ? battleSourceIds.get(i) : null;
            final String sourceName = battleSourceNames != null && i < battleSourceNames.size()
                    ? battleSourceNames.get(i) : "";
            battlesDto.add(toBattle(battle, sourceId, sourceName, tp, battleLeague, league != null));
        }
        // 基础 Replay Aggregate 属于 Replay Core：无论 League Rating 是否成功，
        // 只要是多场（跨场汇总语义），就必须输出标准基础汇总——League Rating Summary
        // 是附加分析，不替代基础汇总。League 模式的 aggregateColumns 保留
        // 跨场 contribution/kast/impact（Performance Metrics 在 CW 可显示）。
        // CW/League 单场也生成基础 Replay Aggregate row——
        // 单场 CW Unified Summary 需要 damage_avg/assisted_avg/kills_avg/earned_avg 等
        // Replay Core 权威事实（全部可由该场结算得出，禁止伪装成 unavailable）；
        // Standard 单场保持旧语义（aggregate 为空）。aggregate 空列表时 toAggregate 自然为空。
        final Map<Long, PerformanceMetricsCalculator.Row> perfById = new LinkedHashMap<>();
        for (final PerformanceMetricsCalculator.Row row : PerformanceMetricsCalculator.compute(battles)) {
            perfById.put(row.accountId, row);
        }
        final boolean shouldAggregate = battles.size() > 1 || league != null;
        final List<AggRow> aggregate = shouldAggregate
                ? toAggregate(Aggregator.aggregate(battles, tp), perfById)
                : List.of();
        if (league != null) {
            // leagueMode=true：CW UI 存在（含 Rating-ineligible 场次）；league 仅决定本场 Rating 结果
            return new PreviewResponse(battlesDto, aggregate, duplicates, failures,
                    leaguePlayerColumns(), leagueAggregateColumns(), leagueDto(league, perfById, tp),
                    null, true);
        }
        return new PreviewResponse(battlesDto, aggregate, duplicates, failures,
                playerColumns(), aggregateColumns(), null, leagueUnavailableCode, false);
    }

    private static LeagueRatingDto leagueDto(final LeagueRatingBatch league,
                                              final Map<Long, PerformanceMetricsCalculator.Row> perfById,
                                              final Tankopedia tp) {
        final List<LeaguePlayerSummaryDto> players = new ArrayList<>();
        for (final PlayerLeagueSummary s : league.playerSummaries()) {
            final PerformanceMetricsCalculator.Row perf = perfById.get(s.accountId());
            players.add(new LeaguePlayerSummaryDto(
                    s.accountId(), s.nickname(), s.clan(), s.battles(),
                    r1(s.batchRatingV5()),
                    r1(s.ratingMedian()),
                    s.dimensionMedians().stream().map(Mapper::r1).toList(),
                    s.dimensionMeans().stream().map(Mapper::r1).toList(),
                    s.mvpCount(), s.wins(), s.damageTotal(), s.assistTotal(), s.killsTotal(),
                    // 跨场 Performance Metrics（与 resp.aggregate 同一全部已解析场次样本）；
                    // HP 全部 UNKNOWN → contribution/kast null（UI "--"），impact 恒有值
                    perf == null || !perf.hpEligible ? null : r1(perf.contribution),
                    perf == null || !perf.hpEligible ? null : r1(perf.kast),
                    perf == null ? null : r1(perf.impactValue),
                    mostUsedVehicle(s, tp)));
        }
        final List<LeagueTeamSummaryDto> teams = new ArrayList<>();
        for (final TeamLeagueSummary s : league.teamSummaries()) {
            teams.add(new LeagueTeamSummaryDto(
                    s.teamKey(), s.autoName(), s.nameSource(), s.battles(),
                    r1(s.ratingMedian()),
                    s.dimensionMedians().stream().map(Mapper::r1).toList(),
                    s.wins(), s.arenaTeams()));
        }
        final List<LeagueFailureDto> failures = new ArrayList<>();
        for (final com.wotb.core.league.LeagueFailure f : league.failures()) {
            failures.add(new LeagueFailureDto(f.fileName(), f.arenaId(), f.code()));
        }
        final com.wotb.core.league.LeagueRatingQuality quality = league.ratingQuality();
        return new LeagueRatingDto("LEAGUE_RATING", leagueColumnDefs(), players, teams,
                leaguePlayerSummaryColumns(), leagueTeamSummaryColumns(), failures,
                new LeagueRatingQualityDto(quality.unknownDeathTimePlayers()));
    }
}

package com.wotb.core.export;

import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.PlayerLeagueRating;
import com.wotb.core.league.PlayerLeagueSummary;
import com.wotb.core.league.TeamLeagueRating;
import com.wotb.core.league.TeamLeagueSummary;
import com.wotb.core.model.Battle;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Players;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * League Rating 批量工作簿：选手汇总（中位数）/ 战队汇总（中位数）/ 每场明细 /
 * 战斗列表（含重复、冲突、校验失败）。不产生赛季排名或批次奖项。
 */
final class LeagueAggregateSheets {

    /** 批次战队 identity override：teamKey → 显示名（PR #123 Blocker 2：aggregate rename 不得反向改单场）。 */
    private final Map<String, String> summaryOverrides;

    /** 单场战队 override：{arenaId}:{team} → 显示名（PR #123 Blocker 1：每场明细必须消费，不得丢弃）。 */
    private final Map<String, String> battleOverrides;

    LeagueAggregateSheets() {
        this(Map.of(), Map.of());
    }

    LeagueAggregateSheets(final Map<String, String> battleOverrides, final Map<String, String> summaryOverrides) {
        this.battleOverrides = battleOverrides == null ? Map.of() : battleOverrides;
        this.summaryOverrides = summaryOverrides == null ? Map.of() : summaryOverrides;
    }

    void write(final ExcelStyles styles, final List<Battle> battles, final List<String> sourceNames,
               final List<String[]> duplicates, final LeagueRatingBatch batch, final Tankopedia tp) {
        playerSummaries(styles, batch);
        teamSummaries(styles, batch);
        battleDetails(styles, battles, sourceNames, batch, tp);
        battleList(styles, battles, sourceNames, duplicates, batch);
        styles.workbook().setActiveSheet(0);
    }

    private void playerSummaries(final ExcelStyles styles, final LeagueRatingBatch batch) {
        final Sheet ws = styles.workbook().createSheet("选手汇总");
        final List<String[]> header = new ArrayList<>();
        header.add(new String[]{"玩家", "20"});
        header.add(new String[]{"战队", "10"});
        header.add(new String[]{"场次", "6"});
        header.add(new String[]{"总Rating中位数", "12"});
        for (final String dim : dimTitles()) {
            header.add(new String[]{dim + "中位数", "10"});
        }
        header.add(new String[]{"MVP次数", "8"});
        header.add(new String[]{"胜场", "6"});
        header.add(new String[]{"总伤害", "9"});
        header.add(new String[]{"总助攻", "9"});
        header.add(new String[]{"总击杀", "8"});
        styles.writeHeader(ws, header);
        int rIdx = 1;
        for (final PlayerLeagueSummary s : batch.playerSummaries()) {
            final Row row = ws.createRow(rIdx++);
            int c = 0;
            styles.setCell(row.createCell(c++), s.nickname(), styles.plain(), "nickname");
            styles.setCell(row.createCell(c++), s.clan(), styles.plain(), "clan");
            styles.setCell(row.createCell(c++), s.battles(), styles.plain(), "battles");
            styles.setCell(row.createCell(c++), ExcelStyles.r1(s.ratingMedian()), styles.plain(), "league_rating");
            for (final Double d : s.dimensionMedians()) {
                styles.setCell(row.createCell(c++), ExcelStyles.r1(d), styles.plain(), "league_score");
            }
            styles.setCell(row.createCell(c++), s.mvpCount(), styles.plain(), "mvp_count");
            styles.setCell(row.createCell(c++), s.wins(), styles.plain(), "wins");
            styles.setCell(row.createCell(c++), s.damageTotal(), styles.plain(), "damage_total");
            styles.setCell(row.createCell(c++), s.assistTotal(), styles.plain(), "assist_total");
            styles.setCell(row.createCell(c++), s.killsTotal(), styles.plain(), "kills_total");
        }
        ws.createFreezePane(1, 1);
    }

    private void teamSummaries(final ExcelStyles styles, final LeagueRatingBatch batch) {
        final Sheet ws = styles.workbook().createSheet("战队汇总");
        final List<String[]> header = new ArrayList<>();
        header.add(new String[]{"战队", "20"});
        header.add(new String[]{"场次", "6"});
        header.add(new String[]{"战队Rating中位数", "12"});
        for (final String dim : dimTitles()) {
            header.add(new String[]{dim + "中位数", "10"});
        }
        header.add(new String[]{"胜场", "6"});
        styles.writeHeader(ws, header);
        int rIdx = 1;
        for (final TeamLeagueSummary s : batch.teamSummaries()) {
            final Row row = ws.createRow(rIdx++);
            int c = 0;
            styles.setCell(row.createCell(c++), teamDisplayName(s), styles.plain(), "team_name");
            styles.setCell(row.createCell(c++), s.battles(), styles.plain(), "battles");
            styles.setCell(row.createCell(c++), ExcelStyles.r1(s.ratingMedian()), styles.plain(), "league_rating");
            for (final Double d : s.dimensionMedians()) {
                styles.setCell(row.createCell(c++), ExcelStyles.r1(d), styles.plain(), "league_score");
            }
            styles.setCell(row.createCell(c++), s.wins(), styles.plain(), "wins");
        }
        ws.createFreezePane(1, 1);
    }

    /** 战队汇总显示名：批次 teamKey override 优先，否则自动名称，否则待命名。 */
    private String teamDisplayName(final TeamLeagueSummary s) {
        final String override = summaryOverrides.get(s.teamKey());
        if (override != null && !override.isBlank()) {
            return override;
        }
        if (s.autoName() != null && !s.autoName().isBlank()) {
            return s.autoName();
        }
        return "待命名";
    }

    private void battleDetails(final ExcelStyles styles, final List<Battle> battles,
                               final List<String> sourceNames, final LeagueRatingBatch batch,
                               final Tankopedia tp) {
        final Sheet ws = styles.workbook().createSheet("每场明细");
        final List<String[]> header = new ArrayList<>();
        header.add(new String[]{"文件名", "20"});
        header.add(new String[]{"竞技场ID", "16"});
        header.add(new String[]{"队伍", "6"});
        header.add(new String[]{"玩家", "20"});
        header.add(new String[]{"车辆", "16"});
        header.add(new String[]{"伤害", "8"});
        header.add(new String[]{"总Rating", "9"});
        for (final String dim : dimTitles()) {
            header.add(new String[]{dim, "9"});
        }
        styles.writeHeader(ws, header);
        int rIdx = 1;
        // 只对通过校验并完成评分的场次输出 Rating 明细（identity 绑定，不依赖 index）；
        // Rating-ineligible 场次在「战斗列表」中以失败状态展示（plan：基础数据可导出，Rating 只对 eligible 存在）
        for (int i = 0; i < battles.size(); i++) {
            final Battle battle = battles.get(i);
            final LeagueRatingResult result = batch.resultFor(battle.arenaId);
            if (result == null) {
                continue;
            }
            final String sourceName = sourceNames.size() > i ? sourceNames.get(i) : "";
            for (final PlayerLeagueRating p : result.players()) {
                final Row row = ws.createRow(rIdx++);
                int c = 0;
                styles.setCell(row.createCell(c++), sourceName, styles.plain(), "nickname");
                styles.setCell(row.createCell(c++), battle.arenaId, styles.plain(), "clan");
                styles.setCell(row.createCell(c++), battleTeamName(battle, result, p.team()),
                        styles.plain(), "team_name");
                styles.setCell(row.createCell(c++), p.nickname(), styles.plain(), "nickname");
                styles.setCell(row.createCell(c++), tp.info(tankId(battle, p)).name(), styles.plain(), "tank_name");
                styles.setCell(row.createCell(c++), p.damageDealt(), styles.plain(), "damage_dealt");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.finalRating()), styles.plain(), "league_rating");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.damageScore()), styles.plain(), "league_score");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.assistScore()), styles.plain(), "league_score");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.killScore()), styles.plain(), "league_score");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.exchangeScore()), styles.plain(), "league_score");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.blockedScore()), styles.plain(), "league_score");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.survivalTradeScore()), styles.plain(), "league_score");
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.shootingScore()), styles.plain(), "league_score");
            }
        }
        ws.createFreezePane(1, 1);
    }

    private static long tankId(final Battle battle, final PlayerLeagueRating p) {
        for (final com.wotb.core.model.PlayerResult pr : battle.players) {
            if (pr.accountId == p.accountId()) {
                return pr.tankId;
            }
        }
        return 0;
    }

    /**
     * 每场明细的队伍名（PR #123 Blocker 1）：battleOverride[arenaId:team] → 该场 TeamLeagueRating.autoName
     * → 现有 fallback（Team 1/Team 2）。只读 battleOverrides，绝不消费 summaryOverrides（批次 identity 不反向
     * 写回单场明细）；autoName 复用评分 core 的 LeagueTeamNamer 单一事实源，不重新扫描 clan。
     */
    private String battleTeamName(final Battle battle, final LeagueRatingResult result, final int team) {
        final String override = battleOverrides.get(battle.arenaId + ":" + team);
        if (override != null && !override.isBlank()) {
            return override;
        }
        final TeamLeagueRating teamRating = result == null ? null : result.team(team);
        if (teamRating != null && teamRating.autoName() != null && !teamRating.autoName().isBlank()) {
            return teamRating.autoName();
        }
        return "Team " + team;
    }

    private void battleList(final ExcelStyles styles, final List<Battle> battles,
                            final List<String> sourceNames, final List<String[]> duplicates,
                            final LeagueRatingBatch batch) {
        final Sheet ws = styles.workbook().createSheet("战斗列表");
        final List<String[]> header = new ArrayList<>();
        header.add(new String[]{"文件名", "20"});
        header.add(new String[]{"竞技场ID", "16"});
        header.add(new String[]{"地图", "16"});
        header.add(new String[]{"获胜队伍", "8"});
        header.add(new String[]{"时长", "8"});
        header.add(new String[]{"状态", "14"});
        styles.writeHeader(ws, header);
        // 已解析 battle 集合（校验失败场次也在 battles 中；冲突场次不在）
        final Set<String> battleArenaIds = new HashSet<>();
        for (final Battle b : battles) {
            battleArenaIds.add(b.arenaId);
        }
        final Map<String, String> codeByArena = new HashMap<>();
        for (final com.wotb.core.league.LeagueFailure f : batch.failures()) {
            codeByArena.putIfAbsent(f.arenaId(), f.code());
        }
        int rIdx = 1;
        for (int i = 0; i < battles.size(); i++) {
            final Battle battle = battles.get(i);
            final Row row = ws.createRow(rIdx++);
            int c = 0;
            styles.setCell(row.createCell(c++), sourceNames.size() > i ? sourceNames.get(i) : "", styles.plain(), "nickname");
            styles.setCell(row.createCell(c++), battle.arenaId, styles.plain(), "clan");
            styles.setCell(row.createCell(c++), MapNames.cn(battle.mapName), styles.plain(), "tank_name");
            styles.setCell(row.createCell(c++), Players.TEAM_NAME.getOrDefault(battle.winnerTeam == null ? 0 : battle.winnerTeam, "平局/未知"), styles.plain(), "battles");
            styles.setCell(row.createCell(c++), ExcelStyles.duration(battle.durationS), styles.plain(), "damage_dealt");
            final String status = batch.resultFor(battle.arenaId) != null ? "已评分"
                    : codeByArena.containsKey(battle.arenaId) ? failureLabel(codeByArena.get(battle.arenaId))
                    : "未评分";
            styles.setCell(row.createCell(c++), status, styles.plain(), "nickname");
        }
        for (final String[] d : duplicates) {
            final Row row = ws.createRow(rIdx++);
            styles.setCell(row.createCell(0), d[0], styles.plain(), "nickname");
            styles.setCell(row.createCell(1), d[1], styles.plain(), "clan");
            styles.setCell(row.createCell(5), "重复", styles.plain(), "nickname");
        }
        for (final com.wotb.core.league.LeagueFailure f : batch.failures()) {
            // 校验失败场次已在 battle 行显示状态，避免重复行；仅冲突等不在 battles 的失败单独成行
            if (battleArenaIds.contains(f.arenaId())) {
                continue;
            }
            final Row row = ws.createRow(rIdx++);
            styles.setCell(row.createCell(0), f.fileName(), styles.plain(), "nickname");
            styles.setCell(row.createCell(1), f.arenaId(), styles.plain(), "clan");
            styles.setCell(row.createCell(5), failureLabel(f.code()), styles.plain(), "nickname");
        }
        ws.createFreezePane(1, 1);
    }

    private static String failureLabel(final String code) {
        return switch (code) {
            case com.wotb.core.league.LeagueFailure.Code.CONFLICTING_REPLAYS_FOR_ARENA -> "arena 冲突，不评分";
            case com.wotb.core.league.LeagueFailure.Code.NOT_SEVEN_VS_SEVEN -> "非标准 7v7";
            case com.wotb.core.league.LeagueFailure.Code.ROSTER_INCOMPLETE -> "名册不完整";
            case com.wotb.core.league.LeagueFailure.Code.NO_DECISIVE_WINNER -> "平局/未知胜方";
            case com.wotb.core.league.LeagueFailure.Code.MISSING_DEATH_TIME -> "阵亡时间缺失";
            default -> code;
        };
    }

    private static List<String> dimTitles() {
        return List.of("伤害评分", "助攻评分", "击杀评分", "换血效率评分",
                "阻挡评分", "存活/互换评分", "射击效率评分");
    }
}

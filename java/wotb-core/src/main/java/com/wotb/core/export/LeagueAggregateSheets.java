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
import java.util.List;
import java.util.Map;

/**
 * League Rating 批量工作簿：选手汇总（中位数）/ 战队汇总（中位数）/ 每场明细 /
 * 战斗列表（含重复、冲突、校验失败）。不产生赛季排名或批次奖项。
 */
final class LeagueAggregateSheets {

    private final Map<String, String> teamNameOverrides;

    LeagueAggregateSheets() {
        this(Map.of());
    }

    LeagueAggregateSheets(final Map<String, String> teamNameOverrides) {
        this.teamNameOverrides = teamNameOverrides == null ? Map.of() : teamNameOverrides;
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

    /** 战队汇总显示名：任一成员场的用户覆盖优先，否则自动名称，否则待命名。 */
    private String teamDisplayName(final TeamLeagueSummary s) {
        for (final String arenaTeam : s.arenaTeams()) {
            final String override = teamNameOverrides.get(arenaTeam);
            if (override != null && !override.isBlank()) {
                return override;
            }
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
        for (int i = 0; i < battles.size() && i < batch.battleResults().size(); i++) {
            final Battle battle = battles.get(i);
            final LeagueRatingResult result = batch.battleResults().get(i);
            final String sourceName = sourceNames.size() > i ? sourceNames.get(i) : "";
            for (final PlayerLeagueRating p : result.players()) {
                final Row row = ws.createRow(rIdx++);
                int c = 0;
                styles.setCell(row.createCell(c++), sourceName, styles.plain(), "nickname");
                styles.setCell(row.createCell(c++), battle.arenaId, styles.plain(), "clan");
                styles.setCell(row.createCell(c++), "Team " + p.team(), styles.plain(), "battles");
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
                styles.setCell(row.createCell(c++), ExcelStyles.r1(p.objectiveScore()), styles.plain(), "league_score");
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
            styles.setCell(row.createCell(c++), "已评分", styles.plain(), "nickname");
        }
        for (final String[] d : duplicates) {
            final Row row = ws.createRow(rIdx++);
            styles.setCell(row.createCell(0), d[0], styles.plain(), "nickname");
            styles.setCell(row.createCell(1), d[1], styles.plain(), "clan");
            styles.setCell(row.createCell(5), "重复", styles.plain(), "nickname");
        }
        for (final com.wotb.core.league.LeagueFailure f : batch.failures()) {
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
                "阻挡评分", "存活/互换评分", "射击效率评分", "争霸占点评分");
    }
}

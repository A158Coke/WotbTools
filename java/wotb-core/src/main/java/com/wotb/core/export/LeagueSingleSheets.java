package com.wotb.core.export;

import com.wotb.core.Columns;
import com.wotb.core.league.LeagueColumns;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.PlayerLeagueRating;
import com.wotb.core.league.TeamLeagueRating;
import com.wotb.core.model.Battle;
import com.wotb.core.ref.Tankopedia;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * League Rating 单场工作簿：玩家数据 = canonical {@link Columns#PLAYER} 全部 Replay 字段
 * （identity/vehicle/单场 stats/潜在伤害/Performance Metrics/received-blocked/shots-hits-pens/
 * 被命中/被击穿/击伤/排/军阶/车辆ID/账号ID，单一 schema 源）+
 * League 专属扩展（占点得分/占领分 + 七维评分/满分/百分比 + 总Rating/满分/百分比）；
 * 战斗信息（canonical base 由 {@link SingleBattleSheets#writeBattleInfo} 渲染 +
 * League 扩展 Team Rating + MVP + 队内最佳）/ 原始字段（共用 {@link SingleBattleSheets#writeRaw}）。
 *
 * <p>本类只负责 League extension，不再复制 Replay base renderer。</p>
 */
final class LeagueSingleSheets {

    /** 战队名称覆盖 key：{arenaId}:{team} → 显示名（仅当前导出调用内使用，不保存）。 */
    private final Map<String, String> teamNameOverrides;

    LeagueSingleSheets() {
        this(Map.of());
    }

    LeagueSingleSheets(final Map<String, String> teamNameOverrides) {
        this.teamNameOverrides = teamNameOverrides == null ? Map.of() : teamNameOverrides;
    }

    void write(final ExcelStyles styles, final Battle battle, final LeagueRatingResult result,
               final Tankopedia tp) {
        players(styles, battle, result, tp);
        battleInfo(styles, battle, result);
        SingleBattleSheets.writeRaw(styles, battle);
        styles.workbook().setActiveSheet(0);
    }

    /**
     * 玩家数据表：canonical {@link Columns#PLAYER} 全部 Replay 字段（单一 schema 源，
     * 由 SingleBattleSheets 共享 writer 渲染）+ League 专属扩展列
     * （占点得分/占领分 + 七维评分/满分/百分比 + 总Rating/满分/百分比）。
     */
    private void players(final ExcelStyles styles, final Battle b, final LeagueRatingResult result,
                         final Tankopedia tp) {
        final List<String[]> leagueHeader = new ArrayList<>();
        leagueHeader.add(new String[]{"占点得分", "9"});
        leagueHeader.add(new String[]{"占领分", "9"});
        // 七维标题单一来源：LeagueExcelColumns.dimensionTitle（key 由 LeagueColumns.DIM_KEYS 驱动）
        for (final String key : LeagueColumns.DIM_KEYS) {
            leagueHeader.add(new String[]{LeagueExcelColumns.dimensionTitle(key), "9"});
            leagueHeader.add(new String[]{"满分", "6"});
            leagueHeader.add(new String[]{"百分比", "8"});
        }
        leagueHeader.add(new String[]{"总Rating", "9"});
        leagueHeader.add(new String[]{"满分", "6"});
        leagueHeader.add(new String[]{"百分比", "8"});

        SingleBattleSheets.writePlayers(styles, b, tp, leagueHeader, (row, p, fill, startCol) -> {
            int c = startCol;
            styles.setCell(row.createCell(c++), p.victoryPointsEarned, fill, "victory_points_earned");
            styles.setCell(row.createCell(c++), p.victoryPointsSeized, fill, "victory_points_seized");
            final PlayerLeagueRating r = result.byAccount(p.accountId);
            if (r != null) {
                // 七维顺序单一来源：dimensionScores()（与 LeagueColumns.DIM_KEYS 严格一致）
                final List<Double> dims = r.dimensionScores();
                for (int d = 0; d < LeagueColumns.DIM_KEYS.size(); d++) {
                    styles.setCell(row.createCell(c++), ExcelStyles.r1(dims.get(d)), fill, "league_score");
                    styles.setCell(row.createCell(c++), (int) LeagueColumns.dimMax(d), fill, "league_max");
                    styles.setCell(row.createCell(c++), percent(dims.get(d), LeagueColumns.dimMax(d)), fill, "league_pct");
                }
                styles.setCell(row.createCell(c++), ExcelStyles.r1(r.finalRating()), fill, "league_rating");
                styles.setCell(row.createCell(c++), (int) PlayerLeagueRating.MAX_FINAL, fill, "league_max");
                styles.setCell(row.createCell(c++), percent(r.finalRating(), PlayerLeagueRating.MAX_FINAL), fill, "league_pct");
            }
        });
    }

    private static double percent(final double v, final double max) {
        return max <= 0 || v <= 0 ? 0 : ExcelStyles.r1(100.0 * v / max);
    }

    /**
     * 战斗信息表：canonical Replay base（{@link SingleBattleSheets#writeBattleInfo}，含
     * 录像者车辆）+ League 扩展（双方战队 Rating + 全场 MVP + 双方队内最佳）。
     */
    private void battleInfo(final ExcelStyles styles, final Battle b, final LeagueRatingResult result) {
        final List<String[]> extra = new ArrayList<>();
        if (result != null) {
            extra.add(new String[]{"Team 1 战队Rating", teamRatingLine(result.team1(), b)});
            extra.add(new String[]{"Team 2 战队Rating", teamRatingLine(result.team2(), b)});
            extra.add(new String[]{"全场MVP", result.mvp() == null ? "" : result.mvp().nickname()});
            extra.add(new String[]{"Team 1 队内最佳", result.team1() == null || result.team1().teamBest() == null
                    ? "" : result.team1().teamBest().nickname()});
            extra.add(new String[]{"Team 2 队内最佳", result.team2() == null || result.team2().teamBest() == null
                    ? "" : result.team2().teamBest().nickname()});
        }
        SingleBattleSheets.writeBattleInfo(styles, b, extra, 22);
    }

    private String teamRatingLine(final TeamLeagueRating team, final Battle battle) {
        if (team == null) {
            return "—";
        }
        final String name = displayName(battle, team);
        return name + "：" + ExcelStyles.r1(team.teamRating()) + " / 1000";
    }

    /** 战队显示名：用户覆盖（{arenaId}:{team}）优先，其次自动名称，否则待命名。 */
    String displayName(final Battle battle, final TeamLeagueRating team) {
        final String override = teamNameOverrides.get(battle.arenaId + ":" + team.team());
        if (override != null && !override.isBlank()) {
            return override;
        }
        if (team.autoName() != null && !team.autoName().isBlank()) {
            return team.autoName();
        }
        return "待命名";
    }
}

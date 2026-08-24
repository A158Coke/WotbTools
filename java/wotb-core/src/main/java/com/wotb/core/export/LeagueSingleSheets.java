package com.wotb.core.export;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.league.LeagueRatingResult;
import com.wotb.core.league.PlayerLeagueRating;
import com.wotb.core.league.TeamLeagueRating;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.Players;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * League Rating 单场工作簿：玩家数据 = canonical {@link Columns#PLAYER} 全部 Replay 字段
 * （identity/vehicle/单场 stats/潜在伤害/Performance Metrics/received-blocked/shots-hits-pens/
 * 被命中/被击穿/击伤/排/军阶/车辆ID/账号ID，单一 schema 源）+
 * League 专属扩展（占点得分/占领分 + 七维评分/满分/百分比 + 总Rating/满分/百分比）；
 * 战斗信息（双方战队 Rating + MVP + 队内最佳）/ 原始字段。
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
        raw(styles, battle);
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
        final String[] dimTitles = {"伤害评分", "助攻评分", "击杀评分", "换血效率评分",
                "阻挡评分", "存活/互换评分", "射击效率评分"};
        for (final String t : dimTitles) {
            leagueHeader.add(new String[]{t, "9"});
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
                final double[] dims = {r.damageScore(), r.assistScore(), r.killScore(), r.exchangeScore(),
                        r.blockedScore(), r.survivalTradeScore(), r.shootingScore()};
                final double[] maxes = {PlayerLeagueRating.MAX_DAMAGE, PlayerLeagueRating.MAX_ASSIST,
                        PlayerLeagueRating.MAX_KILL, PlayerLeagueRating.MAX_EXCHANGE,
                        PlayerLeagueRating.MAX_BLOCKED, PlayerLeagueRating.MAX_SURVIVAL_TRADE,
                        PlayerLeagueRating.MAX_SHOOTING};
                for (int d = 0; d < dims.length; d++) {
                    styles.setCell(row.createCell(c++), ExcelStyles.r1(dims[d]), fill, "league_score");
                    styles.setCell(row.createCell(c++), (int) maxes[d], fill, "league_max");
                    styles.setCell(row.createCell(c++), percent(dims[d], maxes[d]), fill, "league_pct");
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

    /** 战斗信息表：基础信息 + 双方战队 Rating + 全场 MVP + 双方队内最佳。 */
    private void battleInfo(final ExcelStyles styles, final Battle b, final LeagueRatingResult result) {
        final Workbook wb = styles.workbook();
        final Sheet ws = wb.createSheet("战斗信息");
        final Font big = wb.createFont();
        big.setBold(true);
        big.setFontHeightInPoints((short) 14);
        final CellStyle title = wb.createCellStyle();
        title.setFont(big);
        final Row r0 = ws.createRow(0);
        final Cell c0 = r0.createCell(0);
        c0.setCellValue("战斗信息");
        c0.setCellStyle(title);

        final List<String[]> rows = new ArrayList<>();
        rows.add(new String[]{"游戏版本", b.version});
        rows.add(new String[]{"地图", MapNames.cn(b.mapName)});
        rows.add(new String[]{"开始时间", ExcelStyles.fmt(b.startTime, ExcelStyles.DT)});
        rows.add(new String[]{"战斗时长", ExcelStyles.duration(b.durationS)});
        rows.add(new String[]{"获胜队伍", Players.TEAM_NAME.getOrDefault(b.winnerTeam == null ? 0 : b.winnerTeam, "平局/未知")});
        rows.add(new String[]{"录像者", b.recorder});
        rows.add(new String[]{"玩家数", String.valueOf(b.nPlayers())});
        rows.add(new String[]{"竞技场ID", b.arenaId});
        if (result != null) {
            rows.add(new String[]{"Team 1 战队Rating", teamRatingLine(result.team1(), 1, b)});
            rows.add(new String[]{"Team 2 战队Rating", teamRatingLine(result.team2(), 2, b)});
            rows.add(new String[]{"全场MVP", result.mvp() == null ? "" : result.mvp().nickname()});
            rows.add(new String[]{"Team 1 队内最佳", result.team1() == null || result.team1().teamBest() == null
                    ? "" : result.team1().teamBest().nickname()});
            rows.add(new String[]{"Team 2 队内最佳", result.team2() == null || result.team2().teamBest() == null
                    ? "" : result.team2().teamBest().nickname()});
        }
        final Font bold = wb.createFont();
        bold.setBold(true);
        final CellStyle boldStyle = wb.createCellStyle();
        boldStyle.setFont(bold);
        for (int i = 0; i < rows.size(); i++) {
            final Row r = ws.createRow(i + 2);
            final Cell k = r.createCell(0);
            k.setCellValue(rows.get(i)[0]);
            k.setCellStyle(boldStyle);
            r.createCell(1).setCellValue(rows.get(i)[1] == null ? "" : rows.get(i)[1]);
        }
        ws.setColumnWidth(0, 22 * 256);
        ws.setColumnWidth(1, 40 * 256);
    }

    private String teamRatingLine(final TeamLeagueRating team, final int teamNumber, final Battle battle) {
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

    /** 原始字段表（与普通单场一致的 protobuf 字段号透视）。 */
    private void raw(final ExcelStyles styles, final Battle b) {
        final Sheet ws = styles.workbook().createSheet("原始字段");
        final TreeSet<Integer> fieldNums = new TreeSet<>();
        for (final PlayerResult p : b.players) {
            if (p.raw != null) {
                fieldNums.addAll(p.raw.keySet());
            }
        }
        final List<Integer> cols = new ArrayList<>(fieldNums);
        final Row h = ws.createRow(0);
        styles.cell(h, 0, "玩家", styles.hdr());
        styles.cell(h, 1, "账号ID", styles.hdr());
        for (int i = 0; i < cols.size(); i++) {
            styles.cell(h, i + 2, "#" + cols.get(i), styles.hdr());
        }
        final List<PlayerResult> players = Players.sorted(b.players);
        int rIdx = 1;
        for (final PlayerResult p : players) {
            final Row row = ws.createRow(rIdx++);
            row.createCell(0).setCellValue(p.nickname);
            row.createCell(1).setCellValue(p.accountId);
            for (int i = 0; i < cols.size(); i++) {
                final List<Object> vals = p.raw == null ? null : p.raw.get(cols.get(i));
                if (vals == null) {
                    continue;
                }
                final StringBuilder sb = new StringBuilder();
                for (final Object v : vals) {
                    if (!sb.isEmpty()) {
                        sb.append(", ");
                    }
                    sb.append(v instanceof byte[] ? ExcelStyles.toHex((byte[]) v) : String.valueOf(v));
                }
                row.createCell(i + 2).setCellValue(sb.toString());
            }
        }
    }
}

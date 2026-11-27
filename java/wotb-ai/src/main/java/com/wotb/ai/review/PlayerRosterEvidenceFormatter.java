package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.util.PlayerResultFormat;
import java.util.List;
import java.util.Map;

final class PlayerRosterEvidenceFormatter {
    private static final Tankopedia tankopedia = Tankopedia.load();
    private PlayerRosterEvidenceFormatter() {
    }

    static void appendPlayerLine(final StringBuilder sb, final PlayerResult p, final boolean isFriendly) {
        appendPlayerLine(sb, null, p, isFriendly, false);
    }

    static void appendPlayerLine(final StringBuilder sb, final PlayerResult p,
                                 final boolean isFriendly, final boolean isYou) {
        appendPlayerLine(sb, null, p, isFriendly, isYou);
    }

    static void appendPlayerLine(final StringBuilder sb, final Battle battle, final PlayerResult p,
                                 final boolean isFriendly) {
        appendPlayerLine(sb, battle, p, isFriendly, false);
    }

    static void appendPlayerLine(final StringBuilder sb, final Battle battle, final PlayerResult p,
                                 final boolean isFriendly, final boolean isYou) {
        final String tankDisplay = ReplayDisplayNames.tankName(p.tankId, p.tankName);
        final double deathSec = PlayerResultFormat.deathSec(p);
        final String deathStr = p.survived ? "存活"
                : deathSec > 0
                        ? "阵亡@" + PlayerAnalysisTerms.knownDeathClock(deathSec)
                        : "阵亡（时刻未知）";
        sb.append(isYou ? "你 " : (isFriendly ? "队友 " : "敌方 "))
                .append(PlayerResultFormat.quoteForPrompt(p.nickname))
                .append(" 坦克: ").append(PlayerResultFormat.quoteForPrompt(tankDisplay))
                .append(" 车种: ").append(ReplayDisplayNames.tankClass(p.tankId))
                .append(PlayerEvidenceFormattingSupport.structuredTankFacts(p.tankId, p))
                .append(" 输出").append(p.damageDealt)
                .append(" 损失血量").append(p.damageReceived)
                .append(" 助攻").append(p.damageAssisted)
                .append(" 格挡").append(p.damageBlocked)
                .append(" 击杀").append(p.kills)
                .append(" 命中").append(p.nHitsDealt)
                .append(" 击穿").append(p.nPenetrationsDealt)
                .append(" 打到人数").append(p.nEnemiesDamaged)
                .append(" ").append(deathStr)
                .append('\n');
    }

    static void appendClassSummary(final StringBuilder sb,
                                   final List<PlayerResult> friendlies,
                                   final List<PlayerResult> enemies,
                                   final List<PlayerResult> unknowns,
                                   final Battle battle) {
        sb.append("\n=== COMPOSITION_AUTHORITATIVE（双方车种构成·权威结算） ===\n");
        sb.append("本队（含你） ").append(friendlies.size()).append(" 辆:");
        appendClassCounts(sb, friendlies);
        sb.append(" | 敌方 ").append(enemies.size()).append(" 辆:");
        appendClassCounts(sb, enemies);
        if (!unknowns.isEmpty()) {
            sb.append(" | 未知 ").append(unknowns.size()).append(" 辆:");
            appendClassCounts(sb, unknowns);
        }
        sb.append('\n');
    }

    private static void appendClassCounts(final StringBuilder sb, final List<PlayerResult> players) {
        int heavy = 0, medium = 0, light = 0, td = 0, unknown = 0;
        for (final PlayerResult p : players) {
            final TankInfo info = tankopedia.info(p.tankId);
            final String type = info != null && info.type() != null ? info.type() : "";
            switch (type) {
                case "Heavy tank" -> heavy++;
                case "Medium tank" -> medium++;
                case "Light tank" -> light++;
                case "Tank destroyer" -> td++;
                default -> unknown++;
            }
        }
        sb.append(" 重坦").append(heavy);
        sb.append(" 中坦").append(medium);
        sb.append(" 轻坦").append(light);
        sb.append(" 坦克歼击车").append(td);
        if (unknown > 0) sb.append(" 未知").append(unknown);
    }

    static void appendAggregates(final StringBuilder sb,
                                 final List<PlayerResult> friendlies,
                                 final List<PlayerResult> enemies,
                                 final List<PlayerResult> unknowns) {
        appendAggregates(sb, null, friendlies, enemies, unknowns);
    }

    static void appendAggregates(final StringBuilder sb, final Battle battle,
                                 final List<PlayerResult> friendlies,
                                 final List<PlayerResult> enemies,
                                 final List<PlayerResult> unknowns) {
        sb.append("\n=== FRIENDLY_AUTHORITATIVE_RESULT（本队合计·权威结算，含你） ===\n");
        appendTeamAggregate(sb, battle, friendlies);
        sb.append("=== ENEMY_AUTHORITATIVE_RESULT（敌方合计·权威结算） ===\n");
        appendTeamAggregate(sb, battle, enemies);
        if (!unknowns.isEmpty()) {
            sb.append("=== UNKNOWN_AUTHORITATIVE_RESULT（未确定阵营合计·权威结算） ===\n");
            appendTeamAggregate(sb, battle, unknowns);
        }
    }

    private static void appendTeamAggregate(final StringBuilder sb, final Battle battle,
                                            final List<PlayerResult> players) {
        final int totalDmg = players.stream().mapToInt(p -> p.damageDealt).sum();
        final int totalRecv = players.stream().mapToInt(p -> p.damageReceived).sum();
        final int totalAssist = players.stream().mapToInt(p -> p.damageAssisted).sum();
        final int totalBlocked = players.stream().mapToInt(p -> p.damageBlocked).sum();
        final int totalKills = players.stream().mapToInt(p -> p.kills).sum();
        final long survivors = players.stream().filter(p -> p.survived).count();
        final long deaths = players.stream().filter(p -> !p.survived).count();
        final List<PlayerResult> knownDeaths = players.stream()
                .filter(p -> !p.survived && PlayerResultFormat.deathSec(p) > 0)
                .toList();
        final double firstDeath = knownDeaths.stream()
                .mapToDouble(PlayerResultFormat::deathSec).min().orElse(-1);
        final double lastDeath = knownDeaths.stream()
                .mapToDouble(PlayerResultFormat::deathSec).max().orElse(-1);
        sb.append("总伤害: ").append(totalDmg)
                .append(" 总损失血量: ").append(totalRecv)
                .append(" 总助攻: ").append(totalAssist)
                .append(" 总格挡: ").append(totalBlocked)
                .append(" 总击杀: ").append(totalKills)
                .append(" 存活: ").append(survivors)
                .append(" 阵亡: ").append(deaths);
        if (deaths > 0) {
            if (knownDeaths.size() == deaths) {
                sb.append(" 首阵亡: ").append(PlayerAnalysisTerms.knownDeathClock(firstDeath));
                sb.append(" 末阵亡: ").append(PlayerAnalysisTerms.knownDeathClock(lastDeath));
            } else {
                sb.append(" 阵亡时刻覆盖: ").append(knownDeaths.size()).append('/').append(deaths)
                        .append("（存在 UNKNOWN，首/末阵亡不推断）");
            }
        }
        sb.append('\n');
    }

    static void appendRecorderRanking(final StringBuilder sb, final PlayerResult rec,
                                      final List<PlayerResult> friendlies,
                                      final Battle battle) {
        final int totalFriendly = friendlies.size();
        final int dmgRank = (int) friendlies.stream()
                .filter(p -> p.damageDealt > rec.damageDealt).count() + 1;
        final int killRank = (int) friendlies.stream()
                .filter(p -> p.kills > rec.kills).count() + 1;
        final int totalFriendlyDmg = friendlies.stream().mapToInt(p -> p.damageDealt).sum();
        final double dmgShare = totalFriendlyDmg > 0 ? 100.0 * rec.damageDealt / totalFriendlyDmg : 0.0;

        sb.append("\n=== RECORDER_STATS_AUTHORITATIVE（你在本队的排名·权威结算） ===\n");
        sb.append("你在本队的伤害排名: ").append(dmgRank).append("/").append(totalFriendly)
                .append(" 击杀排名: ").append(killRank).append("/").append(totalFriendly)
                .append(" 占本队总伤害: ").append(String.format("%.0f%%", dmgShare));

        final double deathSec = PlayerResultFormat.deathSec(rec);
        if (!rec.survived && deathSec > 0) {
            final boolean friendlyDeathsComplete = friendlies.stream()
                    .filter(p -> !p.survived)
                    .allMatch(p -> PlayerResultFormat.deathSec(p) > 0);
            final List<PlayerResult> allPlayers = battle.players != null ? battle.players : List.of();
            final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
            final List<PlayerResult> enemies = allPlayers.stream()
                    .filter(p -> sides.getOrDefault(p, Side.UNKNOWN) == Side.ENEMY)
                    .toList();
            final boolean enemyDeathsComplete = enemies.stream()
                    .filter(p -> !p.survived)
                    .allMatch(p -> PlayerResultFormat.deathSec(p) > 0);

            sb.append(" 死亡时间: ").append(PlayerAnalysisTerms.knownDeathClock(deathSec));
            if (friendlyDeathsComplete) {
                final int deathOrder = (int) friendlies.stream()
                        .filter(p -> !p.survived)
                        .mapToDouble(PlayerResultFormat::deathSec)
                        .filter(ds -> ds > 0 && ds < deathSec)
                        .count() + 1;
                sb.append(" 你在本队的阵亡序位: ").append(deathOrder).append("/").append(totalFriendly);
                final long friendlyAlive = friendlies.stream()
                        .filter(p -> p.survived || PlayerResultFormat.deathSec(p) > deathSec).count();
                sb.append(" 你阵亡时本队存活: ").append(friendlyAlive);
            } else {
                sb.append(" 你在本队的阵亡序位: UNKNOWN")
                        .append(" 你阵亡时本队存活: UNKNOWN");
            }

            if (battle.durationS != null && battle.durationS > 0) {
                final double progressRatio = Math.max(0.0, Math.min(1.0, deathSec / battle.durationS));
                sb.append(" 战斗进度: ").append(String.format("%.0f%%", progressRatio * 100));
            } else {
                sb.append(" 战斗进度: UNKNOWN");
            }

            if (enemyDeathsComplete) {
                final long enemyAlive = enemies.stream()
                        .filter(p -> p.survived || PlayerResultFormat.deathSec(p) > deathSec).count();
                sb.append(" 阵亡时敌方存活: ").append(enemyAlive);
            } else {
                sb.append(" 阵亡时敌方存活: UNKNOWN");
            }
        } else if (!rec.survived) {
            sb.append(" 死亡时间: UNKNOWN 阵亡序位/存活人数/战斗进度: UNKNOWN");
        }
        sb.append('\n');
    }

    static void appendDeathTimeline(final StringBuilder sb, final Battle battle) {
        final List<PlayerResult> dead = battle.players != null ? battle.players.stream()
                .filter(p -> !p.survived)
                .sorted(java.util.Comparator
                        .comparingDouble((PlayerResult p) -> PlayerResultFormat.deathSec(p) > 0
                                ? PlayerResultFormat.deathSec(p) : Double.MAX_VALUE)
                        .thenComparingLong(p -> p.accountId))
                .toList() : List.of();
        if (dead.isEmpty()) {
            sb.append("无阵亡\n");
            return;
        }
        final PlayerResult recorder = battle.recorderResult();
        for (final PlayerResult p : dead) {
            final double deathSec = PlayerResultFormat.deathSec(p);
            final String who = PlayerAnalysisPromptFormatter.isSamePlayer(p, recorder)
                    ? "你"
                    : PlayerAnalysisPromptFormatter.sideLabel(PlayerSideResolver.resolve(battle, p))
                            + " " + PlayerResultFormat.quoteForPrompt(p.nickname);
            sb.append(deathSec > 0
                            ? PlayerAnalysisTerms.battleClock((float) deathSec) : "未知").append(' ')
                    .append(who)
                    .append("（").append(PlayerResultFormat.quoteForPrompt(
                            ReplayDisplayNames.tankName(p.tankId, p.tankName)))
                    .append("）").append(deathSec > 0 ? "阵亡" : "阵亡（时刻未知）")
                    .append('\n');
        }
    }
}

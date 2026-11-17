package com.wotb.ai.review;

import com.wotb.core.ai.EntityIdentityResolver;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Deterministic combat and damage evidence rendering. */
final class PlayerCombatEvidenceFormatter {
    private PlayerCombatEvidenceFormatter() {
    }

    private static com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat(
            final Battle battle, final ReplayReconstruction recon) {
        if (recon == null || recon.events() == null) {
            return new com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result(
                    java.util.Map.of(), java.util.List.of());
        }
        final TeamEntityMapping mapping = DamageEventIdentityResolver.mapping(battle, recon);
        final Float start = recon.battleStartRawClockSec();
        final double duration = recon.battleDurationSec() > 0 ? recon.battleDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        return com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                recon.events(), mapping, start == null ? 0.0 : start.doubleValue(), duration, battle);
    }

    private static int dealtTo(
            final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat,
            final long attacker, final long victim, final double t) {
        int total = 0;
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l
                : combat.lossesOf(victim)) {
            if (!l.attackerReliable() || l.attackerAccountId() == null
                    || l.attackerAccountId() != attacker || l.toSec() > t + 1e-6) {
                continue;
            }
            total += l.hpLoss();
        }
        return total;
    }

    static boolean appendRecorderDamageExchange(final StringBuilder sb,
                                                final Battle battle,
                                                final ReplayReconstruction recon,
                                                final PlayerResult rec) {
        return appendRecorderDamageExchange(sb, battle, recon, rec, false);
    }

    static boolean appendRecorderDamageExchange(final StringBuilder sb,
                                                final Battle battle,
                                                final ReplayReconstruction recon,
                                                final PlayerResult rec,
                                                final boolean suppressObservedNumbers) {
        if (suppressObservedNumbers) {
            sb.append("\n=== DAMAGE_EXCHANGE_AGGREGATED_OBSERVED ===\n")
                    .append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return true;
        }
        if (battle == null || rec == null) {
            return false;
        }
        final Map<Long, PlayerResult> byAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                byAccount.putIfAbsent(p.accountId, p);
            }
        }
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat = combat(battle, recon);
        final Map<Long, Integer> dealtByTarget = new LinkedHashMap<>();
        for (final java.util.Map.Entry<Long, List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> e
                : combat.lossesByVictim().entrySet()) {
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l : e.getValue()) {
                if (l.attackerReliable() && l.attackerAccountId() != null
                        && l.attackerAccountId() == rec.accountId) {
                    dealtByTarget.merge(e.getKey(), l.hpLoss(), Integer::sum);
                }
            }
        }
        if (dealtByTarget.isEmpty()) {
            return false;
        }
        sb.append("\n=== DAMAGE_EXCHANGE_AGGREGATED_OBSERVED（逐对手聚合观测子集） ===\n");
        sb.append("注意: 以下为整场累计的观测子集（权威掉血口径, 仅含可证明攻击者归属的部分）, "
                + "不是单次伤害, 也不是权威总伤害.\n");
        for (final java.util.Map.Entry<Long, Integer> entry : dealtByTarget.entrySet()) {
            final PlayerResult target = byAccount.get(entry.getKey());
            final Side side = target != null ? PlayerSideResolver.resolve(battle, target) : Side.UNKNOWN;
            final long targetTankId = target != null ? target.tankId : 0L;
            sb.append("你 -> ").append(PlayerAnalysisPromptFormatter.sideLabel(side)).append(' ')
                    .append(PlayerResultFormat.quoteForPrompt(target != null ? target.nickname : ""))
                    .append(" 坦克: ").append(PlayerResultFormat.quoteForPrompt(
                            ReplayDisplayNames.tankName(targetTankId, target != null ? target.tankName : null)))
                    .append(" 车种: ").append(ReplayDisplayNames.tankClass(targetTankId))
                    .append(" 累计直接伤害").append(entry.getValue())
                    .append('\n');
        }
        return true;
    }

    static boolean appendDamageExchangeByOpponent(final StringBuilder sb,
                                                  final Battle battle,
                                                  final long recorderAccountId,
                                                  final ReplayReconstruction recon) {
        return appendDamageExchangeByOpponent(sb, battle, recorderAccountId, recon, false);
    }

    static boolean appendDamageExchangeByOpponent(final StringBuilder sb,
                                                  final Battle battle,
                                                  final long recorderAccountId,
                                                  final ReplayReconstruction recon,
                                                  final boolean suppressObservedNumbers) {
        if (suppressObservedNumbers) {
            sb.append("\n=== DAMAGE_EXCHANGE_BY_OPPONENT ===\n")
                    .append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return true;
        }
        if (battle == null || recorderAccountId <= 0 || recon == null || recon.events() == null) {
            return false;
        }
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat = combat(battle, recon);
        final Map<Long, int[]> dealt = new LinkedHashMap<>();
        final Map<Long, int[]> received = new LinkedHashMap<>();
        for (final java.util.Map.Entry<Long,
                List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> entry
                : combat.lossesByVictim().entrySet()) {
            final long victim = entry.getKey();
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l : entry.getValue()) {
                final Long attacker = l.attackerAccountId();
                if (l.attackerReliable() && attacker != null && attacker > 0) {
                    if (attacker == recorderAccountId) {
                        accumulate(dealt, victim, l.hpLoss());
                    } else if (victim == recorderAccountId) {
                        accumulate(received, attacker, l.hpLoss());
                    }
                }
            }
        }
        if (dealt.isEmpty() && received.isEmpty()) {
            return false;
        }
        final Map<Long, PlayerResult> byAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                byAccount.putIfAbsent(p.accountId, p);
            }
        }
        sb.append("\n=== DAMAGE_EXCHANGE_BY_OPPONENT_OBSERVED（逐对手对炮明细·事件流观测） ===\n");
        sb.append("注意: 来自事件流的逐次伤害累计, 属观测子集, 不是权威总伤害; 目标车辆名称为权威专有名词.\n");
        final Set<Long> opponents = new LinkedHashSet<>();
        opponents.addAll(dealt.keySet());
        opponents.addAll(received.keySet());
        for (final Long opponentId : opponents) {
            final PlayerResult target = byAccount.get(opponentId);
            final long targetTankId = target != null ? target.tankId : 0L;
            final Side side = target != null ? PlayerSideResolver.resolve(battle, target) : Side.UNKNOWN;
            final int[] out = dealt.getOrDefault(opponentId, new int[]{0, 0});
            final int[] in = received.getOrDefault(opponentId, new int[]{0, 0});
            sb.append("对手 ").append(PlayerAnalysisPromptFormatter.sideLabel(side)).append(' ')
                    .append(PlayerResultFormat.quoteForPrompt(target != null ? target.nickname : ""))
                    .append(" 坦克: ").append(PlayerResultFormat.quoteForPrompt(
                            ReplayDisplayNames.tankName(targetTankId, target != null ? target.tankName : null)))
                    .append(" 车种: ").append(ReplayDisplayNames.tankClass(targetTankId))
                    .append(" | 你对其造成").append(out[0]).append("伤害/").append(out[1]).append("次命中")
                    .append(" | 其对你造成").append(in[0]).append("伤害/").append(in[1]).append("次命中")
                    .append('\n');
        }
        return true;
    }

    private static void accumulate(final Map<Long, int[]> target, final long accountId, final int damage) {
        final int[] slot = target.computeIfAbsent(accountId, k -> new int[]{0, 0});
        slot[0] += damage;
        slot[1] += 1;
    }

    static boolean appendPerHitDamageEvents(final StringBuilder sb,
                                            final Battle battle,
                                            final long recorderAccountId,
                                            final ReplayReconstruction recon) {
        return appendPerHitDamageEvents(sb, battle, recorderAccountId, recon, false);
    }

    static boolean appendPerHitDamageEvents(final StringBuilder sb,
                                            final Battle battle,
                                            final long recorderAccountId,
                                            final ReplayReconstruction recon,
                                            final boolean suppressObservedNumbers) {
        if (suppressObservedNumbers) {
            sb.append("\n=== PER_HIT_DAMAGE_EVENTS ===\n")
                    .append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return true;
        }
        if (battle == null || recorderAccountId <= 0 || recon == null || recon.events() == null) {
            return false;
        }
        final Map<Long, PlayerResult> byAccount = new LinkedHashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                byAccount.putIfAbsent(p.accountId, p);
            }
        }
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat = combat(battle, recon);
        final List<double[]> rows = new ArrayList<>();
        final List<String> texts = new ArrayList<>();
        for (final java.util.Map.Entry<Long,
                List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> entry
                : combat.lossesByVictim().entrySet()) {
            final long victim = entry.getKey();
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss loss : entry.getValue()) {
                final Long attacker = loss.attackerAccountId();
                final boolean recorderIsAttacker = loss.attackerReliable()
                        && attacker != null && attacker == recorderAccountId;
                final boolean recorderIsVictim = victim == recorderAccountId;
                if (!recorderIsAttacker && !recorderIsVictim) continue;
                final String clock = PlayerAnalysisTerms.battleClock((float) loss.toSec());
                final String row;
                if (recorderIsAttacker) {
                    final String victimText = PlayerEvidenceFormattingSupport.damageActorText(battle, byAccount.get(victim), recorderAccountId);
                    row = clock + "：你 对 " + victimText
                            + " 造成了" + loss.hpLoss() + "点伤害";
                } else {
                    final String attackerText = (loss.attackerReliable() && attacker != null)
                            ? PlayerEvidenceFormattingSupport.damageActorText(battle, byAccount.get(attacker), recorderAccountId)
                            : "来源未知";
                    row = clock + "：" + attackerText + " 对你造成了" + loss.hpLoss() + "点伤害";
                }
                rows.add(new double[]{loss.toSec(), texts.size()});
                texts.add(row);
            }
        }
        if (rows.isEmpty()) {
            return false;
        }
        rows.sort(java.util.Comparator.comparingDouble(r -> r[0]));
        sb.append("\n=== PER_HIT_DAMAGE_EVENTS_OBSERVED（逐次伤害事件·事件流观测） ===\n");
        sb.append("注意: 每条都是单次伤害事件, 不是累计值; 方向由事件的攻击方/受击方账号确定.\n");
        for (final double[] row : rows) {
            sb.append(texts.get((int) row[1])).append('\n');
        }
        return true;
    }

    static boolean appendRecorderDamageReceivedWindows(final StringBuilder sb,
                                                       final Battle battle,
                                                       final ReplayReconstruction recon,
                                                       final long recorderAccountId,
                                                       final boolean suppressObservedNumbers) {
        final String section = recorderDamageReceivedWindowsSection(
                battle, recon, recorderAccountId, suppressObservedNumbers);
        if (section.isEmpty()) {
            return false;
        }
        sb.append(section);
        return true;
    }

    static String recorderDamageReceivedWindowsSection(final Battle battle,
                                                       final ReplayReconstruction recon,
                                                       final long recorderAccountId,
                                                       final boolean suppressObservedNumbers) {
        if (suppressObservedNumbers) {
            return "\n=== RECORDER_DAMAGE_RECEIVED_WINDOWS ===\n"
                    + "UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n";
        }
        final List<DamageWindowClusterer.DamageWindow> windows =
                DamageWindowClusterer.receivedWindows(battle, recon, recorderAccountId);
        if (windows.isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(512);
        sb.append("\n=== RECORDER_DAMAGE_RECEIVED_WINDOWS（你掉血时间窗口·事件流观测） ===\n");
        sb.append("注意: 每条是一个按时间聚类的掉血窗口; 攻击者N=窗口内解析出的不同攻击者数; "
                + "只有窗口总跨度 ≤" + (int) DamageWindowClusterer.SHORT_FOCUS_WINDOW_SEC
                + " 秒、攻击者≥2 且无未解析攻击者时才标注「（短时多车集火证据）」; "
                + "攻击者=1 → 短时间集中掉血/高压掉血窗口（不是集火）; "
                + "标注「（攻击者部分未解析）」时攻击者数不完整, 不得断言集火; "
                + "链式聚类形成的大跨度窗口（相邻间隔虽小但总跨度超阈值）不得当作短时集火; "
                + "伤害/进场满血pct=窗口累计伤害/已证明进场满血量(回放受击前样本证明, 含装备/物资加成)的百分比; "
                + "伤害/base满血pct=窗口累计伤害/tankopedia 基础血量的百分比(进场满血未被证明时的 base baseline, "
                + "只是计算基准, 不是实际掉血比例(未知则为「未知」); "
                + "仅当进场满血被证明且窗口跨度≤" + (int) DamageWindowClusterer.CRITICAL_WINDOW_SPAN_SEC
                + " 秒、伤害≥" + (int) DamageWindowClusterer.CRITICAL_HP_PCT
                + "% 已证明进场满血量才标注「（短窗高额伤害窗口）」; "
                + "数据无法证明窗口起始血量/窗口内阵亡/装备加成后的实际最大血量, 不得判定「从满血被秒杀」.\n");
        for (final DamageWindowClusterer.DamageWindow window : windows) {
            sb.append("  ").append(PlayerAnalysisTerms.battleRange(window.startSec(), window.endSec()))
                    .append(" 掉血").append(window.totalDamage())
                    .append(" 命中").append(window.hitCount()).append("次")
                    .append(" 攻击者").append(window.uniqueAttackerCount())
                    .append(window.attackersUnresolved() ? "（攻击者部分未解析）" : "")
                    .append(window.focusFireCandidate() ? "（短时多车集火证据）" : "")
                    .append(window.entryHpProven() ? " 伤害/进场满血pct=" : " 伤害/base满血pct=")
                    .append(window.damageVsEntryMaxHpPct() == null
                            ? "未知" : Math.round(window.damageVsEntryMaxHpPct()) + "%")
                    .append(window.criticalWindow() ? "（短窗高额伤害窗口）" : "")
                    .append('\n');
        }
        return sb.toString();
    }

    static void appendEnemyLastKnownPositions(final StringBuilder sb,
                                              final Battle battle,
                                              final ReplayReconstruction recon) {
        final String section = EnemyLastKnownPositionsSection.renderPlayerSection(battle, recon);
        if (section.isEmpty()) {
            return;
        }
        sb.append('\n').append(section);
    }

    static boolean appendKillAttribution(final StringBuilder sb,
                                         final Battle battle,
                                         final ReplayReconstruction recon,
                                         final PlayerResult rec) {
        return appendKillAttribution(sb, battle, recon, rec, false);
    }

    static boolean appendKillAttribution(final StringBuilder sb,
                                         final Battle battle,
                                         final ReplayReconstruction recon,
                                         final PlayerResult rec,
                                         final boolean suppressObservedNumbers) {
        if (battle == null || battle.players == null || rec == null) {
            return false;
        }
        final List<String> recorderKills = new ArrayList<>();
        final List<String> killersOfRecorder = new ArrayList<>();
        final Map<Long, PlayerResult> byAccount = new LinkedHashMap<>();
        for (final PlayerResult p : battle.players) {
            byAccount.putIfAbsent(p.accountId, p);
        }
        // killer identity derives ONLY from canonical terminal evidence
        // (PlaybackCombatReconstruction.destroyed: timeSec + victimAccountId + reliable killerAccountId).
        // The stale PlayerResult.killVictims (damage-threshold heuristic) is removed; a terminal with no
        // reliably attributed killer is reported as UNKNOWN, never guessed from cumulative damage.
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat = combat(battle, recon);
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Destroyed destroyed
                : combat.destroyed()) {
            if (destroyed.victimAccountId() == rec.accountId) {
                final PlayerResult killer = destroyed.killerAccountId() == null
                        ? null : byAccount.get(destroyed.killerAccountId());
                final String killerLabel = killer != null
                        ? EntityIdentityResolver.label(battle, killer, rec.accountId) : "UNKNOWN";
                if (killer != null) {
                    final int lethalTotal = dealtTo(combat, destroyed.killerAccountId(),
                            rec.accountId, destroyed.timeSec());
                    killersOfRecorder.add(killerLabel + (suppressObservedNumbers ? ""
                            : " 致死前对你累计造成" + lethalTotal + "点伤害"));
                } else {
                    // canonical terminal without reliable attacker attribution: honest UNKNOWN
                    killersOfRecorder.add(killerLabel);
                }
            } else if (destroyed.killerAccountId() != null
                    && destroyed.killerAccountId() == rec.accountId) {
                final PlayerResult victim = byAccount.get(destroyed.victimAccountId());
                if (victim == null) continue;
                final int lethalTotal = dealtTo(combat, rec.accountId,
                        destroyed.victimAccountId(), destroyed.timeSec());
                recorderKills.add(EntityIdentityResolver.label(battle, victim, rec.accountId)
                        + (suppressObservedNumbers ? "" : " 致死前累计承受你" + lethalTotal + "点伤害"));
            }
        }
        if (recorderKills.isEmpty() && killersOfRecorder.isEmpty()) {
            return false;
        }
        sb.append("\n=== KILL_ATTRIBUTION_OBSERVED（击杀归因·事件流观测） ===\n");
        if (suppressObservedNumbers) {
            sb.append("注意: 事件流观测覆盖不全（OBSERVED_DAMAGE_IS_PARTIAL），"
                    + "伤害数字已抑制；仅保留击杀身份。\n");
        }
        for (final String line : recorderKills) {
            sb.append("你击杀了 ").append(line).append('\n');
        }
        for (final String line : killersOfRecorder) {
            sb.append("击杀你的是 ").append(line).append('\n');
        }
        return true;
    }
}

package com.wotb.web.replay.ai;

import com.wotb.core.ai.EntityIdentityResolver;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Player 复盘证据格式化器：把结算数据与事件流证据渲染成确定性证据文本。
 * <p>从 {@link PlayerReplayPromptBuilder} 拆出，职责仅限证据渲染（阵容行、逐次伤害、
 * 击毁归因、死亡时间线、移动/区域时间线、交火/阶段/关键事件、队伍聚合与排名）；
 * 不包含 prompt 规则/多语言与 prepare* 编排。</p>
 * <p>纯静态工具类，不引入 Spring AI，不包含 API key 或 {@code Map<String,Object>} Provider 请求体。</p>
 */
final class PlayerEvidenceFormatter {

    private PlayerEvidenceFormatter() {
    }

    private static final Tankopedia tankopedia = Tankopedia.load();

    private static String regionLabel(final float rawX, final float rawZ, final String mapCode) {
        final MapCoordinateResolution res = MapRegionResolver.resolve(rawX, rawZ, mapCode);
        if (!res.usable()) return "未知区域";
        return res.region() + "区";
    }

    /**
     * 权威掉血重建（§11–§17 唯一可信伤害源）：连续可信 Type-7 HP sample 推导 + 攻击者 attribution。
     * 所有「造成/承受伤害、逐次伤害、窗口掉血」证据一律从这里取，不得再读 Type-8 raw 值。
     */
    private static com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat(
            final Battle battle, final ReplayReconstruction recon) {
        if (recon == null || recon.events() == null) {
            return new com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result(
                    java.util.Map.of(), java.util.List.of());
        }
        final TeamEntityMapping mapping = DamageEventIdentityResolver.mapping(battle, recon);
        final Float start = recon.battleStartRawClockSec();
        final double duration = recon.replayDurationSec() > 0 ? recon.replayDurationSec()
                : (battle != null && battle.durationS != null && battle.durationS > 0
                        ? battle.durationS : 0.0);
        return com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                recon.events(), mapping, start == null ? 0.0 : start.doubleValue(), duration);
    }

    /** 攻击者 A 对目标 V 在 t 之前（含）发生的、有支持证据的掉血（dealt 口径，§13）。 */
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

    /** 目标阵亡时刻（battle-relative 秒；存活/未知 → 战斗时长）。 */
    private static double deathSecOrEnd(final PlayerResult target,
                                        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat) {
        if (target != null) {
            final double death = PlayerResultFormat.deathSec(target);
            if (death > 0) {
                return death;
            }
        }
        double last = 0;
        for (final java.util.Map.Entry<Long, List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> e
                : combat.lossesByVictim().entrySet()) {
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l : e.getValue()) {
                last = Math.max(last, l.toSec());
            }
        }
        return last;
    }

    /**
     * 录像者对每个目标的直接伤害（§12/§13 权威掉血口径：attributed HP loss，属观测子集）。
     * <p>目标只用「昵称 + 权威坦克名称 + 结构化车种」标识，不附加任何由名称推断的属性，
     * 使 AI 能写出「你对敌方 &lt;坦克名称&gt; 造成了 N 点伤害」而无需猜测车辆类型。</p>
     */
    static boolean appendRecorderDamageExchange(final StringBuilder sb,
                                                final Battle battle,
                                                final ReplayReconstruction recon,
                                                final PlayerResult rec) {
        return appendRecorderDamageExchange(sb, battle, recon, rec, false);
    }

    /**
     * 录像者逐目标累计伤害（权威掉血观测子集，仅含可证明攻击者归属的部分）：
     * {@code OBSERVED_DAMAGE_IS_PARTIAL} 时抑制全部累计伤害数字，输出稳定 UNAVAILABLE 标记。
     */
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
        // 逐目标聚合：有支持证据的掉血（attacker==recorder 且 attackerReliable）
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

    /**
     * 逐对手双向对炮明细，来自事件流的 {@link DamageEvent}（含 attacker/victim accountId 与伤害值）。
     * <p>覆盖所有交火过的对手，而不只是被击杀的对手（{@code killVictims} 只记录击杀前的伤害）。
     * 目标只用「昵称 + 权威坦克名称 + 结构化车种」标识；准备阶段（开战前）的伤害不计入。</p>
     *
     * @return 是否输出了内容
     */
    static boolean appendDamageExchangeByOpponent(final StringBuilder sb,
                                                  final Battle battle,
                                                  final long recorderAccountId,
                                                  final ReplayReconstruction recon) {
        return appendDamageExchangeByOpponent(sb, battle, recorderAccountId, recon, false);
    }

    /**
     * 逐对手对炮（事件流观测子集）：{@code OBSERVED_DAMAGE_IS_PARTIAL} 时抑制全部数字，
     * 输出稳定 UNAVAILABLE 标记（与掉血窗口段一致），绝不一边输出数字一边声明已抑制。
     */
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
        final Map<Long, int[]> dealt = new LinkedHashMap<>();   // [伤害合计, 掉血次数]
        final Map<Long, int[]> received = new LinkedHashMap<>();
        // §12/§13：只消费权威掉血。dealt 仅计 attackerReliable 且有支持证据的掉血；
        // received 仅计可归属到具体攻击者的掉血（无法归属的受击掉血在掉血窗口段体现，
        // 不得伪造攻击者）。Type-8 rawProtocolValue 不得作为对炮伤害。
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

    /**
     * 逐次伤害事件（随机战个人复盘）。每条记录对应一个真实 {@link DamageEvent}，
     * 攻击者/受击者经 entityId→accountId 映射解析（真实 decoder 直填账号为 null），
     * 绝不颠倒方向；伤害值是本次事件伤害，与聚合观测子集严格区分。
     * 时间转换为战斗相对时间并输出「X分XX秒」。
     * <p>排除准备阶段（开战前）与 damage &lt;= 0 的事件；坦克名称来自 {@link ReplayDisplayNames}，
     * 无法映射时为「未知坦克」，不猜测。</p>
     *
     * @return 是否输出了内容
     */
    static boolean appendPerHitDamageEvents(final StringBuilder sb,
                                            final Battle battle,
                                            final long recorderAccountId,
                                            final ReplayReconstruction recon) {
        return appendPerHitDamageEvents(sb, battle, recorderAccountId, recon, false);
    }

    /**
     * 逐次伤害（事件流观测子集）：{@code OBSERVED_DAMAGE_IS_PARTIAL} 时抑制全部数字，
     * 输出稳定 UNAVAILABLE 标记（与掉血窗口段一致），绝不一边输出数字一边声明已抑制。
     */
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
        final List<double[]> rows = new ArrayList<>();   // {toSec, index into texts}
        final List<String> texts = new ArrayList<>();
        // §12/§13：逐条 = 一条权威掉血记录（Type-7 推导）。方向：attackerReliable 才写「造成」；
        // recorder 受击的掉血（无论是否可归属）写「承受」，来源不可证明时写「来源未知」。
        // Type-8 rawProtocolValue 语义未证明，不得作为单次伤害展示。
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
                    final String victimText = damageActorText(battle, byAccount.get(victim), recorderAccountId);
                    row = clock + "：你 对 " + victimText
                            + " 造成了" + loss.hpLoss() + "点伤害";
                } else {
                    final String attackerText = (loss.attackerReliable() && attacker != null)
                            ? damageActorText(battle, byAccount.get(attacker), recorderAccountId)
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
        // 跨 victim 的 lossesByVictim 遍历无序，逐条行按时间升序输出
        rows.sort(java.util.Comparator.comparingDouble(r -> r[0]));
        sb.append("\n=== PER_HIT_DAMAGE_EVENTS_OBSERVED（逐次伤害事件·事件流观测） ===\n");
        sb.append("注意: 每条都是单次伤害事件, 不是累计值; 方向由事件的攻击方/受击方账号确定.\n");
        for (final double[] row : rows) {
            sb.append(texts.get((int) row[1])).append('\n');
        }
        return true;
    }

    /**
     * 录像者掉血时间窗口（事件流观测）：按受击事件聚类，每窗口给出时间范围 + 总掉血量 + 不同攻击者数。
     * <p>与 {@code PER_HIT_DAMAGE_EVENTS} 同口径（battle-relative，准备阶段不计）；
     * {@code OBSERVED_DAMAGE_IS_PARTIAL} 时抑制数字并输出 UNAVAILABLE（与 Team 一致）。
     * 真实事件经 entityId → accountId 映射解析攻击者/受击者，不依赖恒为 null 的直填账号字段。</p>
     */
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

    /** 渲染录像者掉血窗口段（供 PlayerSummaryBuilder 与 TacticalReviewPromptBuilder 复用，口径一致）。 */
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

    /**
     * 敌方最后已知位置段（观测子集）。与 fallback 路径共用同一渲染器；
     * 无 OBSERVED 敌方记录或视角未解析时静默跳过，不输出噪音标记。
     */
    static void appendEnemyLastKnownPositions(final StringBuilder sb,
                                              final Battle battle,
                                              final ReplayReconstruction recon) {
        final String section = EnemyLastKnownPositionsSection.renderPlayerSection(battle, recon);
        if (section.isEmpty()) {
            return;
        }
        sb.append('\n').append(section);
    }

    /** 逐次伤害里的攻防双方称呼：玩家本人写「你」，其余写「阵营 + 昵称 + 驾驶的 <坦克名>」。 */
    private static String damageActorText(final Battle battle,
                                          final PlayerResult player,
                                          final long recorderAccountId) {
        if (player == null) {
            return "未知玩家驾驶的未知坦克";
        }
        final String tank = ReplayDisplayNames.tankName(player.tankId, player.tankName);
        if (player.accountId == recorderAccountId) {
            return "你驾驶的" + tank;
        }
        final Side side = PlayerSideResolver.resolve(battle, player);
        final String sideText = switch (side) {
            case FRIENDLY -> "队友";
            case ENEMY -> "敌方";
            case UNKNOWN -> "未知阵营";
        };
        return sideText + "玩家" + PlayerResultFormat.quoteForPrompt(player.nickname)
                + "驾驶的" + tank;
    }

    /** tankopedia 提供的结构化车辆事实（等级/国家）；缺失即为空串，绝不由名称推断。 */
    private static String structuredTankFacts(final long tankId) {
        return structuredTankFacts(tankId, null);
    }

    /** 同上；血量按 provenance 口径（OBSERVED_EXACT → 已证明进场满血；否则 tankopedia base）。 */
    private static String structuredTankFacts(final long tankId, final PlayerResult player) {
        final StringBuilder sb = new StringBuilder(24);
        EntityIdentityResolver.appendStructuredTankFacts(sb, tankId, player);
        return sb.toString();
    }

    /**
     * 击杀归因：谁击杀了录像者、录像者击杀了谁。
     * <p>来自各玩家的 {@code killVictims}（事件流对击杀前伤害的累计），
     * 目标一律用「阵营 + 昵称 + 权威坦克名 + 车种」标识。</p>
     *
     * @return 是否输出了内容
     */
    static boolean appendKillAttribution(final StringBuilder sb,
                                         final Battle battle,
                                         final ReplayReconstruction recon,
                                         final PlayerResult rec) {
        return appendKillAttribution(sb, battle, recon, rec, false);
    }

    /**
     * 击杀归因（权威掉血观测）：{@code OBSERVED_DAMAGE_IS_PARTIAL} 时仅保留已正向观察到的
     * 「你击杀了谁 / 谁击杀了你」身份信息，抑制「致死前累计 N 点伤害」等伤害数字。
     * 致死前累计 = 击杀者对该目标有支持证据的掉血（§13 attributed HP loss，toSec ≤ 目标阵亡时刻）；
     * 身份线索（谁杀谁）仍来自 killVictims，伤害数字不再使用 Type-8 raw。
     */
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
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat = combat(battle, recon);
        for (final com.wotb.core.model.KillVictim victim : rec.killVictims) {
            final PlayerResult target = byAccount.get(victim.victimAccountId());
            if (target == null) continue;
            final int lethalTotal = dealtTo(combat, rec.accountId,
                    victim.victimAccountId(), deathSecOrEnd(target, combat));
            recorderKills.add(EntityIdentityResolver.label(battle, target, rec.accountId)
                    + (suppressObservedNumbers ? "" : " 致死前累计承受你" + lethalTotal + "点伤害"));
        }
        for (final PlayerResult other : battle.players) {
            if (PlayerAnalysisPromptFormatter.isSamePlayer(other, rec)) continue;
            for (final com.wotb.core.model.KillVictim victim : other.killVictims) {
                if (victim.victimAccountId() != rec.accountId) continue;
                final int lethalTotal = dealtTo(combat, other.accountId,
                        rec.accountId, deathSecOrEnd(rec, combat));
                killersOfRecorder.add(EntityIdentityResolver.label(battle, other, rec.accountId)
                        + (suppressObservedNumbers ? "" : " 致死前对你累计造成" + lethalTotal + "点伤害"));
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

    static void appendPlayerLine(final StringBuilder sb, final PlayerResult p, final boolean isFriendly) {
        appendPlayerLine(sb, p, isFriendly, false);
    }

    /**
     * 阵容行。{@code isYou=true} 时该行描述上传回放的玩家本人，
     * 称呼写「你」；同队其他玩家写「队友」，对方写「敌方」。
     * 玩家本人不会再以「友方」出现，避免同一人既是「你」又是「友方」。
     */
    static void appendPlayerLine(final StringBuilder sb, final PlayerResult p,
                                 final boolean isFriendly, final boolean isYou) {
        final String tankDisplay = ReplayDisplayNames.tankName(p.tankId, p.tankName);
        final String deathStr = p.survived ? "存活"
                : "阵亡@" + PlayerAnalysisTerms.knownDeathClock(PlayerResultFormat.deathSec(p));
        sb.append(isYou ? "你 " : (isFriendly ? "队友 " : "敌方 "))
                .append(PlayerResultFormat.quoteForPrompt(p.nickname))
                .append(" 坦克: ").append(PlayerResultFormat.quoteForPrompt(tankDisplay))
                // 车种只来自 tankopedia 的结构化 class 字段，未提供时为「未知」；不得由名称推断
                .append(" 车种: ").append(ReplayDisplayNames.tankClass(p.tankId))
                .append(structuredTankFacts(p.tankId, p))
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
        sb.append("\n=== FRIENDLY_AUTHORITATIVE_RESULT（本队合计·权威结算，含你） ===\n");
        appendTeamAggregate(sb, friendlies);
        sb.append("=== ENEMY_AUTHORITATIVE_RESULT（敌方合计·权威结算） ===\n");
        appendTeamAggregate(sb, enemies);
        if (!unknowns.isEmpty()) {
            sb.append("=== UNKNOWN_AUTHORITATIVE_RESULT（未确定阵营合计·权威结算） ===\n");
            appendTeamAggregate(sb, unknowns);
        }
    }

    private static void appendTeamAggregate(final StringBuilder sb, final List<PlayerResult> players) {
        final int totalDmg = players.stream().mapToInt(p -> p.damageDealt).sum();
        final int totalRecv = players.stream().mapToInt(p -> p.damageReceived).sum();
        final int totalAssist = players.stream().mapToInt(p -> p.damageAssisted).sum();
        final int totalBlocked = players.stream().mapToInt(p -> p.damageBlocked).sum();
        final int totalKills = players.stream().mapToInt(p -> p.kills).sum();
        final long survivors = players.stream().filter(p -> p.survived).count();
        final long deaths = players.stream().filter(p -> !p.survived).count();
        final double firstDeath = players.stream()
                .filter(p -> !p.survived && PlayerResultFormat.deathSec(p) > 0)
                .mapToDouble(PlayerResultFormat::deathSec)
                .min().orElse(-1);
        final double lastDeath = players.stream()
                .filter(p -> !p.survived && PlayerResultFormat.deathSec(p) > 0)
                .mapToDouble(PlayerResultFormat::deathSec)
                .max().orElse(-1);
        sb.append("总伤害: ").append(totalDmg)
                .append(" 总损失血量: ").append(totalRecv)
                .append(" 总助攻: ").append(totalAssist)
                .append(" 总格挡: ").append(totalBlocked)
                .append(" 总击杀: ").append(totalKills)
                .append(" 存活: ").append(survivors)
                .append(" 阵亡: ").append(deaths);
        if (deaths > 0) {
            sb.append(" 首阵亡: ").append(PlayerAnalysisTerms.knownDeathClock(firstDeath));
            sb.append(" 末阵亡: ").append(PlayerAnalysisTerms.knownDeathClock(lastDeath));
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

        if (!rec.survived && rec.deathTimeMillis > 0) {
            final double deathSec = rec.deathTimeMillis / 1000.0;
            final int deathOrder = (int) friendlies.stream()
                    .filter(p -> !p.survived && PlayerResultFormat.deathSec(p) < deathSec)
                    .count() + 1;
            final double battleDur = battle.durationS != null && battle.durationS > 0 ? battle.durationS : deathSec;
            final double progressRatio = deathSec / battleDur;
            final List<PlayerResult> allPlayers = battle.players != null ? battle.players : List.of();
            final Map<PlayerResult, Side> sides = PlayerSideResolver.resolveAll(battle);
            final long friendlyAlive = friendlies.stream()
                    .filter(p -> p.survived || PlayerResultFormat.deathSec(p) > deathSec).count();
            final long enemyAlive = allPlayers.stream()
                    .filter(p -> sides.getOrDefault(p, Side.UNKNOWN) == Side.ENEMY)
                    .filter(p -> p.survived || PlayerResultFormat.deathSec(p) > deathSec).count();

            sb.append(" 死亡时间: ").append(PlayerAnalysisTerms.knownDeathClock(deathSec));
            sb.append(" 你在本队的阵亡序位: ").append(deathOrder).append("/").append(totalFriendly);
            sb.append(" 战斗进度: ").append(String.format("%.0f%%", progressRatio * 100));
            sb.append(" 你阵亡时本队存活: ").append(friendlyAlive);
            sb.append(" 阵亡时敌方存活: ").append(enemyAlive);
        }
        sb.append('\n');
    }

    static void appendDeathTimeline(final StringBuilder sb, final Battle battle) {
        final List<PlayerResult> dead = battle.players != null ? battle.players.stream()
                .filter(p -> !p.survived)
                // 未知死亡时间（deathSec<=0）排到已知时间之后，绝不因 0 被排到整场最前
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
            // 玩家本人写「你」，同队写「队友」，对方写「敌方」；本人绝不出现为「友方/队友」
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

    static void appendEventStreamEvidence(final StringBuilder sb,
                                            final SinglePlayerBattleAnalysisContext ctx,
                                            final Battle battle) {
        final var features = ctx.features();

        // Entity mapping evidence
        sb.append("\n=== 重建补充 ===\n");
        if (ctx.recorder() != null && ctx.recorder().resolved()) {
            sb.append("你的 entity 已映射, 特征集可用\n");
            // 玩家本人只称「你」：不附加 侧=（本人既不是友方也不是队友）；
            // 阵营解析失败由既有 limitation 表达，不在这里写「侧=未知」
            sb.append("你: 账号 ").append(ctx.recorder().accountId())
                    .append(" | 车辆: ").append(PlayerResultFormat.quoteForPrompt(ReplayDisplayNames.tankName(ctx.recorder().tankId(), null)))
                    .append(" | 车种: ").append(ReplayDisplayNames.tankClass(ctx.recorder().tankId() != null ? ctx.recorder().tankId() : 0L))
                    .append('\n');
        } else {
            sb.append("位置流存在, 但你的实体无法可靠映射\n");
        }

        // ====== RECORDER_REGION_TIMELINE_BACKEND_COMPUTED（你的区域时间线·后端计算） ======
        appendRecorderMovementEvidence(sb, features.movements(),
                battle == null ? null : battle.mapName);

        // ====== KEY_EVENTS_BACKEND_COMPUTED ======
        if (features.keyEvents() != null && !features.keyEvents().isEmpty()) {
            sb.append("\n=== KEY_EVENTS_BACKEND_COMPUTED（关键事件·后端计算） ===\n");
            String lastEventKey = null;
            for (final KeyBattleEvent ke : features.keyEvents()) {
                final String eventKey = ke.clockSec() + "|" + ke.type();
                if (eventKey.equals(lastEventKey)) continue;
                lastEventKey = eventKey;
                sb.append(PlayerAnalysisTerms.battleClock(ke.clockSec())).append(" | ")
                        .append(PlayerAnalysisTerms.keyEventLabel(ke.type()));
                if (ke.label() != null && !ke.label().isEmpty()) {
                    sb.append(" | ").append(PlayerResultFormat.quoteForPrompt(ke.label()));
                }
                sb.append(" | 置信度=").append(PlayerAnalysisTerms.confidenceLabel(ke.confidence()));
                sb.append('\n');
            }
        }

        int observedDealt = 0;
        int observedReceived = 0;
        if (!features.engagements().isEmpty()) {
            for (final EngagementSummary e : features.engagements()) {
                observedDealt += e.damageDealt();
                observedReceived += e.damageReceived();
            }
            final int finalAuthDealt = battle.recorderResult() != null ? battle.recorderResult().damageDealt : 0;
            final int finalAuthRecv = battle.recorderResult() != null ? battle.recorderResult().damageReceived : 0;
            sb.append("\n=== 交火段（事件流观测子集） ===\n");
            final boolean observedPartial = features.limitations() != null
                    && features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
            if (observedPartial) {
                sb.append("权威结算总输出: ").append(finalAuthDealt)
                        .append(" | 事件流观测子集覆盖不全（OBSERVED_DAMAGE_IS_PARTIAL），")
                        .append("观测数字已抑制；以权威结算为唯一可信口径，不得引用事件流观测数字。\n");
            } else {
                sb.append("权威结算总输出: ").append(finalAuthDealt)
                        .append(" | 事件流观测输出子集: ").append(observedDealt)
                        .append(" (").append(String.format("%.0f%%", finalAuthDealt > 0 ? 100.0 * observedDealt / finalAuthDealt : 0))
                        .append(")\n");
                sb.append("权威结算总损失血量: ").append(finalAuthRecv)
                        .append(" | 事件流观测损失血量子集: ").append(observedReceived)
                        .append(" (").append(String.format("%.0f%%", finalAuthRecv > 0 ? 100.0 * observedReceived / finalAuthRecv : 0))
                        .append(")\n");
                sb.append("注意: 事件流数值仅为观测子集, 不是整场权威总伤害.\n");
            }
            // 覆盖不全时逐条交火数字同样是事件流伤害数字：一并抑制，不输出任何 N
            if (!observedPartial) {
                for (final EngagementSummary e : features.engagements()) {
                    sb.append("  #" + " ")
                            .append(PlayerAnalysisTerms.battleRange(e.startTime(), e.endTime()))
                            .append(" 事件流输出: ").append(e.damageDealt())
                            .append(" 事件流损失血量: ").append(e.damageReceived())
                            .append(" 置信度: ").append(PlayerAnalysisTerms.confidenceLabel(e.confidence()))
                            .append('\n');
                }
            }
        }

        final String phaseSection = BattlePhaseTimelineSection.renderPlayerSection(
                features.phases(),
                battle == null ? null : BattlePhaseSummary.deathSourceLabel(battle));
        if (!phaseSection.isEmpty()) {
            sb.append("\n").append(phaseSection);
        }

        sb.append("\n覆盖: ").append(ctx.coverage() != null ? ctx.coverage().decodedPacketRatio() : "N/A").append('\n');

        // ====== 数据限制 ======
        if (!ctx.limitations().isEmpty()) {
            sb.append("\n=== 数据限制 ===\n");
            for (final String limitation : ctx.limitations()) {
                sb.append("- ").append(limitation).append('\n');
            }
        }
    }

    /**
     * 个人走位/区域时间线（RECORDER_REGION_TIMELINE + 压缩移动段）。
     * 随机战 Harness（Call #2）与 fallback 路径共用；无移动段时不输出。
     */
    static void appendRecorderMovementEvidence(final StringBuilder sb,
                                               final List<MovementSegment> movements,
                                               final String mapCode) {
        if (movements == null || movements.isEmpty()) {
            return;
        }
        sb.append("\n=== RECORDER_REGION_TIMELINE_BACKEND_COMPUTED（你的区域时间线·后端计算） ===\n");
        final java.util.ArrayList<String> orderedRegions = new java.util.ArrayList<>();
        String lastRegion = null;
        for (final MovementSegment seg : movements) {
            final int startRegion = seg.rawStartPosition() != null
                    ? MapRegionResolver.resolveRegionFromRaw(
                            seg.rawStartPosition().x(), seg.rawStartPosition().z(), mapCode) : 0;
            final int endRegion = seg.rawEndPosition() != null
                    ? MapRegionResolver.resolveRegionFromRaw(
                            seg.rawEndPosition().x(), seg.rawEndPosition().z(), mapCode) : 0;
            final String startStr = startRegion > 0 ? startRegion + "区" : "未知区域";
            final String endStr = endRegion > 0 ? endRegion + "区" : "未知区域";
            if (!startStr.equals(lastRegion)) {
                sb.append(PlayerAnalysisTerms.battleClock(seg.startTime())).append("：").append(startStr).append('\n');
                if (startRegion > 0) orderedRegions.add(String.valueOf(startRegion));
                lastRegion = startStr;
            }
            if (!endStr.equals(lastRegion)) {
                sb.append(PlayerAnalysisTerms.battleClock(seg.endTime())).append("：").append(endStr).append('\n');
                if (endRegion > 0) orderedRegions.add(String.valueOf(endRegion));
                lastRegion = endStr;
            }
        }
        if (!orderedRegions.isEmpty()) {
            sb.append("压缩区域序列：").append(String.join("→", orderedRegions)).append('\n');
            sb.append("最终区域：").append(orderedRegions.getLast()).append("区\n");
        }
        sb.append("\n=== 移动段（压缩） ===\n");
        for (final MovementSegment seg : movements) {
            sb.append("  ").append(PlayerAnalysisTerms.battleRange(seg.startTime(), seg.endTime())).append(" ")
                    .append(PlayerAnalysisTerms.movementLabel(seg.type())).append(" | 距离 ")
                    .append(String.format("%.1f", seg.distance()))
                    .append("m 速度 ").append(String.format("%.1f", seg.averageSpeed())).append("m/s");
            if (seg.rawStartPosition() != null) {
                sb.append(" 从").append(regionLabel(
                        seg.rawStartPosition().x(), seg.rawStartPosition().z(), mapCode));
            }
            if (seg.rawEndPosition() != null) {
                sb.append(" 到").append(regionLabel(
                        seg.rawEndPosition().x(), seg.rawEndPosition().z(), mapCode));
            }
            sb.append('\n');
        }
    }

}

package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * HP 动量 Skill（文档 §17）：计算双方可观察 HP 差随时间变化，找出明显 Swing 窗口。
 * <p>严格遵守观察性约束：只有 {@code observationState == OBSERVED} 且血量可靠的实体才计入；
 * {@code LifeState.DESTROYED} 是可靠终态，按 0 HP 计入；
 * 两个采样点之间只使用<strong>两端共同可靠观察的实体</strong>计算 HP delta——
 * 较早采样点观察到的实体在较晚采样点消失（unspot / STALE / 普通 REMOVED）时，
 * 该实体无法可靠比较，直接排除、不贡献任何 delta，绝不把 unspot 当作 damage。</p>
 */
public final class HpMomentumSkill {

    public static final float SAMPLE_INTERVAL_SEC = 10f;
    public static final float MAX_SWING_SPAN_SEC = 30f;
    public static final double SWING_THRESHOLD_RATIO = 0.15;
    public static final double CRITICAL_SWING_RATIO = 0.30;
    public static final double COVERAGE_HIGH = 0.9;
    public static final int MAX_WINDOWS = 3;
    static final double MIN_SWING_HP = 2000;

    /**
     * 单个采样点：battle-relative 时间、逐实体可观察 HP 与队伍、双方可观察 HP 和、HP 差、覆盖率。
     * <p>{@code hpByEntityId} 只包含 {@code OBSERVED} 且血量可靠的实体；
     * {@code lead} 只是当前观察集合的展示值，不代表"全队 HP 优势"。</p>
     */
    public record HpMomentumSample(
            float battleRelSec,
            Map<Integer, Integer> hpByEntityId,
            Map<Integer, Integer> teamByEntityId,
            double team1Hp,
            double team2Hp,
            double lead,
            double observedCoverage,
            int totalPlayers
    ) {
        public HpMomentumSample {
            hpByEntityId = hpByEntityId == null ? Map.of() : Map.copyOf(hpByEntityId);
            teamByEntityId = teamByEntityId == null ? Map.of() : Map.copyOf(teamByEntityId);
        }

        public Set<Integer> observedEntities() {
            return hpByEntityId.keySet();
        }
    }

    /**
     * 生成 HP 动量采样序列（仅供 Skill 内部安全比较与引擎输出使用；
     * 不再直接渲染进 LLM Prompt——raw 逐采样 HP 曲线会把 observation membership change
     * 伪装成 HP momentum）。
     * battleStartRawClockSec 不可用或检查点为空时返回空列表。
     */
    public List<HpMomentumSample> sample(final ReplayReconstruction recon, final Battle battle) {
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            return List.of();
        }
        final Float startRaw = recon.battleStartRawClockSec();
        if (startRaw == null || !Float.isFinite(startRaw) || startRaw <= 0f) {
            return List.of();
        }
        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));
        final Map<Long, Integer> teamByAccountId = teamByAccountId(battle);

        final float endSec = battle.durationS != null
                ? battle.durationS.floatValue()
                : Math.max(0f, sorted.getLast().rawClockSec() - startRaw);
        final List<HpMomentumSample> result = new ArrayList<>();
        for (float rel = 0f; rel <= endSec + 0.001f; rel += SAMPLE_INTERVAL_SEC) {
            final BattleStateCheckpoint cp = closestCheckpoint(sorted, startRaw + rel);
            if (cp == null) {
                continue;
            }
            final float sampleRel = cp.rawClockSec() - startRaw;
            // 同一检查点重复采样会伪造"状态持续不变"，跳过
            if (!result.isEmpty() && sampleRel <= result.getLast().battleRelSec()) {
                continue;
            }
            final Map<Integer, Integer> hpByEntityId = new HashMap<>();
            final Map<Integer, Integer> teamByEntityId = new HashMap<>();
            double team1Hp = 0;
            double team2Hp = 0;
            int known = 0;
            for (final VehicleState vs : cp.stateSnapshot().vehiclesByEntityId().values()) {
                final boolean confirmedDestroyed = vs.lifeState() == LifeState.DESTROYED;
                final boolean observedWithHp = vs.observationState() == ObservationState.OBSERVED
                        && vs.currentHealth() != null && vs.currentHealth() > 0;
                if (!confirmedDestroyed && !observedWithHp) {
                    continue;
                }
                final Integer team = teamOf(vs, teamByAccountId);
                if (team == null) {
                    continue;
                }
                final int hp = confirmedDestroyed ? 0 : vs.currentHealth();
                hpByEntityId.put(vs.entityId(), hp);
                teamByEntityId.put(vs.entityId(), team);
                if (team == 1) {
                    team1Hp += hp;
                } else {
                    team2Hp += hp;
                }
                known++;
            }
            final int total = battle.nPlayers();
            final double coverage = total > 0 ? (double) known / total : 0;
            result.add(new HpMomentumSample(
                    sampleRel, hpByEntityId, teamByEntityId,
                    team1Hp, team2Hp, team1Hp - team2Hp, coverage, total));
        }
        return result;
    }

    /**
     * 在采样序列上寻找明显 Swing 窗口并合并重叠区间。
     * 阈值 = 全队 HP 池估计值的 {@value #SWING_THRESHOLD_RATIO}（下限 {@value #MIN_SWING_HP}）。
     */
    public List<AiEvidence> detect(final List<HpMomentumSample> samples) {
        if (samples == null || samples.size() < 2) {
            return List.of();
        }
        final double pool = maxPool(samples);
        final double threshold = Math.max(MIN_SWING_HP, pool * SWING_THRESHOLD_RATIO);

        final List<Swing> candidates = new ArrayList<>();
        for (int i = 0; i < samples.size(); i++) {
            for (int j = i + 1; j < samples.size(); j++) {
                final HpMomentumSample a = samples.get(i);
                final HpMomentumSample b = samples.get(j);
                if (b.battleRelSec() - a.battleRelSec() > MAX_SWING_SPAN_SEC) {
                    continue;
                }
                final Swing swing = commonEntitySwing(a, b);
                if (swing == null || swing.swing() < threshold) {
                    continue;
                }
                candidates.add(swing);
            }
        }
        if (candidates.isEmpty()) {
            return List.of();
        }
        candidates.sort(Comparator.comparingDouble(Swing::startSec));
        final List<Swing> merged = new ArrayList<>();
        for (final Swing c : candidates) {
            if (!merged.isEmpty() && c.startSec() <= merged.getLast().endSec()) {
                final Swing last = merged.removeLast();
                // 代表性 HP 数值必须来自同一个 comparison cohort：
                // 取该 merge group 中 hpSwing 最大的单个可靠候选，before/after/swing/coverage/commonEntityCount 一起取
                final Swing representative = last.swing() >= c.swing() ? last : c;
                final float start = Math.min(last.startSec(), c.startSec());
                final float end = Math.max(last.endSec(), c.endSec());
                merged.add(new Swing(start, end,
                        representative.before(), representative.after(),
                        representative.swing(), representative.coverage(),
                        representative.commonEntityCount()));
            } else {
                merged.add(c);
            }
        }

        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final Swing s : merged) {
            if (index >= MAX_WINDOWS) {
                break;
            }
            index++;
            final boolean critical = s.swing() >= pool * CRITICAL_SWING_RATIO;
            final DecodeConfidence confidence = s.coverage() >= COVERAGE_HIGH
                    ? DecodeConfidence.INFERRED : DecodeConfidence.PARTIAL;
            final Map<String, Double> numbers = new HashMap<>();
            numbers.put("hpLeadBefore", s.before());
            numbers.put("hpLeadAfter", s.after());
            numbers.put("hpSwing", s.swing());
            numbers.put("poolEstimate", pool);
            numbers.put("observedCoverage", s.coverage());
            numbers.put("commonEntityCount", (double) s.commonEntityCount());
            final String summary = String.format(
                    "可观察 HP 差 %.0f → %.0f（共同观察实体 %d 个，摆动 %.0f，覆盖率 %.2f）",
                    s.before(), s.after(), s.commonEntityCount(), s.swing(), s.coverage());
            result.add(new AiEvidence(
                    String.format("HM_%02d", index),
                    EvidenceType.HP_MOMENTUM,
                    s.startSec(),
                    s.endSec(),
                    List.of(),
                    numbers,
                    Map.of(),
                    confidence,
                    critical ? EvidencePriority.CRITICAL : EvidencePriority.IMPORTANT,
                    EvidenceProvenance.RECONSTRUCTION_INFERRED,
                    summary));
        }
        return result;
    }

    /**
     * 只在两端共同可靠观察的实体上计算 HP delta（可证明不会把 unspot 当 damage）。
     * <p>共同实体 = a 的观察集与 b 的观察集（含 confirmed DESTROYED 的 0 HP）的交集；
     * 在 a 中观察但 b 中消失（unspot / STALE / 普通 REMOVED）的实体直接排除、
     * 不贡献任何 delta。交集为空时返回 {@code null}（无可可靠比较实体）。</p>
     */
    private static Swing commonEntitySwing(final HpMomentumSample a, final HpMomentumSample b) {
        final Set<Integer> common = new HashSet<>(a.observedEntities());
        common.retainAll(b.observedEntities());
        if (common.isEmpty()) {
            return null;
        }
        double team1Delta = 0;
        double team2Delta = 0;
        for (final int entityId : common) {
            final double hpBefore = a.hpByEntityId().get(entityId);
            final double hpAfter = b.hpByEntityId().get(entityId);
            // 只计负向变化（伤害）；正向视为数据伪影，不累计
            final double delta = Math.min(0.0, hpAfter - hpBefore);
            if (a.teamByEntityId().getOrDefault(entityId, 0) == 1) {
                team1Delta += delta;
            } else {
                team2Delta += delta;
            }
        }
        final double before = leadOver(a, common);
        final double after = leadOver(b, common);
        final double coverage = a.totalPlayers() > 0
                ? (double) common.size() / a.totalPlayers() : 0;
        return new Swing(a.battleRelSec(), b.battleRelSec(),
                before, after, Math.abs(team1Delta - team2Delta), coverage, common.size());
    }

    /** 在指定实体集合上计算队伍 1 与队伍 2 的 HP 差。 */
    private static double leadOver(final HpMomentumSample sample, final Set<Integer> entities) {
        double t1 = 0;
        double t2 = 0;
        for (final int entityId : entities) {
            final int team = sample.teamByEntityId().getOrDefault(entityId, 0);
            final double hp = sample.hpByEntityId().get(entityId);
            if (team == 1) {
                t1 += hp;
            } else {
                t2 += hp;
            }
        }
        return t1 - t2;
    }

    private record Swing(float startSec, float endSec, double before, double after,
                         double swing, double coverage, int commonEntityCount) {
    }

    private static BattleStateCheckpoint closestCheckpoint(
            final List<BattleStateCheckpoint> sorted, final float targetRaw) {
        BattleStateCheckpoint best = null;
        float bestDiff = Float.MAX_VALUE;
        for (final BattleStateCheckpoint cp : sorted) {
            final float diff = Math.abs(cp.rawClockSec() - targetRaw);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = cp;
            }
            if (cp.rawClockSec() >= targetRaw) {
                break;
            }
        }
        return best;
    }

    private static double maxPool(final List<HpMomentumSample> samples) {
        double max = 0;
        for (final HpMomentumSample s : samples) {
            max = Math.max(max, s.team1Hp() + s.team2Hp());
        }
        return max;
    }

    private static Map<Long, Integer> teamByAccountId(final Battle battle) {
        final Map<Long, Integer> map = new HashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p.accountId > 0) {
                    map.put(p.accountId, p.team);
                }
            }
        }
        return map;
    }

    private static Integer teamOf(final VehicleState vs, final Map<Long, Integer> teamByAccountId) {
        if (vs.team() != null) {
            return vs.team();
        }
        final Long accountId = vs.accountId();
        return accountId == null ? null : teamByAccountId.get(accountId);
    }
}

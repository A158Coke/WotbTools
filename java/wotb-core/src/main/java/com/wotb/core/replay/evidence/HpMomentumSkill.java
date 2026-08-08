package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * HP 动量 Skill（文档 §17）：计算双方可观察 HP 差随时间变化，找出明显 Swing 窗口。
 * <p>严格遵守观察性约束：只有 {@code observationState == OBSERVED} 且血量已知的实体才计入，
 * 并输出 {@code observedCoverage}；覆盖率低时置信度降为 PARTIAL。</p>
 */
public final class HpMomentumSkill {

    public static final float SAMPLE_INTERVAL_SEC = 10f;
    public static final float MAX_SWING_SPAN_SEC = 30f;
    public static final double SWING_THRESHOLD_RATIO = 0.15;
    public static final double CRITICAL_SWING_RATIO = 0.30;
    public static final double COVERAGE_HIGH = 0.9;
    public static final int MAX_WINDOWS = 3;
    static final double MIN_SWING_HP = 2000;

    /** 单个采样点：battle-relative 时间、双方可观察 HP、HP 差、覆盖率。 */
    public record HpMomentumSample(
            float battleRelSec,
            double team1Hp,
            double team2Hp,
            double lead,
            double observedCoverage
    ) {
    }

    /**
     * 生成 HP 动量采样序列（供 Prompt 渲染紧凑曲线）。
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
            double team1Hp = 0;
            double team2Hp = 0;
            int known = 0;
            for (final VehicleState vs : cp.stateSnapshot().vehiclesByEntityId().values()) {
                if (vs.observationState() != ObservationState.OBSERVED
                        || vs.currentHealth() == null || vs.currentHealth() <= 0) {
                    continue;
                }
                final Integer team = teamOf(vs, teamByAccountId);
                if (team == null) {
                    continue;
                }
                if (team == 1) {
                    team1Hp += vs.currentHealth();
                } else {
                    team2Hp += vs.currentHealth();
                }
                known++;
            }
            final int total = battle.nPlayers();
            final double coverage = total > 0 ? (double) known / total : 0;
            result.add(new HpMomentumSample(sampleRel, team1Hp, team2Hp, team1Hp - team2Hp, coverage));
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
                final double swing = Math.abs(b.lead() - a.lead());
                if (swing >= threshold) {
                    candidates.add(new Swing(a.battleRelSec(), b.battleRelSec(),
                            a.lead(), b.lead(), swing, Math.min(a.observedCoverage(), b.observedCoverage())));
                }
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
                final float start = Math.min(last.startSec(), c.startSec());
                final float end = Math.max(last.endSec(), c.endSec());
                final double before = c.startSec() <= last.startSec() ? c.before() : last.before();
                final double after = c.endSec() >= last.endSec() ? c.after() : last.after();
                final double maxSwing = Math.max(last.swing(), c.swing());
                final double coverage = Math.min(last.coverage(), c.coverage());
                merged.add(new Swing(start, end, before, after, maxSwing, coverage));
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
            final String summary = String.format("HP 优势 %.0f → %.0f（摆动 %.0f，覆盖率 %.2f）",
                    s.before(), s.after(), s.swing(), s.coverage());
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

    private record Swing(float startSec, float endSec, double before, double after,
                         double swing, double coverage) {
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

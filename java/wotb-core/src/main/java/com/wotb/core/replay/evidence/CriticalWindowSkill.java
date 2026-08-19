package com.wotb.core.replay.evidence;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 关键决策窗口 Skill（文档 §16）：把其它 Skill 的信号合并成"战局发生明显变化"的时间窗口。
 * <p>只负责找窗口、给确定性优先级；不判断谁背锅、不判断是否犯错。</p>
 */
public final class CriticalWindowSkill {

    public static final float MERGE_GAP_SEC = 30f;
    public static final int MAX_WINDOWS = 5;
    static final double CRITICAL_SWING_RATIO = HpMomentumSkill.CRITICAL_SWING_RATIO;
    static final double IMPORTANT_SWING_RATIO = HpMomentumSkill.SWING_THRESHOLD_RATIO;

    public List<AiEvidence> detect(final List<AiEvidence> signals) {
        if (signals == null || signals.isEmpty()) {
            return List.of();
        }
        final List<AiEvidence> candidates = signals.stream()
                .filter(e -> e.type() == EvidenceType.HP_MOMENTUM
                        || e.type() == EvidenceType.DEATH_CASCADE
                        || e.type() == EvidenceType.LOCAL_SUPPORT
                        || e.type() == EvidenceType.ENGAGEMENT_TRADE
                        || e.type() == EvidenceType.ROUTE)
                .sorted(Comparator.comparingDouble(AiEvidence::startSec))
                .toList();
        if (candidates.isEmpty()) {
            return List.of();
        }

        final List<List<AiEvidence>> merged = new ArrayList<>();
        for (final AiEvidence e : candidates) {
            boolean joined = false;
            for (final List<AiEvidence> group : merged) {
                if (overlapsOrNear(group.getLast(), e)) {
                    group.add(e);
                    joined = true;
                    break;
                }
            }
            if (!joined) {
                final List<AiEvidence> group = new ArrayList<>();
                group.add(e);
                merged.add(group);
            }
        }

        final List<AiEvidence> windows = new ArrayList<>();
        for (final List<AiEvidence> group : merged) {
            final WindowSignal signal = WindowSignal.from(group);
            if (signal.priority() == EvidencePriority.NORMAL) {
                continue;
            }
            windows.add(new AiEvidence(
                    "CW_%02d".formatted(windows.size() + 1),
                    EvidenceType.CRITICAL_WINDOW,
                    signal.startSec(),
                    signal.endSec(),
                    List.of(),
                    signal.numbers(),
                    signal.labels(),
                    signal.confidence(),
                    signal.priority(),
                    EvidenceProvenance.BACKEND_SKILL,
                    signal.summary()));
        }
        windows.sort(Comparator.comparing((AiEvidence w) -> w.priority().ordinal())
                .thenComparingDouble(AiEvidence::startSec));
        return windows.size() <= MAX_WINDOWS ? windows : windows.subList(0, MAX_WINDOWS);
    }

    private static boolean overlapsOrNear(final AiEvidence a, final AiEvidence b) {
        return a.endSec() + MERGE_GAP_SEC >= b.startSec()
                && b.endSec() + MERGE_GAP_SEC >= a.startSec();
    }

    /** 聚合窗口信号（数值全部来自确定性证据）。 */
    private record WindowSignal(
            float startSec,
            float endSec,
            Map<String, Double> numbers,
            Map<String, String> labels,
            DecodeConfidence confidence,
            EvidencePriority priority,
            String summary
    ) {
        static WindowSignal from(final List<AiEvidence> group) {
            float start = Float.MAX_VALUE;
            float end = 0f;
            int friendlyDeaths = 0;
            int enemyDeaths = 0;
            int recorderDamageDealt = 0;
            int recorderDamageReceived = 0;
            double hpLeadBefore = Double.NaN;
            double hpLeadAfter = Double.NaN;
            double pool = 0;
            double coverage = 1.0;
            int friendlyDelta = 0;
            int enemyDelta = 0;
            int friendlyBefore = -1;
            int friendlyAfter = -1;
            int enemyBefore = -1;
            int enemyAfter = -1;
            String localNumbersBefore = null;
            String localNumbersAfter = null;
            // HP 代表信号：hpSwing 最大的单个可靠 HP_MOMENTUM，
            // before/after/swing/poolEstimate 全部取自同一 signal，禁止跨 cohort 拼接
            AiEvidence representativeHp = null;

            for (final AiEvidence e : group) {
                start = Math.min(start, e.startSec());
                end = Math.max(end, e.endSec());
                coverage = Math.min(coverage, e.numbers().getOrDefault("observedCoverage", 1.0));
                switch (e.type()) {
                    case DEATH_CASCADE -> {
                        friendlyDeaths += e.numbers().getOrDefault("friendlyDeaths", 0.0).intValue();
                        enemyDeaths += e.numbers().getOrDefault("enemyDeaths", 0.0).intValue();
                    }
                    case ENGAGEMENT_TRADE -> {
                        recorderDamageDealt += e.numbers().getOrDefault("damageDealt", 0.0).intValue();
                        recorderDamageReceived += e.numbers().getOrDefault("damageReceived", 0.0).intValue();
                        // 无 HP_MOMENTUM 信号时用换血证据的 HP 差兜底
                        if (Double.isNaN(hpLeadBefore)
                                && !Double.isNaN(e.numbers().getOrDefault("teamHpLeadBefore", Double.NaN))) {
                            hpLeadBefore = e.numbers().get("teamHpLeadBefore");
                            hpLeadAfter = e.numbers().get("teamHpLeadAfter");
                        }
                        pool = Math.max(pool, e.numbers().getOrDefault("poolEstimate", 0.0));
                    }
                    case HP_MOMENTUM -> {
                        if (representativeHp == null
                                || e.numbers().getOrDefault("hpSwing", 0.0)
                                > representativeHp.numbers().getOrDefault("hpSwing", 0.0)) {
                            representativeHp = e;
                        }
                        pool = Math.max(pool, e.numbers().getOrDefault("poolEstimate", 0.0));
                    }
                    case LOCAL_SUPPORT -> {
                        friendlyBefore = e.numbers().getOrDefault("nearbyFriendlyBefore", -1.0).intValue();
                        friendlyAfter = e.numbers().getOrDefault("nearbyFriendlyAfter", -1.0).intValue();
                        enemyBefore = e.numbers().getOrDefault("nearbyEnemyBefore", -1.0).intValue();
                        enemyAfter = e.numbers().getOrDefault("nearbyEnemyAfter", -1.0).intValue();
                        friendlyDelta = e.numbers().getOrDefault("friendlyDelta", 0.0).intValue();
                        enemyDelta = e.numbers().getOrDefault("enemyDelta", 0.0).intValue();
                        // 使用 LS 证据的 observed 标签（含 ≥ / ?），避免重建全知 XvY
                        if (e.labels().containsKey("localNumbersBefore")) {
                            localNumbersBefore = e.labels().get("localNumbersBefore");
                        }
                        if (e.labels().containsKey("localNumbersAfter")) {
                            localNumbersAfter = e.labels().get("localNumbersAfter");
                        }
                    }
                    default -> {
                        // ROUTE 仅作为候选定位，不贡献聚合数值
                    }
                }
            }

            double hpSwing = 0;
            if (representativeHp != null) {
                hpLeadBefore = representativeHp.numbers().getOrDefault("hpLeadBefore", Double.NaN);
                hpLeadAfter = representativeHp.numbers().getOrDefault("hpLeadAfter", Double.NaN);
                hpSwing = representativeHp.numbers().getOrDefault("hpSwing", Double.NaN);
                pool = Math.max(pool,
                        representativeHp.numbers().getOrDefault("poolEstimate", 0.0));
            } else if (!Double.isNaN(hpLeadBefore) && !Double.isNaN(hpLeadAfter)) {
                // 无 HP_MOMENTUM 时，仅用 ENGAGEMENT_TRADE 兜底的同一对 HP 差
                hpSwing = Math.abs(hpLeadAfter - hpLeadBefore);
            }
            final int totalDeaths = friendlyDeaths + enemyDeaths;
            final int localFlip = Math.abs(friendlyDelta) + Math.abs(enemyDelta);
            final boolean hasHpSignal = pool > 0 && hpSwing > 0;
            final boolean critical = (hasHpSignal && hpSwing >= pool * CRITICAL_SWING_RATIO)
                    || totalDeaths >= 2 || localFlip >= 6;
            final boolean important = (hasHpSignal && hpSwing >= pool * IMPORTANT_SWING_RATIO)
                    || totalDeaths >= 1 || localFlip >= 2;
            final EvidencePriority priority = critical ? EvidencePriority.CRITICAL
                    : important ? EvidencePriority.IMPORTANT : EvidencePriority.NORMAL;

            final Map<String, Double> numbers = new HashMap<>();
            numbers.put("friendlyDeaths", (double) friendlyDeaths);
            numbers.put("enemyDeaths", (double) enemyDeaths);
            numbers.put("recorderDamageDealt", (double) recorderDamageDealt);
            numbers.put("recorderDamageReceived", (double) recorderDamageReceived);
            numbers.put("localFlip", (double) localFlip);
            if (!Double.isNaN(hpLeadBefore)) {
                numbers.put("teamHpLeadBefore", hpLeadBefore);
                numbers.put("teamHpLeadAfter", hpLeadAfter);
                numbers.put("teamHpSwing", hpSwing);
                numbers.put("poolEstimate", pool);
            }
            if (friendlyBefore >= 0) {
                numbers.put("nearbyFriendlyBefore", (double) friendlyBefore);
                numbers.put("nearbyFriendlyAfter", (double) friendlyAfter);
                numbers.put("nearbyEnemyBefore", (double) enemyBefore);
                numbers.put("nearbyEnemyAfter", (double) enemyAfter);
            }
            if (coverage < 1.0) {
                numbers.put("observedCoverage", coverage);
            }
            final Map<String, String> labels = new HashMap<>();
            if (localNumbersBefore != null) {
                labels.put("localNumbersBefore", localNumbersBefore);
                labels.put("localNumbersAfter", localNumbersAfter);
            } else if (friendlyBefore >= 0) {
                // 仅测试构造无标签证据时的兜底
                labels.put("localNumbersBefore", friendlyBefore + "v" + enemyBefore);
                labels.put("localNumbersAfter", friendlyAfter + "v" + enemyAfter);
            }

            final DecodeConfidence confidence = coverage >= HpMomentumSkill.COVERAGE_HIGH
                    ? DecodeConfidence.INFERRED : DecodeConfidence.PARTIAL;
            final StringBuilder sb = new StringBuilder("战局变化窗口");
            if (!Double.isNaN(hpLeadBefore)) {
                sb.append("：可观察 HP 差 ").append(Math.round(hpLeadBefore))
                        .append("→").append(Math.round(hpLeadAfter));
            }
            if (totalDeaths > 0) {
                sb.append("，阵亡 ").append(totalDeaths).append(" 辆");
            }
            if (localNumbersBefore != null) {
                sb.append("，局部 ").append(localNumbersBefore)
                        .append("→").append(localNumbersAfter);
            } else if (friendlyBefore >= 0) {
                sb.append("，局部 ").append(friendlyBefore).append("v").append(enemyBefore)
                        .append("→").append(friendlyAfter).append("v").append(enemyAfter);
            }
            return new WindowSignal(start, end, numbers, labels, confidence, priority, sb.toString());
        }
    }
}

package com.wotb.core.replay.evidence;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 换血 Skill（文档 §18）：把已有 EngagementSummary 扩展为
 * 双方存活数变化 + 局部人数变化 + HP 差变化，而不是简单
 * {@code dealt > received * 1.25 → FAVORABLE}。
 */
public final class EngagementTradeSkill {

    public static final int MAX_ENGAGEMENTS = 8;
    public static final double MATERIAL_TRADE_DAMAGE = 800;

    public List<AiEvidence> detect(
            final EvidenceSkillContext ctx,
            final List<HpMomentumSkill.HpMomentumSample> momentumSamples
    ) {
        if (ctx.features() == null || ctx.features().engagements() == null
                || ctx.features().engagements().isEmpty()) {
            return List.of();
        }
        final Integer recorderTeam = ctx.recorder() != null ? ctx.recorder().team() : null;
        final List<EngagementSummary> engagements = ctx.features().engagements().stream()
                .sorted(Comparator.comparingDouble(EngagementSummary::startTime))
                .toList();
        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final EngagementSummary e : engagements) {
            if (index >= MAX_ENGAGEMENTS) {
                break;
            }
            index++;
            final int friendlyBefore = aliveCount(ctx, recorderTeam, e.startTime());
            final int friendlyAfter = aliveCount(ctx, recorderTeam, e.endTime());
            final int enemyBefore = aliveCount(ctx, opposite(recorderTeam), e.startTime());
            final int enemyAfter = aliveCount(ctx, opposite(recorderTeam), e.endTime());

            final NearbySupportCounter.Counts before = nearby(ctx, e.startTime());
            final NearbySupportCounter.Counts after = nearby(ctx, e.endTime());

            final Map<String, Double> numbers = new HashMap<>();
            numbers.put("damageDealt", (double) e.damageDealt());
            numbers.put("damageReceived", (double) e.damageReceived());
            numbers.put("friendlyAliveBefore", (double) friendlyBefore);
            numbers.put("friendlyAliveAfter", (double) friendlyAfter);
            numbers.put("enemyAliveBefore", (double) enemyBefore);
            numbers.put("enemyAliveAfter", (double) enemyAfter);
            if (before != null) {
                numbers.put("nearbyFriendlyBefore", (double) before.friendlyCount());
                numbers.put("nearbyEnemyBefore", (double) before.enemyCount());
            }
            if (after != null) {
                numbers.put("nearbyFriendlyAfter", (double) after.friendlyCount());
                numbers.put("nearbyEnemyAfter", (double) after.enemyCount());
            }
            final double[] leadDelta = leadDeltaAt(momentumSamples, e.startTime(), e.endTime());
            if (leadDelta != null) {
                numbers.put("teamHpLeadBefore", leadDelta[0]);
                numbers.put("teamHpLeadAfter", leadDelta[1]);
                numbers.put("teamHpSwing", leadDelta[1] - leadDelta[0]);
            }

            final Map<String, String> labels = new HashMap<>();
            labels.put("localNumbersBefore", before == null ? "UNKNOWN" : before.friendlyCount() + "v" + before.enemyCount());
            labels.put("localNumbersAfter", after == null ? "UNKNOWN" : after.friendlyCount() + "v" + after.enemyCount());
            if (before != null) {
                labels.put("regionStart", "GRID_REGION_" + before.recorderRegion());
            }
            if (after != null) {
                labels.put("regionEnd", "GRID_REGION_" + after.recorderRegion());
            }

            final DecodeConfidence confidence = worst(e.confidence(), before, after);
            final boolean material = e.damageDealt() + e.damageReceived() >= MATERIAL_TRADE_DAMAGE;
            final String summary = String.format("换血：输出 %d / 承伤 %d，局部 %s → %s",
                    e.damageDealt(), e.damageReceived(),
                    labels.get("localNumbersBefore"), labels.get("localNumbersAfter"));
            result.add(new AiEvidence(
                    String.format("ET_%02d", index),
                    EvidenceType.ENGAGEMENT_TRADE,
                    e.startTime(),
                    e.endTime(),
                    List.of(),
                    numbers,
                    labels,
                    confidence,
                    material ? EvidencePriority.IMPORTANT : EvidencePriority.NORMAL,
                    EvidenceProvenance.BACKEND_SKILL,
                    summary));
        }
        return result;
    }

    private static NearbySupportCounter.Counts nearby(final EvidenceSkillContext ctx, final float sec) {
        if (ctx.recon() == null || ctx.recon().checkpoints() == null
                || ctx.recorder() == null || ctx.recorder().entityId() == null
                || ctx.recon().battleStartRawClockSec() == null) {
            return null;
        }
        return NearbySupportCounter.at(
                ctx.recon().checkpoints(),
                ctx.recon().battleStartRawClockSec(),
                sec,
                ctx.recorder().entityId(),
                ctx.battle());
    }

    private static double[] leadDeltaAt(
            final List<HpMomentumSkill.HpMomentumSample> samples,
            final float startSec, final float endSec) {
        if (samples == null || samples.isEmpty()) {
            return null;
        }
        HpMomentumSkill.HpMomentumSample before = null;
        HpMomentumSkill.HpMomentumSample after = null;
        for (final HpMomentumSkill.HpMomentumSample s : samples) {
            if (s.battleRelSec() <= endSec && (after == null || s.battleRelSec() > after.battleRelSec())) {
                after = s;
            }
            if (s.battleRelSec() <= startSec) {
                before = s;
            }
        }
        if (before == null || after == null || before.battleRelSec() == after.battleRelSec()) {
            return null;
        }
        return new double[]{before.lead(), after.lead()};
    }

    private static int aliveCount(final EvidenceSkillContext ctx, final Integer team, final float sec) {
        if (team == null || ctx.battle().players == null) {
            return -1;
        }
        return (int) ctx.battle().players.stream()
                .filter(p -> p.team == team)
                .filter(p -> p.survived || PlayerResultFormat.deathSec(p) > sec)
                .count();
    }

    private static DecodeConfidence worst(final DecodeConfidence base,
                                          final NearbySupportCounter.Counts before,
                                          final NearbySupportCounter.Counts after) {
        if ((before != null && before.confidence() == DecodeConfidence.PARTIAL)
                || (after != null && after.confidence() == DecodeConfidence.PARTIAL)) {
            return DecodeConfidence.PARTIAL;
        }
        return base == null ? DecodeConfidence.UNKNOWN : base;
    }

    private static Integer opposite(final Integer team) {
        return team == null ? null : (team == 1 ? 2 : 1);
    }
}

package com.wotb.core.replay.evidence;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.EngagementSummary;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 局部支援变化 Skill（文档 §14 示例）：在录像者交火窗口前后统计附近友军/敌军数量，
 * 只在支援结构发生明显变化（数量差 ≥ {@value #MIN_SUPPORT_DELTA}）时产出证据。
 */
public final class LocalSupportSkill {

    public static final int MIN_SUPPORT_DELTA = 2;
    public static final int MAX_EVIDENCE = 4;

    public List<AiEvidence> detect(final EvidenceSkillContext ctx) {
        if (ctx.features() == null || ctx.features().engagements() == null
                || ctx.features().engagements().isEmpty()) {
            return List.of();
        }
        final List<EngagementSummary> engagements = ctx.features().engagements().stream()
                .sorted(Comparator.comparingDouble(EngagementSummary::startTime))
                .toList();
        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final EngagementSummary e : engagements) {
            if (index >= MAX_EVIDENCE) {
                break;
            }
            final NearbySupportCounter.Counts before = nearby(ctx, e.startTime());
            final NearbySupportCounter.Counts after = nearby(ctx, e.endTime());
            if (before == null || after == null) {
                continue;
            }
            final int friendlyDelta = after.friendlyCount() - before.friendlyCount();
            final int enemyDelta = after.enemyCount() - before.enemyCount();
            if (Math.abs(friendlyDelta) < MIN_SUPPORT_DELTA
                    && Math.abs(enemyDelta) < MIN_SUPPORT_DELTA) {
                continue;
            }
            index++;
            final Map<String, Double> numbers = new HashMap<>();
            numbers.put("nearbyFriendlyBefore", (double) before.friendlyCount());
            numbers.put("nearbyFriendlyAfter", (double) after.friendlyCount());
            numbers.put("nearbyEnemyBefore", (double) before.enemyCount());
            numbers.put("nearbyEnemyAfter", (double) after.enemyCount());
            numbers.put("friendlyDelta", (double) friendlyDelta);
            numbers.put("enemyDelta", (double) enemyDelta);
            final Map<String, String> labels = new HashMap<>();
            labels.put("recorderRegion", "GRID_REGION_" + before.recorderRegion());
            labels.put("localNumbersBefore", before.friendlyCount() + "v" + before.enemyCount());
            labels.put("localNumbersAfter", after.friendlyCount() + "v" + after.enemyCount());
            final DecodeConfidence confidence = before.confidence() == DecodeConfidence.PARTIAL
                    || after.confidence() == DecodeConfidence.PARTIAL
                    ? DecodeConfidence.PARTIAL : DecodeConfidence.EXACT;
            final boolean flipped = enemyDelta >= MIN_SUPPORT_DELTA && friendlyDelta <= -MIN_SUPPORT_DELTA;
            final String summary = String.format(
                    "局部支援变化：友军 %d→%d，敌军 %d→%d（%s）",
                    before.friendlyCount(), after.friendlyCount(),
                    before.enemyCount(), after.enemyCount(), labels.get("recorderRegion"));
            result.add(new AiEvidence(
                    String.format("LS_%02d", index),
                    EvidenceType.LOCAL_SUPPORT,
                    before.battleRelSec(),
                    after.battleRelSec(),
                    List.of(),
                    numbers,
                    labels,
                    confidence,
                    flipped ? EvidencePriority.CRITICAL : EvidencePriority.IMPORTANT,
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
}

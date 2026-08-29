package com.wotb.core.replay.evidence;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.EngagementSummary;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 局部支援变化 Skill（示例）：在录像者交火窗口前后统计附近友军/敌军数量。
 * <p>只统计两侧都完整覆盖（全知）时的变化：敌军一侧未全部观察到时，数量变化可能是
 * 点亮/隐藏造成，不得当作真实的支援结构变化（避免制造假的 local-number flip）；
 * 表达统一使用"至少观察到 N 个附近敌军"的 observed 语义。</p>
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
            // 只有完整覆盖的变化才可信：未覆盖一侧的数量变化可能是点亮/隐藏造成
            final boolean friendlyReliable = before.friendlyFullyObserved()
                    && after.friendlyFullyObserved();
            final boolean enemyReliable = before.enemyFullyObserved()
                    && after.enemyFullyObserved();
            final boolean friendlyChanged = friendlyReliable
                    && Math.abs(friendlyDelta) >= MIN_SUPPORT_DELTA;
            final boolean enemyChanged = enemyReliable
                    && Math.abs(enemyDelta) >= MIN_SUPPORT_DELTA;
            if (!friendlyChanged && !enemyChanged) {
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
            labels.put("localNumbersBefore", before.numbersLabel());
            labels.put("localNumbersAfter", after.numbersLabel());
            final boolean fullyKnown = before.confidence() == DecodeConfidence.EXACT
                    && after.confidence() == DecodeConfidence.EXACT;
            final boolean flipped = enemyReliable && friendlyReliable
                    && enemyDelta >= MIN_SUPPORT_DELTA && friendlyDelta <= -MIN_SUPPORT_DELTA;
            final String observedSuffix = fullyKnown ? "" : "（观察子集）";
            final String summary = String.format(
                    "局部支援变化：友军 %s→%s，敌军 %s→%s（%s%s）",
                    before.friendlyLabel(), after.friendlyLabel(),
                    before.enemyLabel(), after.enemyLabel(),
                    labels.get("recorderRegion"), observedSuffix);
            result.add(new AiEvidence(
                    String.format("LS_%02d", index),
                    EvidenceType.LOCAL_SUPPORT,
                    before.battleRelSec(),
                    after.battleRelSec(),
                    List.of(),
                    numbers,
                    labels,
                    fullyKnown ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL,
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

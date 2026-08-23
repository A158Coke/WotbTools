package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 路线 Skill（文档 §19）：只描述开局路线、区域变化、与主要友军集群的空间分离、
 * 进入局部区域时观察到的双方数量。
 * <p>只输出事实与确定性测量，不做"盲目抢山 / 错误走重坦线 / 脱节 / 敌方人数优势"等
 * 战术裁决——那是 Call #2（LLM）的职责（Backend Evidence Boundary）。</p>
 */
public final class RouteSkill {

    public static final float OPENING_END_SEC = 45f;
    /** 与主要友军集群质心距离 ≥ 该值视为空间分离。 */
    public static final float SEPARATION_RADIUS_M = 150f;
    /** 空间分离的最小持续时长（秒）。 */
    public static final float SEPARATION_MIN_DURATION_SEC = 15f;
    public static final int MAX_EVIDENCE = 6;

    public List<AiEvidence> detect(final EvidenceSkillContext ctx) {
        final List<AiEvidence> result = new ArrayList<>();
        final List<AiEvidence> opening = openingRoute(ctx);
        result.addAll(opening);
        result.addAll(separationWindows(ctx));
        result.addAll(localObservedNumbersEntries(ctx));
        return result.size() <= MAX_EVIDENCE ? result : result.subList(0, MAX_EVIDENCE);
    }

    /** 开局前 45 秒的区域序列（九宫格编号）。 */
    static List<AiEvidence> openingRoute(final EvidenceSkillContext ctx) {
        if (ctx.features() == null || ctx.features().movements() == null) {
            return List.of();
        }
        final List<MovementSegment> opening = ctx.features().movements().stream()
                .filter(m -> m.startTime() < OPENING_END_SEC)
                .toList();
        if (opening.isEmpty()) {
            return List.of();
        }
        final Set<Integer> regions = new LinkedHashSet<>();
        float end = 0f;
        final String mapCode = ctx.battle().mapName;
        for (final MovementSegment seg : opening) {
            regions.add(MapRegionResolver.resolveRegionFromRaw(
                    seg.rawStartPosition().x(), seg.rawStartPosition().z(), mapCode));
            regions.add(MapRegionResolver.resolveRegionFromRaw(
                    seg.rawEndPosition().x(), seg.rawEndPosition().z(), mapCode));
            end = Math.max(end, seg.endTime());
        }
        final List<Integer> ordered = regions.stream().filter(r -> r > 0).toList();
        if (ordered.size() < 2) {
            return List.of();
        }
        final String route = String.join("→", ordered.stream().map(String::valueOf).toList());
        final String summary = "开局路线：GRID_REGION_" + route.replace("→", " → GRID_REGION_");
        return List.of(new AiEvidence(
                "RT_OPEN",
                EvidenceType.ROUTE,
                0f,
                Math.min(end, OPENING_END_SEC),
                List.of(),
                Map.of(),
                Map.of("route", route, "regions", route),
                DecodeConfidence.INFERRED,
                EvidencePriority.NORMAL,
                EvidenceProvenance.BACKEND_SKILL,
                summary));
    }

    /** 录像者与主要友军集群距离 ≥ 150m 且持续 ≥ 15s 的空间分离窗口（中性事实，不判脱节）。 */
    static List<AiEvidence> separationWindows(final EvidenceSkillContext ctx) {
        if (ctx.recon() == null || ctx.recon().checkpoints() == null
                || ctx.recorder() == null || ctx.recorder().entityId() == null
                || ctx.recon().battleStartRawClockSec() == null) {
            return List.of();
        }
        final Integer recorderEntity = ctx.recorder().entityId();
        final List<BattleStateCheckpoint> sorted = new ArrayList<>(ctx.recon().checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));
        final float startRaw = ctx.recon().battleStartRawClockSec();
        final Map<Long, Integer> teamByAccountId = teamByAccountId(ctx.battle());
        final Integer recorderTeam = ctx.recorder().team();

        final List<SeparationSpan> spans = new ArrayList<>();
        SeparationSpan current = null;
        for (final BattleStateCheckpoint cp : sorted) {
            final VehicleState recorder = cp.stateSnapshot().vehicleByEntityId(recorderEntity);
            if (recorder == null || recorder.position() == null
                    || recorder.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final float[] centroid = friendlyCentroid(cp, recorderEntity, recorderTeam, teamByAccountId);
            if (centroid == null) {
                continue;
            }
            final float rel = cp.rawClockSec() - startRaw;
            final float distance = MapRegionResolver.canonicalDistanceMeters(
                    recorder.position().x(), recorder.position().z(),
                    centroid[0], centroid[1], ctx.battle().mapName);
            if (distance >= SEPARATION_RADIUS_M) {
                if (current == null) {
                    current = new SeparationSpan(rel, rel);
                } else {
                    current = new SeparationSpan(current.startSec(), rel);
                }
            } else {
                if (current != null && current.duration() >= SEPARATION_MIN_DURATION_SEC) {
                    spans.add(current);
                }
                current = null;
            }
        }
        if (current != null && current.duration() >= SEPARATION_MIN_DURATION_SEC) {
            spans.add(current);
        }

        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final SeparationSpan span : spans) {
            if (index >= MAX_EVIDENCE) {
                break;
            }
            index++;
            result.add(new AiEvidence(
                    String.format("RT_SEP_%02d", index),
                    EvidenceType.ROUTE,
                    span.startSec(),
                    span.endSec(),
                    List.of(),
                    Map.of("distanceM", (double) SEPARATION_RADIUS_M),
                    Map.of(),
                    DecodeConfidence.PARTIAL,
                    EvidencePriority.IMPORTANT,
                    EvidenceProvenance.RECONSTRUCTION_INFERRED,
                    String.format("与主要友军集群保持空间分离 %.0fs（距离 ≥ %.0fm）", span.duration(), SEPARATION_RADIUS_M)));
        }
        return result;
    }

    /** 进入局部区域时观察到的双方数量（需友军侧完整覆盖：observedEnemy 是真实敌军下界；
     * 只有 observedEnemy ≥ 精确友军 + 2 才输出该局部数量事实）。只报数量，不判断是否构成
     * 战术劣势（2v4 是否不利还取决于 HP/车型/位置/地形/射界，由 LLM 综合判断）。 */
    static List<AiEvidence> localObservedNumbersEntries(final EvidenceSkillContext ctx) {
        if (ctx.features() == null || ctx.features().movements() == null
                || ctx.recon() == null || ctx.recon().checkpoints() == null
                || ctx.recorder() == null || ctx.recorder().entityId() == null
                || ctx.recon().battleStartRawClockSec() == null) {
            return List.of();
        }
        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final MovementSegment seg : ctx.features().movements()) {
            if (index >= MAX_EVIDENCE) {
                break;
            }
            final NearbySupportCounter.Counts counts = NearbySupportCounter.at(
                    ctx.recon().checkpoints(),
                    ctx.recon().battleStartRawClockSec(),
                    seg.endTime(),
                    ctx.recorder().entityId(),
                    ctx.battle());
            if (counts == null || !counts.friendlyFullyObserved()
                    || counts.enemyCount() < 2
                    || counts.enemyCount() < counts.friendlyCount() + 2) {
                continue;
            }
            index++;
            result.add(new AiEvidence(
                    String.format("RT_LN_%02d", index),
                    EvidenceType.ROUTE,
                    seg.startTime(),
                    seg.endTime(),
                    List.of(),
                    Map.of("nearbyFriendly", (double) counts.friendlyCount(),
                            "nearbyEnemy", (double) counts.enemyCount()),
                    Map.of("region", "GRID_REGION_" + counts.recorderRegion()),
                    counts.confidence(),
                    EvidencePriority.IMPORTANT,
                    EvidenceProvenance.BACKEND_SKILL,
                    String.format("进入该局部区域时，观察到附近友军 %s、敌军至少 %s（%s）",
                            counts.friendlyLabel(), counts.enemyLabel(),
                            "GRID_REGION_" + counts.recorderRegion())));
        }
        return result;
    }

    private static float[] friendlyCentroid(
            final BattleStateCheckpoint cp,
            final int recorderEntityId,
            final Integer recorderTeam,
            final Map<Long, Integer> teamByAccountId) {
        float sumX = 0;
        float sumZ = 0;
        int count = 0;
        for (final VehicleState vs : cp.stateSnapshot().vehiclesByEntityId().values()) {
            if (vs.entityId() == recorderEntityId
                    || vs.position() == null
                    || vs.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final Integer team = teamOf(vs, teamByAccountId);
            if (team == null || recorderTeam == null || team != recorderTeam) {
                continue;
            }
            sumX += vs.position().x();
            sumZ += vs.position().z();
            count++;
        }
        if (count == 0) {
            return null;
        }
        return new float[]{sumX / count, sumZ / count};
    }

    private static Map<Long, Integer> teamByAccountId(final Battle battle) {
        final Map<Long, Integer> map = new HashMap<>();
        if (battle.players != null) {
            battle.players.forEach(p -> {
                if (p.accountId > 0) {
                    map.put(p.accountId, p.team);
                }
            });
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

    private record SeparationSpan(float startSec, float endSec) {
        float duration() {
            return endSec - startSec;
        }
    }
}

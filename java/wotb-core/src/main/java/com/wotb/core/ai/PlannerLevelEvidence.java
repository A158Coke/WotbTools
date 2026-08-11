package com.wotb.core.ai;

import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 单回放提示词 LEVEL 2~5 证据生成器：录像者位置采样、已观察对象去重时间线、
 * 关键窗口高精度采样与事件级证据。
 * <p>从 {@link SingleReplayPromptPlanner} 拆出，纯静态工具类；预算/裁剪决策保留在原类。</p>
 */
final class PlannerLevelEvidence {

    private PlannerLevelEvidence() {
    }

    static final int POSITION_SAMPLE_INTERVAL_SEC = 2;
    static final int KEY_WINDOW_HALF_WIDTH_SEC = 5;

    static String buildLevel2PositionSample(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
        final String mapCode = ctx.battle() == null ? null : ctx.battle().mapName;
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            return "";
        }

        final long recorderAccountId = resolveRecorderAccountId(ctx);
        if (recorderAccountId <= 0) {
            return "";
        }

        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));

        // 按间隔采样
        final StringBuilder sb = new StringBuilder(1024);
        sb.append("=== RECORDER_POSITION_SAMPLES (LEVEL_2) ===\n");
        sb.append("# 录像者位置采样（每约2秒一个点，统一时间域 + canonical坐标）\n");

        float lastSampleClock = -POSITION_SAMPLE_INTERVAL_SEC;
        int sampleCount = 0;

        for (final BattleStateCheckpoint cp : sorted) {
            if (cp.rawClockSec() - lastSampleClock < POSITION_SAMPLE_INTERVAL_SEC) {
                continue;
            }

            final Integer entityId = cp.stateSnapshot().entityIdByAccountId(recorderAccountId);
            if (entityId == null) continue;

            final VehicleState vehicle = cp.stateSnapshot().vehicleByEntityId(entityId);
            if (vehicle == null || vehicle.position() == null) continue;

            final Vector3 pos = vehicle.position();
            // 转换 raw clock 到 battle-relative time
            final float battleRelSec = cp.rawClockSec() - battleStartRawClockSec;
            // 转换 raw XZ 到 canonical XZ
            final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), mapCode);

            if (coordRes.usable()) {
                sb.append(String.format("  t=%.1fs entity=RECORDER coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f%n",
                        battleRelSec, coordRes.status(), coordRes.position().x(), coordRes.position().z()));
                lastSampleClock = cp.rawClockSec();
                sampleCount++;
            }
        }

        if (sampleCount == 0) {
            return "";
        }

        sb.append(String.format("# 共 %d 个采样点%n", sampleCount));
        return sb.toString();
    }


    static String buildLevel3ObservedTimeline(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
        final String mapCode = ctx.battle() == null ? null : ctx.battle().mapName;
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            return "";
        }

        final long recorderAccountId = resolveRecorderAccountId(ctx);
        if (recorderAccountId <= 0) {
            return "";
        }

        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));

        // entityId → 阵营/昵称/权威坦克名/车种，来自权威名册；解析不到时回退为中性 E<id>
        final Map<Integer, String> identityLabels =
                EntityIdentityResolver.resolveLabels(recon, ctx.battle(), recorderAccountId);

        // 收集录像者观察到的其他实体（排除自己）
        final Map<Integer, String> observedEntities = new LinkedHashMap<>();

        for (final BattleStateCheckpoint cp : sorted) {
            for (final Map.Entry<Integer, VehicleState> entry : cp.stateSnapshot().vehiclesByEntityId().entrySet()) {
                final int entityId = entry.getKey();
                final VehicleState vs = entry.getValue();

                // 跳过录像者自己
                final Long acctId = vs.accountId();
                if (acctId != null && acctId == recorderAccountId) continue;

                // 有位置且被观察到
                if (vs.position() != null && vs.observationState() != null
                        && vs.observationState() == ObservationState.OBSERVED) {
                    if (!observedEntities.containsKey(entityId)) {
                        observedEntities.put(entityId,
                                identityLabels.getOrDefault(entityId, "E" + entityId));
                    }
                }
            }
        }

        if (observedEntities.isEmpty()) {
            return "";
        }

        final StringBuilder sb = new StringBuilder(2048);
        sb.append("=== OBSERVED_TIMELINE (LEVEL_3) ===\n");
        sb.append("# 已观察对象的去重位置时间线（统一时间域 + canonical坐标）\n");

        for (final Map.Entry<Integer, String> entry : observedEntities.entrySet()) {
            final int entityId = entry.getKey();
            // 块头给出完整身份（阵营/昵称/坦克/车种），逐行只用短标识以控制 token
            final String shortEntity = "E" + entityId;
            sb.append("--- ").append(shortEntity).append(" = ").append(entry.getValue()).append(" ---\n");

            String lastPosKey = null;
            int dedupCount = 0;
            boolean lastKnownPositionOutput = false;
            // 顺序遍历 checkpoint 时持续维护最近一次 OBSERVED 的时间与坐标
            ObservedSample lastObserved = null;

            for (final BattleStateCheckpoint cp : sorted) {
                final VehicleState vs = cp.stateSnapshot().vehicleByEntityId(entityId);
                if (vs == null) continue;

                // 逐 checkpoint 检查 observationState
                final ObservationState obsState = vs.observationState();
                final float battleRelSec = cp.rawClockSec() - battleStartRawClockSec;

                // 只有 OBSERVED 才能作为当前位置输出；STALE/UNKNOWN/REMOVED 一律不得当作当前位置
                if (obsState != ObservationState.OBSERVED) {
                    // 首次进入 STALE/UNKNOWN/REMOVED 时，输出一次最近一次 OBSERVED 样本作为最后已知位置
                    if (!lastKnownPositionOutput && lastObserved != null) {
                        sb.append(String.format(
                                "  t=%.1fs entity=%s coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f"
                                        + " LAST_KNOWN_POSITION (observationState=%s, POSITION_UNKNOWN_AFTER=%.1fs 此后位置未知)%n",
                                lastObserved.relSec(), shortEntity, lastObserved.coord().status(),
                                lastObserved.coord().position().x(), lastObserved.coord().position().z(),
                                stateLabel(obsState), battleRelSec));
                        lastKnownPositionOutput = true;
                    }
                    continue;
                }

                if (vs.position() == null) continue;

                final Vector3 pos = vs.position();
                // 使用 canonical 坐标进行去重
                final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), mapCode);
                if (!coordRes.usable()) continue;

                // 覆盖旧值，保证最后已知位置取到的是最后一次而不是第一次 OBSERVED
                lastObserved = new ObservedSample(battleRelSec, coordRes);

                final String posKey = String.format("%.0f_%.0f", coordRes.position().x(), coordRes.position().z());

                // 去重：连续相同 canonical 位置只输出一次
                if (posKey.equals(lastPosKey)) continue;
                lastPosKey = posKey;

                sb.append(String.format("  t=%.1fs entity=%s coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f%n",
                        battleRelSec, shortEntity, coordRes.status(), coordRes.position().x(), coordRes.position().z()));
                dedupCount++;
            }

            if (dedupCount == 0 && !lastKnownPositionOutput) {
                sb.append("  (no position data)\n");
            }
        }

        return sb.toString();
    }


    static String buildLevel4KeyWindowPrecision(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
        final String mapCode = ctx.battle() == null ? null : ctx.battle().mapName;
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            return "";
        }

        // 从 context features 中获取关键事件时间（battle-relative）
        final PlayerBattleFeatureSet features = ctx.features();
        if (features == null || features.keyEvents() == null || features.keyEvents().isEmpty()) {
            return "";
        }

        // 将 key event 的 battle-relative time 转换为 raw clock
        final List<Float> rawKeyTimes = features.keyEvents().stream()
                .map(ke -> (float) ke.clockSec())
                .filter(t -> t > 0)
                .distinct()
                .sorted()
                .map(t -> battleStartRawClockSec + t)
                .toList();

        if (rawKeyTimes.isEmpty()) {
            return "";
        }

        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));

        final long recorderAccountId = resolveRecorderAccountId(ctx);

        final StringBuilder sb = new StringBuilder(2048);
        sb.append("=== KEY_WINDOW_HIGH_PRECISION (LEVEL_4) ===\n");
        sb.append("# 关键事件窗口高精度采样（±5秒范围，全实体位置，统一时间域 + canonical坐标）\n");
        // 实体对照表：把 E<id> 映射到阵营/昵称/权威坦克名/车种，否则敌方位置无法归属到具体车辆
        sb.append(EntityIdentityResolver.legend(
                EntityIdentityResolver.resolveLabels(recon, ctx.battle(), recorderAccountId)));

        // 顺序遍历 checkpoint 时持续维护每个实体最近一次 OBSERVED 的时间与坐标；
        // lastKnownEmitted 保证每个实体的 LAST_KNOWN_POSITION 只输出一次
        final Map<Integer, ObservedSample> lastObservedByEntity = new LinkedHashMap<>();
        final Set<Integer> lastKnownEmitted = new HashSet<>();
        int catchUpCursor = 0;

        for (final float rawKeyTime : rawKeyTimes) {
            final float windowStart = Math.max(0, rawKeyTime - KEY_WINDOW_HALF_WIDTH_SEC);
            final float windowEnd = rawKeyTime + KEY_WINDOW_HALF_WIDTH_SEC;

            // 窗口之间的 checkpoint 不输出，但仍要顺序纳入维护，
            // 否则最后已知位置可能取到比真正最后一次 OBSERVED 更早的样本
            while (catchUpCursor < sorted.size()
                    && sorted.get(catchUpCursor).rawClockSec() < windowStart) {
                trackObservedEntities(sorted.get(catchUpCursor), battleStartRawClockSec,
                        recorderAccountId, lastObservedByEntity, mapCode);
                catchUpCursor++;
            }

            final List<BattleStateCheckpoint> windowed = sorted.stream()
                    .filter(cp -> cp.rawClockSec() >= windowStart && cp.rawClockSec() <= windowEnd)
                    .toList();

            if (windowed.isEmpty()) continue;

            // 输出 rawKeyTime 的 battle-relative 版本用于显示
            final float keyBattleRelSec = rawKeyTime - battleStartRawClockSec;
            sb.append(String.format("--- [%.1fs] 关键窗口 ---%n", keyBattleRelSec));

            for (final BattleStateCheckpoint cp : windowed) {
                final float battleRelSec = cp.rawClockSec() - battleStartRawClockSec;
                sb.append(String.format("  t=%.1fs |", battleRelSec));

                final List<String> positions = new ArrayList<>();
                for (final Map.Entry<Integer, VehicleState> ve : cp.stateSnapshot().vehiclesByEntityId().entrySet()) {
                    final int entityId = ve.getKey();
                    final VehicleState vs = ve.getValue();

                    final Long acctId = vs.accountId();
                    final boolean isRecorder = acctId != null && acctId == recorderAccountId;
                    if (!isRecorder && (acctId == null || acctId <= 0)) continue;
                    final String entityLabel = isRecorder ? "RECORDER" : ("E" + entityId);

                    // 逐 checkpoint 检查 observationState：
                    // 只有 OBSERVED 才能作为当前位置输出
                    final ObservationState obsState = vs.observationState();
                    if (obsState != ObservationState.OBSERVED) {
                        // 首次进入 STALE/UNKNOWN/REMOVED 时，输出一次最近一次 OBSERVED 样本
                        final ObservedSample last = lastObservedByEntity.get(entityId);
                        if (last != null && lastKnownEmitted.add(entityId)) {
                            positions.add(String.format(
                                    "entity=%s coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f"
                                            + " LAST_KNOWN_POSITION (lastObserved=%.1fs, observationState=%s,"
                                            + " POSITION_UNKNOWN_AFTER=%.1fs 此后位置未知)",
                                    entityLabel, last.coord().status(),
                                    last.coord().position().x(), last.coord().position().z(),
                                    last.relSec(), stateLabel(obsState), battleRelSec));
                        }
                        continue;
                    }

                    if (vs.position() == null) continue;

                    final Vector3 pos = vs.position();
                final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), mapCode);
                    if (!coordRes.usable()) continue;

                    // 覆盖旧值，保证最后已知位置取到的是最后一次而不是第一次 OBSERVED
                    trackObserved(lastObservedByEntity, entityId, battleRelSec, coordRes);

                    positions.add(String.format("entity=%s coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f",
                            entityLabel, coordRes.status(), coordRes.position().x(), coordRes.position().z()));
                }

                if (positions.isEmpty()) {
                    sb.append(" (no position data)\n");
                } else {
                    sb.append(" ").append(String.join(" ; ", positions)).append("\n");
                }
            }
        }

        return sb.toString();
    }


    static String buildLevel5EventLevel(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
        if (recon == null || recon.events() == null || recon.events().isEmpty()) {
            return "";
        }

        final PlayerBattleFeatureSet features = ctx.features();
        if (features == null || features.keyEvents() == null || features.keyEvents().isEmpty()) {
            return "";
        }

        // 将 key event 的 battle-relative time 转换为 raw clock
        final List<Float> rawKeyTimes = features.keyEvents().stream()
                .map(ke -> (float) ke.clockSec())
                .filter(t -> t > 0)
                .distinct()
                .sorted()
                .map(t -> battleStartRawClockSec + t)
                .toList();

        if (rawKeyTimes.isEmpty()) {
            return "";
        }

        final int halfWindow = 25; // half-window in events for key event checkpoint matching (empirical)

        final StringBuilder sb = new StringBuilder(4096);
        sb.append("=== EVENT_LEVEL_EVIDENCE (LEVEL_5) ===\n");
        sb.append("# 关键事件附近的事件级证据（统一时间域）\n");

        for (final float rawKeyTime : rawKeyTimes) {
            // 找到最接近关键事件的事件索引（统一在 raw clock 域比较）
            int closestIdx = -1;
            float closestDiff = Float.MAX_VALUE;

            for (int i = 0; i < recon.events().size(); i++) {
                final var event = recon.events().get(i);
                final float diff = Math.abs(event.timestamp().rawClockSec() - rawKeyTime);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closestIdx = i;
                }
            }

            if (closestIdx < 0) continue;

            final int startIdx = Math.max(0, closestIdx - halfWindow);
            final int endIdx = Math.min(recon.events().size(), closestIdx + halfWindow);

            final float keyBattleRelSec = rawKeyTime - battleStartRawClockSec;
            sb.append(String.format("--- [%.1fs] 附近事件 (索引 %d..%d) ---%n",
                    keyBattleRelSec, startIdx, endIdx - 1));

            for (int i = startIdx; i < endIdx; i++) {
                final var event = recon.events().get(i);
                final float eventBattleRelSec = event.timestamp().rawClockSec() - battleStartRawClockSec;
                sb.append(String.format("  [%.1fs] %s%n",
                        eventBattleRelSec, event.getClass().getSimpleName()));
            }
        }

        return sb.toString();
    }


    private static long resolveRecorderAccountId(final SinglePlayerBattleAnalysisContext ctx) {
        if (ctx == null || ctx.recorder() == null) return -1;
        return ctx.recorder().accountId();
    }


    private record ObservedSample(float relSec, MapCoordinateResolution coord) {
    }


    private static void trackObservedEntities(
            final BattleStateCheckpoint cp,
            final float battleStartRawClockSec,
            final long recorderAccountId,
            final Map<Integer, ObservedSample> lastObservedByEntity,
            final String mapCode
    ) {
        final float battleRelSec = cp.rawClockSec() - battleStartRawClockSec;
        for (final Map.Entry<Integer, VehicleState> ve : cp.stateSnapshot().vehiclesByEntityId().entrySet()) {
            final VehicleState vs = ve.getValue();
            if (vs.observationState() != ObservationState.OBSERVED || vs.position() == null) continue;

            final Long acctId = vs.accountId();
            final boolean isRecorder = acctId != null && acctId == recorderAccountId;
            if (!isRecorder && (acctId == null || acctId <= 0)) continue;

            final Vector3 pos = vs.position();
            final MapCoordinateResolution coordRes =
                    MapRegionResolver.resolve(pos.x(), pos.z(), mapCode);
            if (!coordRes.usable()) continue;

            trackObserved(lastObservedByEntity, ve.getKey(), battleRelSec, coordRes);
        }
    }


    private static void trackObserved(
            final Map<Integer, ObservedSample> lastObservedByEntity,
            final int entityId,
            final float relSec,
            final MapCoordinateResolution coord
    ) {
        final ObservedSample existing = lastObservedByEntity.get(entityId);
        if (existing == null || relSec >= existing.relSec()) {
            lastObservedByEntity.put(entityId, new ObservedSample(relSec, coord));
        }
    }


    private static String stateLabel(final ObservationState state) {
        return state == null ? ObservationState.UNKNOWN.name() : state.name();
    }


}

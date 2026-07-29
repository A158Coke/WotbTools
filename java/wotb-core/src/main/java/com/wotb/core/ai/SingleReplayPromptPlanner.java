package com.wotb.core.ai;

import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 单场回放提示规划器，根据可用上下文窗口逐级增加证据密度。
 *
 * <p>设计原则：</p>
 * <ul>
 *   <li>基础层（LEVEL_1）：mandatory 内容 + 压缩 features（移动段、交火段等）</li>
 *   <li>若余量 &gt; 10%：依次增加 LEVEL_2~LEVEL_5</li>
 *   <li>若超限：从低级开始移除</li>
 * </ul>
 */
public final class SingleReplayPromptPlanner {

    private final AiTokenEstimator tokenEstimator;
    private final int singleReplayMaxInputTokens;
    private final int contextWindowTokens;
    private final int maxOutputTokens;
    private final int promptSafetyMarginTokens;

    private static final double UPGRADE_THRESHOLD = 0.90;
    private static final int POSITION_SAMPLE_INTERVAL_SEC = 2;
    private static final int KEY_WINDOW_HALF_WIDTH_SEC = 5;

    public SingleReplayPromptPlanner(
            final AiTokenEstimator tokenEstimator,
            final int singleReplayMaxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens
    ) {
        this.tokenEstimator = tokenEstimator;
        if (singleReplayMaxInputTokens <= 0) {
            throw new IllegalArgumentException("singleReplayMaxInputTokens must be positive: " + singleReplayMaxInputTokens);
        }
        if (contextWindowTokens <= 0) {
            throw new IllegalArgumentException("contextWindowTokens must be positive: " + contextWindowTokens);
        }
        if (maxOutputTokens <= 0) {
            throw new IllegalArgumentException("maxOutputTokens must be positive: " + maxOutputTokens);
        }
        if (promptSafetyMarginTokens < 0) {
            throw new IllegalArgumentException("promptSafetyMarginTokens must be non-negative: " + promptSafetyMarginTokens);
        }
        this.singleReplayMaxInputTokens = singleReplayMaxInputTokens;
        this.contextWindowTokens = contextWindowTokens;
        this.maxOutputTokens = maxOutputTokens;
        this.promptSafetyMarginTokens = promptSafetyMarginTokens;
    }

    /**
     * 执行证据密度规划。
     *
     * @param systemPrompt    系统提示词
     * @param baseUserContent 基础用户内容（mandatory + 压缩 features）
     * @param ctx             单场分析上下文
     * @param recon           回放重建结果（可为 null，此时仅返回基础内容）
     * @return 规划结果
     */
    public PlannedPrompt plan(
            final String systemPrompt,
            final String baseUserContent,
            final SinglePlayerBattleAnalysisContext ctx,
            final ReplayReconstruction recon
    ) {
        Objects.requireNonNull(systemPrompt, "systemPrompt must not be null");
        Objects.requireNonNull(baseUserContent, "baseUserContent must not be null");
        Objects.requireNonNull(ctx, "ctx must not be null");

        // 无重建数据时直接返回基础内容
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            final int baseTokens = estimateTotalTokens(systemPrompt, baseUserContent);
            return new PlannedPrompt(
                    baseUserContent,
                    baseTokens,
                    effectiveInputLimit(),
                    EvidenceDensity.LEVEL_1_COMPRESSED,
                    false,
                    "No reconstruction data; using LEVEL_1_COMPRESSED"
            );
        }

        // 计算有效上限
        final int effectiveLimit = effectiveInputLimit();
        final int baseTokens = estimateTotalTokens(systemPrompt, baseUserContent);

        // 如果基础内容已超限，抛出异常（沿用现有行为）
        if (baseTokens > effectiveLimit) {
            return new PlannedPrompt(
                    baseUserContent,
                    baseTokens,
                    effectiveLimit,
                    EvidenceDensity.LEVEL_1_COMPRESSED,
                    true,
                    "Base content exceeds limit; truncated"
            );
        }

        // 从 LEVEL_2 开始，逐级尝试附加证据
        String currentContent = baseUserContent;
        int currentTokens = baseTokens;
        EvidenceDensity currentDensity = EvidenceDensity.LEVEL_1_COMPRESSED;
        final int upgradeThreshold = (int) (effectiveLimit * UPGRADE_THRESHOLD);

        // 检查 battleStartRawClockSec 是否可用（用于统一特征 battle-relative time 与 checkpoint raw clock）
        final Float battleStartRawClockSec = recon.battleStartRawClockSec();
        final boolean battleStartAvailable = battleStartRawClockSec != null
                && Float.isFinite(battleStartRawClockSec)
                && battleStartRawClockSec > 0f;

        if (!battleStartAvailable) {
            // battleStart 不可用，跳过 Level 2-5
            currentContent += "\n\n[LIMITATION] BATTLE_RELATIVE_TIME_UNAVAILABLE: Cannot align feature timestamps with raw clock; skipping detailed evidence levels.";
            currentTokens = estimateTotalTokens(systemPrompt, currentContent);
        }

        // LEVEL_2: 录像者位置采样（统一时间域 + canonical 坐标）
        if (battleStartAvailable && currentTokens < upgradeThreshold) {
            final String level2Content = buildLevel2PositionSample(recon, ctx, battleStartRawClockSec);
            if (!level2Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level2Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_2_POSITION_SAMPLE;
                }
            }
        }

        // LEVEL_3: 已观察对象的去重位置（统一时间域 + observationState + canonical 坐标）
        if (battleStartAvailable && currentTokens < upgradeThreshold && currentDensity.ordinal() >= EvidenceDensity.LEVEL_2_POSITION_SAMPLE.ordinal()) {
            final String level3Content = buildLevel3ObservedTimeline(recon, ctx, battleStartRawClockSec);
            if (!level3Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level3Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_3_OBSERVED_TIMELINE;
                }
            }
        }

        // LEVEL_4: 关键窗口高精度采样（统一时间域 + observationState + canonical 坐标）
        if (battleStartAvailable && currentTokens < upgradeThreshold && currentDensity.ordinal() >= EvidenceDensity.LEVEL_3_OBSERVED_TIMELINE.ordinal()) {
            final String level4Content = buildLevel4KeyWindowPrecision(recon, ctx, battleStartRawClockSec);
            if (!level4Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level4Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_4_KEY_WINDOW_HIGH_PRECISION;
                }
            }
        }

        // LEVEL_5: 事件级证据（统一时间域）
        if (battleStartAvailable && currentTokens < upgradeThreshold && currentDensity.ordinal() >= EvidenceDensity.LEVEL_4_KEY_WINDOW_HIGH_PRECISION.ordinal()) {
            final String level5Content = buildLevel5EventLevel(recon, ctx, battleStartRawClockSec);
            if (!level5Content.isEmpty()) {
                final String candidate = currentContent + "\n\n" + level5Content;
                final int candidateTokens = estimateTotalTokens(systemPrompt, candidate);
                if (candidateTokens <= effectiveLimit) {
                    currentContent = candidate;
                    currentTokens = candidateTokens;
                    currentDensity = EvidenceDensity.LEVEL_5_EVENT_LEVEL;
                }
            }
        }

        final boolean truncated = baseTokens > effectiveLimit;
        final String summary = String.format(
                "density=%s baseTokens=%d finalTokens=%d effectiveLimit=%d",
                currentDensity, baseTokens, currentTokens, effectiveLimit
        );

        return new PlannedPrompt(
                currentContent,
                currentTokens,
                effectiveLimit,
                currentDensity,
                truncated,
                summary
        );
    }

    // ========== 各级别证据生成 ==========

    /**
     * LEVEL_2: 录像者位置采样（每约 2 秒，统一时间域 + canonical 坐标）。
     */
    static String buildLevel2PositionSample(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
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
            final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), MapCoordinateProfile.DEFAULT);

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

    /**
     * LEVEL_3: 已观察对象的去重位置时间线（统一时间域 + observationState + canonical 坐标）。
     */
    static String buildLevel3ObservedTimeline(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()) {
            return "";
        }

        final long recorderAccountId = resolveRecorderAccountId(ctx);
        if (recorderAccountId <= 0) {
            return "";
        }

        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));

        // 收集录像者观察到的其他实体（排除自己）
        final Map<Integer, String> observedEntities = new LinkedHashMap<>();
        int entityCounter = 0;

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
                        entityCounter++;
                        observedEntities.put(entityId, "Entity#" + entityId);
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
            sb.append("--- ").append(entry.getValue()).append(" ---\n");

            String lastPosKey = null;
            int dedupCount = 0;
            boolean lastKnownPositionOutput = false;

            for (final BattleStateCheckpoint cp : sorted) {
                final VehicleState vs = cp.stateSnapshot().vehicleByEntityId(entityId);
                if (vs == null) continue;

                // 逐 checkpoint 检查 observationState
                final ObservationState obsState = vs.observationState();
                // REMOVED/UNKNOWN 时不得输出为当前位置
                if (obsState == ObservationState.REMOVED || obsState == ObservationState.UNKNOWN) {
                    // 如需最后已知位置，单独输出一次
                    if (!lastKnownPositionOutput && vs.lastPositionAt() != null) {
                        // 找到该 entity 的上一个可观测位置
                        for (final BattleStateCheckpoint prev : sorted) {
                            if (prev.rawClockSec() >= cp.rawClockSec()) break;
                            final VehicleState prevVs = prev.stateSnapshot().vehicleByEntityId(entityId);
                            if (prevVs == null || prevVs.position() == null) continue;
                            if (prevVs.observationState() == ObservationState.OBSERVED) {
                                final Vector3 pos = prevVs.position();
                                final float relTime = prev.rawClockSec() - battleStartRawClockSec;
                                final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), MapCoordinateProfile.DEFAULT);
                                if (coordRes.usable()) {
                                    sb.append(String.format("  t=%.1fs entity=%s coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f LAST_KNOWN_POSITION (lastObserved=%.1fs)%n",
                                            relTime, entry.getValue(), coordRes.status(), coordRes.position().x(), coordRes.position().z(),
                                            vs.lastObservedAt() - battleStartRawClockSec));
                                    lastKnownPositionOutput = true;
                                }
                                break;
                            }
                        }
                    }
                    continue;
                }

                if (vs.position() == null) continue;

                final Vector3 pos = vs.position();
                // 使用 canonical 坐标进行去重
                final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), MapCoordinateProfile.DEFAULT);
                if (!coordRes.usable()) continue;

                final String posKey = String.format("%.0f_%.0f", coordRes.position().x(), coordRes.position().z());

                // 去重：连续相同 canonical 位置只输出一次
                if (posKey.equals(lastPosKey)) continue;
                lastPosKey = posKey;

                final float battleRelSec = cp.rawClockSec() - battleStartRawClockSec;
                sb.append(String.format("  t=%.1fs entity=%s coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f%n",
                        battleRelSec, entry.getValue(), coordRes.status(), coordRes.position().x(), coordRes.position().z()));
                dedupCount++;
            }

            if (dedupCount == 0 && !lastKnownPositionOutput) {
                sb.append("  (no position data)\n");
            }
        }

        return sb.toString();
    }

    /**
     * LEVEL_4: 关键窗口高精度采样。
     * 在关键事件（死亡时间线）前后高频率采样位置，统一时间域 + observationState + canonical 坐标。
     */
    static String buildLevel4KeyWindowPrecision(
            final ReplayReconstruction recon,
            final SinglePlayerBattleAnalysisContext ctx,
            final float battleStartRawClockSec
    ) {
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

        for (final float rawKeyTime : rawKeyTimes) {
            final float windowStart = Math.max(0, rawKeyTime - KEY_WINDOW_HALF_WIDTH_SEC);
            final float windowEnd = rawKeyTime + KEY_WINDOW_HALF_WIDTH_SEC;

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
                    final VehicleState vs = ve.getValue();

                    // 逐 checkpoint 检查 observationState
                    if (vs.observationState() == ObservationState.REMOVED
                            || vs.observationState() == ObservationState.UNKNOWN) {
                        continue;
                    }

                    if (vs.position() == null) continue;

                    final Long acctId = vs.accountId();
                    final boolean isRecorder = acctId != null && acctId == recorderAccountId;
                    final Vector3 pos = vs.position();
                    final MapCoordinateResolution coordRes = MapRegionResolver.resolve(pos.x(), pos.z(), MapCoordinateProfile.DEFAULT);
                    if (!coordRes.usable()) continue;

                    if (isRecorder) {
                        positions.add(String.format("entity=RECORDER coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f",
                                coordRes.status(), coordRes.position().x(), coordRes.position().z()));
                    } else if (acctId != null && acctId > 0) {
                        positions.add(String.format("entity=E%d coordinateStatus=%s canonicalX=%.1f canonicalZ=%.1f",
                                ve.getKey(), coordRes.status(), coordRes.position().x(), coordRes.position().z()));
                    }
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

    /**
     * LEVEL_5: 事件级证据。
     * 包含关键事件周围的原始事件列表，统一时间域。
     */
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

    // ========== 辅助方法 ==========

    private int effectiveInputLimit() {
        final int fromMaxInput = singleReplayMaxInputTokens;
        final int fromContextWindow = contextWindowTokens - maxOutputTokens - promptSafetyMarginTokens;
        return Math.min(fromMaxInput, Math.max(0, fromContextWindow));
    }

    private int estimateTotalTokens(final String systemPrompt, final String userContent) {
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", userContent)
        );
        return tokenEstimator.estimateMessagesTokens(messages);
    }

    private static long resolveRecorderAccountId(final SinglePlayerBattleAnalysisContext ctx) {
        if (ctx == null || ctx.recorder() == null) return -1;
        return ctx.recorder().accountId();
    }

}

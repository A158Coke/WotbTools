package com.wotb.web.replay.dto;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;
import java.util.Map;

/**
 * Battle Playback V2 contract —— 从 canonical {@code BattleTimeline} 的<b>纯 projection</b>。
 *
 * <p>设计原则（plan §18/§20/§22/§23）：</p>
 * <ul>
 *   <li>这是 <b>sparse transition tracks</b>，不是 450s × 10Hz × 14 车的全量 snapshot
 *       （backend 内部可 frame-based，Web contract 用稀疏过渡）；</li>
 *   <li>每条 track 自带 <b>knowledge / provenance / observation boundary</b>，前端<b>不得</b>再做
 *       HP/AoI/death/loadout inference；</li>
 *   <li>{@code displayCapacityHp} 是 presentation-only HP bar 量程（anti-future-leak），
 *       <b>不是</b> canonical max HP truth；</li>
 *   <li>loadout 是持久配置：敌方离开 AoI 后仍 KNOWN；consumable runtime 在 hidden interval = UNKNOWN。</li>
 * </ul>
 *
 * @param durationSec       战斗总时长（battle-relative 秒）
 * @param mapCode           地图 code（meta.json mapName 小写；未知为 null）
 * @param friendlyTeam      本方（录像者）队伍号（1/2）
 * @param recorderAccountId 录像者账号（null = 未解析）
 * @param vehicles          参战车辆转录（稀疏 transition tracks）
 * @param shots             射击轨道
 * @param pointsSamples     争霸赛实时点数广播（battle-relative 秒升序）
 * @param limitations       content limitations（如 BATTLE_RELATIVE_TIME_UNAVAILABLE）；空 = 无限制
 * @param arenaBonusType    战斗模式（meta.json#arenaBonusType 原值；null = 未知）。
 *                          仅携带该权威类别事实（前端用于标准/争霸事件过滤），<b>不</b>复制 MapOverview。
 * @param capability        FULL / PARTIAL / UNAVAILABLE（派生：limitations 空 = FULL，非空 = PARTIAL；
 *                          UNAVAILABLE 由 dataset == null 即 204 语义，不在 DTO 内）；与 limitations 一致，
 *                          前端据此显示「完整 / 部分 / 不可用」降级，不得猜测未观测事实。
 */
public record BattlePlaybackDataset(
        double durationSec,
        String mapCode,
        Integer friendlyTeam,
        Long recorderAccountId,
        List<VehiclePlaybackTrack> vehicles,
        List<BattleEvent> events,
        List<ShotTrack> shots,
        List<PointsSample> pointsSamples,
        List<String> limitations,
        Capability capability,
        Integer arenaBonusType
) {
    /** 战局回放完整度 capability（与 limitations 严格一致，前端本地化）。 */
    public enum Capability {
        FULL,
        PARTIAL,
        UNAVAILABLE
    }

    public BattlePlaybackDataset {
        vehicles = vehicles == null ? List.of() : List.copyOf(vehicles);
        events = events == null ? List.of() : List.copyOf(events);
        shots = shots == null ? List.of() : List.copyOf(shots);
        pointsSamples = pointsSamples == null ? List.of() : List.copyOf(pointsSamples);
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
        // 兼容旧缓存 JSON（无 capability 字段）：null -> 由 limitations 派生。
        capability = capability != null ? capability
                : (limitations.isEmpty() ? Capability.FULL : Capability.PARTIAL);
    }

    /** 9-arg convenience constructor（既有 caller 投影）：capability 由 limitations 派生；arenaBonusType 未知。 */
    public BattlePlaybackDataset(
            double durationSec,
            String mapCode,
            Integer friendlyTeam,
            Long recorderAccountId,
            List<VehiclePlaybackTrack> vehicles,
            List<BattleEvent> events,
            List<ShotTrack> shots,
            List<PointsSample> pointsSamples,
            List<String> limitations) {
        this(durationSec, mapCode, friendlyTeam, recorderAccountId, vehicles, events, shots,
                pointsSamples, limitations, null, null);
    }

    /** 10-arg convenience constructor（携带能力），arenaBonusType 未知。 */
    public BattlePlaybackDataset(
            double durationSec,
            String mapCode,
            Integer friendlyTeam,
            Long recorderAccountId,
            List<VehiclePlaybackTrack> vehicles,
            List<BattleEvent> events,
            List<ShotTrack> shots,
            List<PointsSample> pointsSamples,
            List<String> limitations,
            Capability capability) {
        this(durationSec, mapCode, friendlyTeam, recorderAccountId, vehicles, events, shots,
                pointsSamples, limitations, capability, null);
    }

    /**
     * battle-level 时间轴事件（canonical，源自唯一伤害/击毁权威，非 raw 重扫）。
     * <p>type ∈ {@code DAMAGE | DESTROYED | KILL | POSITION_REPORTED | POSITION_STALE}。
     * {@code observedHpLoss} 仅在 DAMAGE 且窗口内唯一伤害通知 + 可 attribution 时非 null
     * （前端不得把 unsupported 冲突窗口的掉血挂到单条通知）；{@code rawProtocolValue} 一律丢弃
     * （Type-8 语义未证明，不进入 canonical）。</p>
     */
    public record BattleEvent(
            String type,
            double timeSec,
            Long accountId,
            Long targetAccountId,
            Integer observedHpLoss
    ) {
    }

    /** 一辆车的完整投影：identity / loadout / 各 transition track。 */
    public record VehiclePlaybackTrack(
            long accountId,
            String playerName,
            long tankId,
            String tankName,
            String tankClass,
            Integer tankTier,
            int team,
            boolean friendly,
            VehicleBattleLoadoutDto loadout,
            List<PositionSegment> positionSegments,
            List<OrientationSegment> orientationSegments,
            List<HealthTransition> healthTransitions,
            List<LifeTransition> lifeTransitions,
            List<ConsumableTransition> consumableTransitions,
            List<ModuleCrewTransition> moduleCrewTransitions
    ) {
        public VehiclePlaybackTrack {
            playerName = playerName == null ? "" : playerName;
            tankName = tankName == null ? "" : tankName;
            tankClass = tankClass == null ? "" : tankClass;
            positionSegments = positionSegments == null ? List.of() : List.copyOf(positionSegments);
            orientationSegments = orientationSegments == null ? List.of() : List.copyOf(orientationSegments);
            healthTransitions = healthTransitions == null ? List.of() : List.copyOf(healthTransitions);
            lifeTransitions = lifeTransitions == null ? List.of() : List.copyOf(lifeTransitions);
            consumableTransitions = consumableTransitions == null ? List.of() : List.copyOf(consumableTransitions);
            moduleCrewTransitions = moduleCrewTransitions == null ? List.of() : List.copyOf(moduleCrewTransitions);
        }
    }

    /** 可空 loadout（未 materialized / 非完整 framing → null）。 */
    public record VehicleBattleLoadoutDto(
            String replayVersion,
            List<String> consumables,   // 3；logicalItemId nullable（unknown raw-preserve）
            List<Integer> consumableWireCodes,
            List<String> provisions,    // 3；nullable
            List<Integer> provisionWireCodes,
            List<Integer> equipmentIds, // 9
            DecodeConfidence confidence
    ) {
        public VehicleBattleLoadoutDto {
            // 契约：logicalItemId / wireCode / equipmentId 可为 null（unknown raw-preserve）。
            // List.copyOf 拒绝 null 元素 → 一旦 loadout 事实携带 null 直接 NPE → V2 整个 204。
            // 这里改用 null-tolerant 不可变拷贝，保留 null 语义（前端按 unknown 处理）。
            consumables = immutableNullable(consumables);
            consumableWireCodes = immutableNullable(consumableWireCodes);
            provisions = immutableNullable(provisions);
            provisionWireCodes = immutableNullable(provisionWireCodes);
            equipmentIds = immutableNullable(equipmentIds);
            confidence = confidence == null ? DecodeConfidence.UNKNOWN : confidence;
        }
    }

    /** null-tolerant 不可变列表拷贝：允许元素为 null，但返回真正的不可变列表。 */
    private static <T> List<T> immutableNullable(final List<T> list) {
        return list == null ? List.of() : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(list));
    }

    /** 位置观察段（AoI boundary authority）：段内可插值，段间 UNKNOWN_AOI 禁止。 */
    public record PositionSegment(
            double startSec,
            double endSec,
            String knowledge,      // OBSERVED / LAST_KNOWN
            boolean interpolationAllowed,
            List<PositionSample> samples
    ) {
        public PositionSegment {
            samples = samples == null ? List.of() : List.copyOf(samples);
        }
    }

    public record PositionSample(double timeSec, double x, double y, String knowledge) {
    }

    public record OrientationSegment(
            double startSec,
            double endSec,
            String knowledge,      // CURRENT / LAST_KNOWN
            List<OrientationSample> samples
    ) {
        public OrientationSegment {
            samples = samples == null ? List.of() : List.copyOf(samples);
        }
    }

    public record OrientationSample(
            double timeSec,
            Double hullYawDeg,
            Double turretRelativeYawDeg,
            String knowledge      // CURRENT / LAST_KNOWN / UNKNOWN
    ) {
    }

    /** 血量过渡（统一 currentHp；knowledge + displayCapacityHp）。 */
    public record HealthTransition(
            double timeSec,
            Integer currentHp,
            String knowledge,          // CURRENT / LAST_KNOWN / UNKNOWN
            String source,             // EXACT_BATTLE_EVENT / ...
            Integer displayCapacityHp, // presentation-only
            ConfidenceDto confidence
    ) {
    }

    public record LifeTransition(
            double timeSec,
            String lifeState,          // ALIVE / DESTROYED / UNKNOWN
            Double destroyedKnownAtSec
    ) {
    }

    /** consumable runtime 过渡（hidden interval → UNKNOWN）。 */
    public record ConsumableTransition(
            double timeSec,
            Integer consumableSlot,    // 0..2 三 consumable slot；null = 非 slot 事件
            String logicalItemId,       // null = unknown wire
            Integer wireCode,
            String state,               // INITIALIZED / ACTIVATED / ACTIVE_ENDED_OR_COOLDOWN / TEARDOWN
            ConfidenceDto confidence
    ) {
    }

    /** module/crew 状态过渡（recorder-visible provenance）。 */
    public record ModuleCrewTransition(
            double timeSec,
            String component,
            String state,
            boolean recorderVisible,
            ConfidenceDto confidence
    ) {
    }

    public record ShotTrack(
            long shooterAccountId,
            double launchTimeSec,
            Double terminalTimeSec,
            String resolution       // only for recorder shots; null otherwise
    ) {
    }

    public record PointsSample(double timeSec, int team, int points) {
    }

    /** 置信度枚举（DTO 层稳定英文码，前端本地化）；映射自 {@link DecodeConfidence}。 */
    public enum ConfidenceDto {
        HIGH,
        MEDIUM,
        LOW,
        UNKNOWN
    }
}

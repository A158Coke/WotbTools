package com.wotb.web.replay.dto;

import java.util.List;
import java.util.Map;

/**
 * AI 复盘结果页「地图鸟瞰」区块数据（可空；未知地图/无观测/无名册时为 null）。
 * <p>坐标约定：所有坐标与 {@code playableBounds} 同系——{@code x} = 地图横向 = 回放 x，
 * {@code y} = 地图纵向 = 回放 z（同一原点同一米制）。前端将图片拉伸铺满
 * {@code playableBounds} 后即可直接映射像素。</p>
 *
 * @param mapCode       内部地图 code（meta.json 的 mapName，小写）
 * @param displayName   人类可读地图名（如 Desert Sands）
 * @param displayNames  三语显示名（zh/en/ru，来自 map_names.json；未收录时三语同 code，
 *                      前端按当前 locale 取 `displayNames[locale]`，缺失回退 displayName）
 * @param friendlyTeam  本方（录像者）队伍号（1/2；前端用于路线阵营配色与热力 Tab 映射）
 * @param playableBounds 可玩区边界
 * @param gridCells     6x6 分析格（36 个；id 如 F1/A6，带 nineGridRegion 与格子边界）
 * @param image         地图图片元信息（恒为 null——素材与尺寸由前端
 *                      {@code frontend/src/data/mapImages.js} 唯一维护，本字段仅为兼容保留）
 * @param spawnPoints   出生点（语义坐标）
 * @param phases        阶段切片（开局/中期/残局，按 battle-relative 秒）
 * @param heatmaps      热力：本方/敌方 × 驻留/伤害/阵亡（每层 36 个值，与 gridCells 同序；
 *                      驻留=位置采样计数、伤害=累计伤害、阵亡=事件计数；前端按 max 归一化）
 * @param routes        双方路线（每车 ≤200 点、2s 采样、观测区间与阵亡时刻）
 * @param arenaBonusType      战斗模式（meta.json#arenaBonusType 原值；1=随机战斗，其他=训练/联赛等；未知为 null）
 * @param recorderAccountId   录像者账号 id（经 {@link com.wotb.core.model.Battle#recorderResult()} 解析；
 *                             未解析为 null；前端用于路线「仅玩家」筛选）
 * @param playback      战局回放数据（可空；无观测/无名册时为 null；前端用于地图鸟瞰「战局回放」第三视图）
 */
public record MapOverview(
        String mapCode,
        String displayName,
        Map<String, String> displayNames,
        int friendlyTeam,
        Bounds playableBounds,
        List<GridCell> gridCells,
        ImageInfo image,
        List<SpawnPoint> spawnPoints,
        List<Phase> phases,
        Heatmaps heatmaps,
        List<Route> routes,
        Integer arenaBonusType,
        Long recorderAccountId,
        Playback playback
) {

    public MapOverview {
        displayNames = displayNames == null ? Map.of() : Map.copyOf(displayNames);
        gridCells = gridCells == null ? List.of() : List.copyOf(gridCells);
        spawnPoints = spawnPoints == null ? List.of() : List.copyOf(spawnPoints);
        phases = phases == null ? List.of() : List.copyOf(phases);
        routes = routes == null ? List.of() : List.copyOf(routes);
    }

    /** 平面边界（语义坐标；y 轴=回放 z）。 */
    public record Bounds(double xMin, double xMax, double yMin, double yMax) {
    }

    /** 单个 6x6 分析格。 */
    public record GridCell(String id, int nineGridRegion, Bounds bounds) {
    }

    /** 地图图片元信息（前端素材开关在 mapImages.js；两者不一致时以前端为准）。 */
    public record ImageInfo(String file, int width, int height) {
    }

    /** 出生点（语义坐标；team 1/2）。 */
    public record SpawnPoint(String name, int team, double x, double y) {
    }

    /** 阶段切片（battle-relative 秒）：opening / mid / late，覆盖 [0, battleEnd]。 */
    public record Phase(String key, double startSec, double endSec) {
    }

    /** 双阵营热力。 */
    public record Heatmaps(Layer friendly, Layer enemy) {
    }

    /** 单阵营三张热力（每层 36 个值，与 gridCells 同序）。 */
    public record Layer(List<Double> dwell, List<Double> damage, List<Double> deaths) {
        public Layer {
            dwell = dwell == null ? List.of() : List.copyOf(dwell);
            damage = damage == null ? List.of() : List.copyOf(damage);
            deaths = deaths == null ? List.of() : List.copyOf(deaths);
        }
    }

    /** 单辆车路线（语义坐标；2s 采样；观测区间诚实标注）。 */
    public record Route(
            long accountId,
            String playerName,
            long tankId,
            int team,
            List<Point> points,
            double firstObservedSec,
            double lastObservedSec,
            Double deathSec
    ) {
        public Route {
            playerName = playerName == null ? "" : playerName;
            points = points == null ? List.of() : List.copyOf(points);
        }
    }

    /** 路线点（语义坐标 + battle-relative 秒；连续点 gap > 5s 时前端断线）。 */
    public record Point(double x, double y, double timeSec) {
    }

    /**
     * 战局回放（Playback）：给前端播放器的时间轴契约。
     *
     * @param durationSec 战斗总时长（battle-relative 秒；无权威时长时取最后观测时刻）
     * @param vehicles    参战车辆（仅含可解析名册且有观测的车辆）
     * @param events      时间轴事件（按 timeSec 升序；type 为英文稳定码，文案由前端三语渲染）
     */
    public record Playback(
            double durationSec,
            List<PlaybackVehicle> vehicles,
            List<PlaybackEvent> events,
            List<PointsSample> pointsSamples
    ) {
        public Playback {
            vehicles = vehicles == null ? List.of() : List.copyOf(vehicles);
            events = events == null ? List.of() : List.copyOf(events);
            pointsSamples = pointsSamples == null ? List.of() : List.copyOf(pointsSamples);
        }
    }

    /** 争霸赛实时点数广播（battle-relative 秒升序；type-8 subtype48 root field12，PROVEN）。 */
    public record PointsSample(double timeSec, int team, int points) {
    }

    /**
     * 一辆参战车辆（位置复用 {@link Route#points()}，这里只补充位置上报区间）。
     * <p>注意：{@code positionIntervals} 是服务器位置流上报覆盖（type-10 gap 聚类），
     * 不代表录像者客户端点亮——敌方静止时服务器不上报位置，位置中断≠失察。
     *
     * <p>HP 字段拆分（PR #107 Blocker 3）：{@code maxHp} 语义混合（观测 vs tankopedia）已删除，
     * 拆为三个独立 provenance 字段，前端<b>不得</b>把 baseHp/observedCapacityHp 冒充本局
     * current/max/entry HP：</p>
     * <ul>
     *   <li>{@code baseHp} = Tankopedia 静态参考（metadata；允许作为灰段/参考展示，禁止进本局百分比）；</li>
     *   <li>{@code observedCapacityHp} = 回放观测容量（= 真实可信 Type-7 positive HP 采样的最大值，
     *       纯回放观测；无可信 sample 为 null；绝不 max(观测, base)/fallback base）；</li>
     *   <li>{@code entryHp} = 已证明的进场满血（仅 entryHpSource==OBSERVED_EXACT 有效，否则 null）。</li>
     * </ul>
     *
     * @param entryHpSource 进场满血 provenance（OBSERVED_EXACT | BASE_FALLBACK | UNKNOWN，
     *                      来自 {@code ObservedMaxHp} 的权威判定；null=未回填）
     * @param entryHp       已证明的进场满血（含装备/物资加成）；仅
     *                      {@code entryHpSource == OBSERVED_EXACT} 时有效，否则为 null——
     *                      前端「开局满血回退」只允许在该 provenance 下使用，禁止拿
     *                      tankopedia base 冒充实际进场 HP
     * @param finalStats    整场最终战绩（结算口径；仅供明确标识的「最终战绩」分区，
     *                      不得冒充当前时间点可重建状态）
     */
    public record PlaybackVehicle(
            long accountId,
            String playerName,
            long tankId,
            String tankName,
            int team,
            List<PositionInterval> positionIntervals,
            Double deathSec,
            List<DirectionSample> directionSamples,
            Integer baseHp,
            Integer observedCapacityHp,
            List<HpSample> hpSamples,
            String tankType,
            String entryHpSource,
            Integer entryHp,
            List<HpLoss> hpLosses,
            FinalStats finalStats
    ) {
        public PlaybackVehicle {
            playerName = playerName == null ? "" : playerName;
            tankName = tankName == null ? "" : tankName;
            tankType = tankType == null ? "" : tankType;
            positionIntervals = positionIntervals == null
                    ? List.of() : List.copyOf(positionIntervals);
            directionSamples = directionSamples == null
                    ? List.of() : List.copyOf(directionSamples);
            hpSamples = hpSamples == null ? List.of() : List.copyOf(hpSamples);
            hpLosses = hpLosses == null ? List.of() : List.copyOf(hpLosses);
        }
    }

    /**
     * 单车一次权威 HP 变化（docs/features/battle-playback.md §12/§13）。
     *
     * @param fromSec           窗口起点（前一可信 HP sample，battle-relative 秒）
     * @param toSec             窗口终点（后一可信 HP sample；掉血发生在 (fromSec, toSec]）
     * @param hpLoss            掉血值 = previousHp - currentHp（HP 单调非增，无治疗）
     * @param attackerAccountId 可证明的攻击者账号；null = 无法可靠 attribution
     *                          （0 通知 / 混合攻击者 / 身份无法解析）——不得伪造攻击者
     * @param attackerReliable  是否可 attribution（= attackerAccountId != null）
     */
    public record HpLoss(
            double fromSec,
            double toSec,
            int hpLoss,
            Long attackerAccountId,
            boolean attackerReliable
    ) {
    }

    /** 单车最终战绩（整场结算口径；仅用于「最终战绩」分区，不得冒充当前时间点状态）。 */
    public record FinalStats(
            int damageDealt,
            int damageReceived,
            int damageAssisted,
            int kills,
            int nShots,
            int nHitsDealt,
            int nPenetrationsDealt,
            int nHitsReceived,
            int nPenetrationsReceived,
            int damageBlocked
    ) {
    }

    /** 回放实测血量采样（battle-relative 秒；type-7 propId=3 当前血量，含装备加成，阵亡到 0）。 */
    public record HpSample(double timeSec, int hp) {
    }

    /**
     * observedCapacityHp 推导（PR #107 Blocker 3）：真实可信 Type-7 positive HP 采样的最大值
     * （纯回放观测；与前端收到的 hpSamples 同源同值）。无可信 positive sample → null——
     * 绝不用 max(观测, tankopedia base) 钳制、也不 fallback 到 base（base 只是静态参考）。
     */
    public static Integer observedCapacityHpOf(final List<HpSample> samples) {
        if (samples == null) {
            return null;
        }
        int max = 0;
        for (final HpSample s : samples) {
            if (s != null && s.hp() > max) {
                max = s.hp();
            }
        }
        return max > 0 ? max : null;
    }

    /**
     * 车辆方向采样（battle-relative 秒升序）。
     * <p>单位均为度：{@code hullYawDeg} 来自 type-10 yaw（弧度→度，[-180,180)）；
     * {@code turretRelativeYawDeg} 来自 type-7 propId=2（u16*360/65536-180，[-180,180)，
     * 完整 360° 且 ±180 回绕）。炮口/炮塔世界方向由前端计算：
     * {@code turretWorldYaw = normalize(hullYawDeg + turretRelativeYawDeg)}。
     * 相邻采样间前端按最短圆弧插值；跨位置中断/阵亡/不可信 gap 禁止插值。
     */
    public record DirectionSample(
            double timeSec,
            double hullYawDeg,
            double turretRelativeYawDeg
    ) {
    }

    /**
     * 车辆位置上报区间（battle-relative 秒；[startSec, endSec] 内服务器持续上报该车位置）。
     * 语义 = 位置流覆盖，不等于「对录像者可见/点亮」。
     */
    public record PositionInterval(double startSec, double endSec) {
    }

    /**
     * 时间轴事件。
     *
     * @param type           DAMAGE | DESTROYED | KILL | POSITION_REPORTED | POSITION_STALE（英文稳定码）
     * @param timeSec        battle-relative 秒
     * @param accountId      主体（攻击者 / 被击毁者 / 进入或离开观察的车辆）；无法解析为 null
     * @param targetAccountId 对象（DAMAGE/KILL 的受害者）；其余为 null
     * @param rawProtocolValue DAMAGE 的 Type-8 raw 协议值（语义未证明——不得当权威伤害展示；
     *                        权威掉血见 {@link HpLoss} 与 {@link #observedHpLoss}）；其余为 null
     * @param observedHpLoss DAMAGE 可证明的掉血值（仅当该窗口内唯一伤害通知且可 attribution——
     *                       attackerReliable、窗口内无 unsupported 变体时非 null；其余为 null——
     *                       前端不得显示伪造的精确伤害、也不得把 unsupported 冲突窗口的掉血挂到单条通知）
     */
    public record PlaybackEvent(
            String type,
            double timeSec,
            Long accountId,
            Long targetAccountId,
            Integer rawProtocolValue,
            Integer observedHpLoss
    ) {
    }
}

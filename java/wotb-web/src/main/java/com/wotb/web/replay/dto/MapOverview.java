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
            List<PlaybackEvent> events
    ) {
        public Playback {
            vehicles = vehicles == null ? List.of() : List.copyOf(vehicles);
            events = events == null ? List.of() : List.copyOf(events);
        }
    }

    /** 一辆参战车辆（位置复用 {@link Route#points()}，这里只补充可见性区间）。 */
    public record PlaybackVehicle(
            long accountId,
            String playerName,
            long tankId,
            String tankName,
            int team,
            List<ObservedInterval> observedIntervals,
            Double deathSec
    ) {
        public PlaybackVehicle {
            playerName = playerName == null ? "" : playerName;
            tankName = tankName == null ? "" : tankName;
            observedIntervals = observedIntervals == null
                    ? List.of() : List.copyOf(observedIntervals);
        }
    }

    /** 车辆可观测区间（battle-relative 秒；[startSec, endSec] 内该车辆位置对录像者可见）。 */
    public record ObservedInterval(double startSec, double endSec) {
    }

    /**
     * 时间轴事件。
     *
     * @param type           DAMAGE | DESTROYED | KILL | OBSERVED | LOST（英文稳定码）
     * @param timeSec        battle-relative 秒
     * @param accountId      主体（攻击者 / 被击毁者 / 进入或离开观察的车辆）；无法解析为 null
     * @param targetAccountId 对象（DAMAGE/KILL 的受害者）；其余为 null
     * @param damage         DAMAGE 的伤害值；其余为 null
     */
    public record PlaybackEvent(
            String type,
            double timeSec,
            Long accountId,
            Long targetAccountId,
            Integer damage
    ) {
    }
}

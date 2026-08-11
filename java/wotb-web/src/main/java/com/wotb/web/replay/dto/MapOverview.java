package com.wotb.web.replay.dto;

import java.util.List;

/**
 * AI 复盘结果页「地图鸟瞰」区块数据（可空；未知地图/无观测/无名册时为 null）。
 * <p>坐标约定：所有坐标与 {@code playableBounds} 同系——{@code x} = 地图横向 = 回放 x，
 * {@code y} = 地图纵向 = 回放 z（同一原点同一米制）。前端将图片拉伸铺满
 * {@code playableBounds} 后即可直接映射像素。</p>
 *
 * @param mapCode       内部地图 code（meta.json 的 mapName，小写）
 * @param displayName   人类可读地图名（如 Desert Sands）
 * @param playableBounds 可玩区边界
 * @param gridCells     6x6 分析格（36 个；id 如 F1/A6，带 nineGridRegion 与格子边界）
 * @param image         地图图片元信息（file/width/height；素材开关在前端 mapImages.js，
 *                      无素材时前端整块跳过，本字段仅信息性）
 * @param spawnPoints   出生点（语义坐标）
 * @param phases        阶段切片（开局/中期/残局，按 battle-relative 秒）
 * @param heatmaps      热力：本方/敌方 × 驻留/伤害/阵亡（每层 36 个值，与 gridCells 同序；
 *                      驻留=位置采样计数、伤害=累计伤害、阵亡=事件计数；前端按 max 归一化）
 * @param routes        双方路线（每车 ≤200 点、2s 采样、观测区间与阵亡时刻）
 */
public record MapOverview(
        String mapCode,
        String displayName,
        Bounds playableBounds,
        List<GridCell> gridCells,
        ImageInfo image,
        List<SpawnPoint> spawnPoints,
        List<Phase> phases,
        Heatmaps heatmaps,
        List<Route> routes
) {

    public MapOverview {
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
}

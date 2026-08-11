package com.wotb.core.replay.map;

import java.util.List;

/**
 * 地图鸟瞰所需的网格级坐标档案：可玩边界 + 6x6 分析格 + 出生点。
 * <p>数据来自 {@code map-semanticizer} 生成的
 * {@code common/map-semantics/*.semantic.json}（{@code playableBoundsMeters} /
 * {@code analysisGrid.cells} / {@code sceneEvidence.battlePoints}）。
 * 坐标语义与语义文件一致：{@code x} = 地图横向 = 回放 x；{@code y} = 地图纵向 = 回放 z；
 * 同一原点同一米制，可直接与回放原始坐标互相换算（{@link #inBounds}）。</p>
 *
 * @param mapCode       内部地图 code（小写，如 desert_train）
 * @param displayName   人类可读地图名（map_names.json 的 en 名；未收录时回退 mapId）
 * @param playableBounds 可玩区边界（语义坐标；y 轴=回放 z）
 * @param gridCells     6x6 分析格（36 个，id 如 F1/A6）
 * @param spawnPoints   出生点（sceneEvidence.battlePoints 中 type=spawnpoint 的条目）
 */
public record MapGridProfile(
        String mapCode,
        String displayName,
        Bounds playableBounds,
        List<GridCell> gridCells,
        List<SpawnPoint> spawnPoints
) {

    public MapGridProfile {
        mapCode = mapCode == null ? "" : mapCode;
        displayName = displayName == null ? "" : displayName;
        playableBounds = playableBounds == null ? Bounds.DEFAULT : playableBounds;
        gridCells = gridCells == null ? List.of() : List.copyOf(gridCells);
        spawnPoints = spawnPoints == null ? List.of() : List.copyOf(spawnPoints);
    }

    public boolean hasGrid() {
        return !mapCode.isBlank() && !gridCells.isEmpty();
    }

    /** 语义坐标是否落在可玩区内（含边界）。 */
    public boolean inBounds(final double x, final double y) {
        return x >= playableBounds.xMin() && x <= playableBounds.xMax()
                && y >= playableBounds.yMin() && y <= playableBounds.yMax();
    }

    /**
     * 语义坐标所在的 6x6 格子 id（如 F1）；落在可玩区外或未找到时返回 null。
     * 使用 36 格的精确 bounds 判定（playableBounds 外接区内的空隙也按格子归属）。
     */
    public GridCell cellAt(final double x, final double y) {
        for (final GridCell cell : gridCells) {
            if (x >= cell.bounds().xMin() && x <= cell.bounds().xMax()
                    && y >= cell.bounds().yMin() && y <= cell.bounds().yMax()) {
                return cell;
            }
        }
        return null;
    }

    /** 平面边界（语义坐标；y 轴=回放 z）。 */
    public record Bounds(double xMin, double xMax, double yMin, double yMax) {
        public static final Bounds DEFAULT = new Bounds(-500, 500, -500, 500);

        public Bounds {
            if (!Double.isFinite(xMin) || !Double.isFinite(xMax)
                    || !Double.isFinite(yMin) || !Double.isFinite(yMax)) {
                throw new IllegalArgumentException("Bounds must be finite");
            }
        }
    }

    /** 单个 6x6 分析格。 */
    public record GridCell(String id, int nineGridRegion, Bounds bounds) {
        public GridCell {
            id = id == null ? "" : id;
            bounds = bounds == null ? Bounds.DEFAULT : bounds;
        }
    }

    /** 出生点（语义坐标）。 */
    public record SpawnPoint(String name, int team, double x, double y) {
        public SpawnPoint {
            name = name == null ? "" : name;
        }
    }
}

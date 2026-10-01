// GENERATED FILE — do not edit by hand.
// Regenerate: python common/python/export_playable_bounds.py
//
// 可玩边界（游戏内实际战场范围，米）：来源 common/map-semantics/*.semantic.json 的
// `playableBoundsMeters`，按 `mapCodes` 展开成 mapCode → bounds。比真实地图
// coordinateBounds（±300）小——3D 边界带用它，与上游 Agent 同义（上游按数字 map_id，
// 本仓 3D 用 mapCode）。坐标系与回放一致：x = 回放 x、y = 回放 z。

export const playableBounds = {
  amigosville: { xMin: -256.3, yMin: -271.0, xMax: 265.0, yMax: 252.3 },
  canal: { xMin: -269.0, yMin: -263.0, xMax: 264.0, yMax: 263.4 },
  canyon: { xMin: -264.6, yMin: -264.1, xMax: 264.0, yMax: 264.1 },
  desert_train: { xMin: -256.0, yMin: -251.0, xMax: 260.0, yMax: 254.3 },
  erlenberg: { xMin: -237.3, yMin: -237.0, xMax: 238.8, yMax: 250.2 },
  faust: { xMin: -249.6, yMin: -249.1, xMax: 249.0, yMax: 249.7 },
  forgecity: { xMin: -237.0, yMin: -244.2, xMax: 269.4, yMax: 253.4 },
  fort: { xMin: -231.3, yMin: -234.9, xMax: 231.2, yMax: 235.2 },
  himmelsdorf: { xMin: -259.1, yMin: -260.8, xMax: 182.9, yMax: 255.1 },
  holland: { xMin: -255.5, yMin: -260.0, xMax: 263.1, yMax: 266.9 },
  holmeisk: { xMin: -249.8, yMin: -249.9, xMax: 250.2, yMax: 250.1 },
  idle: { xMin: -270.0, yMin: -267.0, xMax: 261.8, yMax: 257.0 },
  italy: { xMin: -249.8, yMin: -249.3, xMax: 249.6, yMax: 249.8 },
  karelia: { xMin: -261.2, yMin: -263.1, xMax: 266.6, yMax: 264.4 },
  karieri: { xMin: -230.6, yMin: -186.9, xMax: 249.5, yMax: 223.4 },
  lagoon: { xMin: -270.0, yMin: -260.0, xMax: 260.0, yMax: 270.0 },
  lumber: { xMin: -253.3, yMin: -253.5, xMax: 253.2, yMax: 253.2 },
  malinovka: { xMin: -267.7, yMin: -269.5, xMax: 267.4, yMax: 272.0 },
  medvedkovo: { xMin: -263.5, yMin: -263.6, xMax: 264.2, yMax: 264.2 },
  milbase: { xMin: -263.7, yMin: -263.7, xMax: 264.2, yMax: 263.7 },
  mountain: { xMin: -256.2, yMin: -277.8, xMax: 272.2, yMax: 254.4 },
  neptune: { xMin: -287.0, yMin: -275.4, xMax: 274.0, yMax: 276.6 },
  plant: { xMin: -259.0, yMin: -263.1, xMax: 266.7, yMax: 264.6 },
  pliego: { xMin: -260.1, yMin: -257.2, xMax: 256.6, yMax: 246.9 },
  port: { xMin: -268.3, yMin: -270.1, xMax: 267.4, yMax: 270.4 },
  rift: { xMin: -260.6, yMin: -262.4, xMax: 266.5, yMax: 264.1 },
  rock: { xMin: -265.6, yMin: -266.4, xMax: 266.1, yMax: 267.1 },
  savanna: { xMin: -272.0, yMin: -266.6, xMax: 263.4, yMax: 270.0 },
  skit: { xMin: -265.1, yMin: -260.7, xMax: 257.7, yMax: 261.8 },
}

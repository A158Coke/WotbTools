// GENERATED FILE — do not edit by hand.
// Regenerate: python common/python/extract_map_bases.py <Maps.zip>
// See docs/reference/maps.md for the extraction contract.

/**
 * 基地（占领点）几何，来源为客户端地图场景 `*.sc2`，世界坐标（米），
 * 与回放坐标、`mapImages.js` 的 `coordinateBounds` 同一坐标系。
 *
 * supremacy 争霸赛：3-4 个基地，`baseId` 由场景 `baseID` 0..3 而来，
 *   与后端 `SupremacyBaseId.fromProtocolIndex()` 及 wire 字段 `baseStates[].baseId` 同源。
 * assault 攻防战/遭遇战：每种模式配置一个基地，`team` 为守方；
 *   场景未声明半径时为 null，调用方自行取默认值。
 */
export const mapBases = {
  amigosville: {
    supremacy: [
      { baseId: "A", x: -179.4424, y: 2.933, radius: 15.0 },
      { baseId: "B", x: -3.7777, y: -10.822, radius: 15.0 },
      { baseId: "C", x: 177.3618, y: -16.3423, radius: 15.0 },
    ],
    assault: [
      { x: -80.9815, y: -0.2824, radius: 15.0, team: 1 },
      { x: -57.6012, y: -0.2369, radius: null, team: 1 },
      { x: 177.1922, y: -16.3833, radius: 15.0, team: 1 },
    ],
  },
  canal: {
    supremacy: [
      { baseId: "A", x: -201.7, y: 211.0, radius: 15.0 },
      { baseId: "B", x: -8.3, y: 92.2, radius: 15.0 },
      { baseId: "C", x: -58.6, y: -80.7, radius: 15.0 },
      { baseId: "D", x: 142.6, y: -130.3, radius: 15.0 },
    ],
    assault: [
      { x: -96.3611, y: 71.795, radius: 24.0, team: null },
      { x: -96.2032, y: 71.7189, radius: 24.0, team: null },
    ],
  },
  canyon: {
    supremacy: [
      { baseId: "A", x: -159.5682, y: -147.3962, radius: 15.0 },
      { baseId: "B", x: -54.7471, y: 9.2134, radius: 15.0 },
      { baseId: "C", x: 219.7489, y: 227.805, radius: 15.0 },
    ],
    assault: [
      { x: 28.3603, y: 24.8753, radius: null, team: null },
    ],
  },
  desert_train: {
    supremacy: [
      { baseId: "A", x: -97.4, y: -3.7798, radius: 15.0 },
      { baseId: "B", x: 116.8013, y: -2.8475, radius: 15.0 },
      { baseId: "C", x: 201.5, y: 0.0202, radius: 15.0 },
    ],
    assault: [
      { x: -95.0132, y: -3.9056, radius: 15.0, team: 1 },
      { x: 130.2577, y: -2.5428, radius: 15.0, team: 1 },
      { x: 134.0135, y: -2.4993, radius: null, team: 1 },
    ],
  },
  erlenberg: {
    supremacy: [
      { baseId: "A", x: -153.8, y: 69.4, radius: 15.0 },
      { baseId: "B", x: -82.2, y: -70.0, radius: 15.0 },
      { baseId: "C", x: 114.0, y: -14.5, radius: 15.0 },
    ],
    assault: [
      { x: -144.5888, y: -16.3902, radius: null, team: 1 },
      { x: -63.1881, y: -17.7459, radius: 15.0, team: 1 },
      { x: 84.12, y: -15.4552, radius: 15.0, team: 1 },
    ],
  },
  faust: {
    supremacy: [
      { baseId: "A", x: -169.876, y: -170.0455, radius: 15.0 },
      { baseId: "B", x: 10.1935, y: 8.943, radius: 15.0 },
      { baseId: "C", x: -3.072, y: 172.301, radius: 15.0 },
      { baseId: "D", x: 166.4382, y: -7.0509, radius: 15.0 },
    ],
    assault: [
      { x: 10.1704, y: 8.9124, radius: 20.0, team: 1 },
    ],
  },
  forgecity: {
    supremacy: [
      { baseId: "A", x: 138.4907, y: 141.6109, radius: 13.0 },
      { baseId: "B", x: -183.7076, y: -86.4914, radius: 15.0 },
      { baseId: "C", x: -11.8477, y: -176.1306, radius: 15.0 },
    ],
    assault: [
      { x: -37.7299, y: -35.6658, radius: null, team: 1 },
    ],
  },
  fort: {
    supremacy: [
      { baseId: "A", x: -141.5876, y: 140.1517, radius: 15.0 },
      { baseId: "B", x: -39.8, y: 38.7, radius: 15.0 },
      { baseId: "C", x: 98.0468, y: -111.7606, radius: 15.0 },
    ],
    assault: [
      { x: -65.5133, y: 64.042, radius: null, team: 1 },
    ],
  },
  himmelsdorf: {
    supremacy: [
      { baseId: "A", x: -188.5, y: -3.2, radius: 15.0 },
      { baseId: "B", x: -56.2, y: -93.0, radius: 15.0 },
      { baseId: "C", x: 26.1, y: 70.6, radius: 15.0 },
      { baseId: "D", x: 130.491, y: -20.4, radius: 15.0 },
    ],
    assault: [
      { x: 53.8415, y: -14.6496, radius: null, team: 1 },
    ],
  },
  holland: {
    supremacy: [
      { baseId: "A", x: -173.1328, y: 151.5748, radius: 15.0 },
      { baseId: "B", x: 30.2135, y: -13.1623, radius: 15.0 },
      { baseId: "C", x: 160.3196, y: -145.2601, radius: 15.0 },
    ],
    assault: [
      { x: 26.953, y: -9.5286, radius: null, team: null },
    ],
  },
  holmeisk: {
    supremacy: [
      { baseId: "A", x: -148.693, y: 146.9574, radius: 15.0 },
      { baseId: "B", x: -14.8593, y: 13.2936, radius: 15.0 },
      { baseId: "C", x: 147.2408, y: -143.1274, radius: 15.0 },
    ],
    assault: [
      { x: -14.9676, y: 13.2939, radius: null, team: 1 },
    ],
  },
  idle: {
    supremacy: [
      { baseId: "A", x: 147.8344, y: 163.2643, radius: 15.0 },
      { baseId: "B", x: -68.906, y: 110.581, radius: 15.0 },
      { baseId: "C", x: 89.4242, y: 18.873, radius: 15.0 },
      { baseId: "D", x: -124.5497, y: -98.5841, radius: 15.0 },
    ],
    assault: [
      { x: 70.2682, y: 103.8259, radius: null, team: null },
    ],
  },
  italy: {
    supremacy: [
      { baseId: "A", x: 9.7024, y: 123.7733, radius: 15.0 },
      { baseId: "B", x: -68.2201, y: -28.3946, radius: 15.0 },
      { baseId: "C", x: 167.2163, y: -161.4607, radius: 15.0 },
    ],
    assault: [
      { x: 30.12, y: -10.8184, radius: null, team: null },
    ],
  },
  karelia: {
    supremacy: [
      { baseId: "A", x: -137.6871, y: -138.8718, radius: 15.0 },
      { baseId: "B", x: -41.7, y: -38.7, radius: 15.0 },
      { baseId: "C", x: 86.6948, y: 101.9818, radius: 15.0 },
    ],
    assault: [
      { x: -41.7042, y: -38.7984, radius: null, team: 1 },
    ],
  },
  karieri: {
    supremacy: [
      { baseId: "A", x: 18.3242, y: -93.0956, radius: 15.0 },
      { baseId: "B", x: 10.6415, y: 15.0727, radius: 15.0 },
      { baseId: "C", x: 8.5367, y: 136.4924, radius: 15.0 },
    ],
    assault: [
      { x: 10.6638, y: 1.5831, radius: null, team: 1 },
    ],
  },
  lagoon: {
    supremacy: [
      { baseId: "A", x: -148.678, y: 148.131, radius: 15.0 },
      { baseId: "B", x: 7.3922, y: -5.5194, radius: 15.0 },
      { baseId: "C", x: 188.857, y: -192.39, radius: 15.0 },
    ],
    assault: [
      { x: -53.8336, y: 54.2303, radius: null, team: null },
    ],
  },
  lumber: {
    supremacy: [
      { baseId: "A", x: -99.8152, y: 133.8117, radius: 15.0 },
      { baseId: "B", x: 12.4503, y: -16.5983, radius: 15.0 },
      { baseId: "C", x: 173.6066, y: -181.1906, radius: 15.0 },
    ],
    assault: [
      { x: 69.5876, y: -79.6881, radius: null, team: 1 },
      { x: 79.0857, y: -73.6436, radius: 15.0, team: 1 },
    ],
  },
  malinovka: {
    supremacy: [
      { baseId: "A", x: -108.9493, y: -137.2444, radius: 15.0 },
      { baseId: "B", x: 90.9803, y: 86.531, radius: 15.0 },
      { baseId: "C", x: 211.9526, y: 220.5485, radius: 15.0 },
    ],
    assault: [
      { x: 57.4958, y: 43.3762, radius: null, team: 1 },
    ],
  },
  medvedkovo: {
    supremacy: [
      { baseId: "A", x: -189.0761, y: -8.9296, radius: 15.0 },
      { baseId: "B", x: -11.0362, y: -7.0033, radius: 15.0 },
      { baseId: "C", x: 219.7365, y: -29.7617, radius: 15.0 },
    ],
    assault: [
      { x: -3.2388, y: -7.1114, radius: 15.0, team: 1 },
      { x: -1.2798, y: -7.0259, radius: null, team: 1 },
      { x: 119.3202, y: -4.0293, radius: 17.0, team: 1 },
    ],
  },
  milbase: {
    supremacy: [
      { baseId: "A", x: -201.0668, y: -11.5038, radius: 15.0 },
      { baseId: "B", x: -37.5224, y: -11.196, radius: 15.0 },
      { baseId: "C", x: 209.1768, y: -2.4648, radius: 15.0 },
    ],
    assault: [
      { x: -110.0752, y: -10.9828, radius: 15.0, team: 1 },
      { x: -110.0671, y: -10.9309, radius: null, team: 1 },
      { x: -36.9179, y: -11.2395, radius: 15.0, team: 1 },
      { x: -15.3905, y: 16.5051, radius: 15.0, team: 1 },
      { x: 80.4629, y: -10.9828, radius: 15.0, team: 1 },
    ],
  },
  mountain: {
    supremacy: [
      { baseId: "A", x: -74.1, y: 76.7, radius: 15.0 },
      { baseId: "B", x: 80.0, y: -63.0, radius: 15.0 },
      { baseId: "C", x: 201.9, y: -207.3, radius: 15.0 },
    ],
    assault: [
      { x: 118.1688, y: -123.9436, radius: null, team: null },
    ],
  },
  neptune: {
    supremacy: [
      { baseId: "A", x: -174.7086, y: 8.7847, radius: 15.0 },
      { baseId: "B", x: 3.6204, y: 8.6991, radius: 15.0 },
      { baseId: "C", x: 135.0464, y: -49.2444, radius: 15.0 },
      { baseId: "D", x: 139.5419, y: 63.0127, radius: 15.0 },
    ],
    assault: [
      { x: -174.7717, y: 8.811, radius: 15.0, team: 1 },
      { x: 49.5339, y: 8.5291, radius: null, team: 1 },
      { x: 56.7256, y: 8.1217, radius: null, team: 1 },
    ],
  },
  plant: {
    supremacy: [
      { baseId: "A", x: -174.0079, y: 112.6794, radius: 15.0 },
      { baseId: "B", x: -3.0353, y: -94.307, radius: 15.0 },
      { baseId: "C", x: 79.3339, y: 10.4236, radius: 15.0 },
      { baseId: "D", x: 179.9265, y: -176.7886, radius: 15.0 },
    ],
    assault: [
      { x: 40.0591, y: -43.6425, radius: null, team: 1 },
    ],
  },
  pliego: {
    supremacy: [
      { baseId: "A", x: -218.6, y: -4.2, radius: 15.0 },
      { baseId: "B", x: 26.9996, y: -11.9894, radius: 15.0 },
      { baseId: "C", x: 185.9, y: -2.6, radius: 15.0 },
    ],
    assault: [
      { x: 27.0429, y: -11.9373, radius: null, team: 1 },
    ],
  },
  port: {
    supremacy: [
      { baseId: "A", x: -118.29, y: -105.9, radius: 15.0 },
      { baseId: "B", x: -26.18, y: 0.74, radius: 15.0 },
      { baseId: "C", x: 113.8, y: 118.7, radius: 15.0 },
    ],
    assault: [
      { x: -41.8351, y: -11.1775, radius: null, team: null },
    ],
  },
  rift: {
    supremacy: [
      { baseId: "A", x: -162.5317, y: 54.3632, radius: 15.0 },
      { baseId: "B", x: -59.0869, y: 163.525, radius: 15.0 },
      { baseId: "C", x: 136.5909, y: -137.0223, radius: 15.0 },
    ],
    assault: [
      { x: -5.674, y: 2.9863, radius: null, team: 1 },
    ],
  },
  rock: {
    supremacy: [
      { baseId: "A", x: 188.9083, y: -190.8466, radius: 15.0 },
      { baseId: "B", x: 21.5518, y: -19.8421, radius: 15.0 },
      { baseId: "C", x: -131.057, y: 127.3793, radius: 15.0 },
    ],
    assault: [
      { x: 31.421, y: -30.1357, radius: null, team: null },
    ],
  },
  savanna: {
    supremacy: [
      { baseId: "A", x: -185.2861, y: 181.8763, radius: 15.0 },
      { baseId: "B", x: -74.0719, y: 68.8032, radius: 15.0 },
      { baseId: "C", x: 179.8389, y: -164.7805, radius: 15.0 },
    ],
    assault: [
      { x: -84.829, y: 79.7184, radius: null, team: 1 },
    ],
  },
  skit: {
    supremacy: [
      { baseId: "A", x: -89.4571, y: 90.2212, radius: 15.0 },
      { baseId: "B", x: -38.7779, y: 34.2303, radius: 15.0 },
      { baseId: "C", x: 73.3406, y: -91.2711, radius: 15.0 },
    ],
    assault: [
      { x: -38.78, y: 34.2146, radius: 20.0, team: 1 },
    ],
  },
}

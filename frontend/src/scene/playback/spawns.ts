// 出生点贴地标记（地图预览 3D 会话；#835 spawn markers）。
//
// 数据面（唯一事实）：`common/map-semantics/<key>.semantic.json` 的
// `sceneEvidence.battlePoints`（type=spawnpoint），经 toMapOverview.parseMapGridProfile
// 解析为 profile.spawnPoints，由宿主（MapPreviewPage）下发 `setMapSpawns`。本模块
// **不读语义文件、不猜坐标**：宿主没给 / 给的不是数组 → 不画；条目坐标非有限 → 该条
// 不画（防御性兜底，解析器才是核验关口）。
//
// 呈现口径与 2D 预览（BattleMap `pb-spawn-neutral`）一致：预览没有 friendlyTeam
// 上下文 → 全部中性色，不猜阵营配色；也不做 respawn 区域语义（语义面只有
// EXACT_SCENE_DATA 的出生点位，没有重生语义，fail-closed 不发明）。
//
// 渲染复用基地的贴地几何（makeGroundedDisc / makeGroundedRing 导出复用）：
// 每个出生点一个中性小圆盘 + 外环，逐顶点贴地（起伏地形不被埋）；地形异步就绪后
// reground 重建（与基地同一链路）。回放会话不消费（3D 回放无此需求）。
import * as THREE from 'three'
import type { Scene } from 'three'
import { makeGroundedDisc, makeGroundedRing } from './bases.js'

/** 宿主下发的出生点（toMapOverview.MapSpawnPoint 的结构面：解析器只产有限坐标，
 *  这里仍逐条兜底——非有限条目不画，不让脏数据制造 NaN 几何）。 */
export interface MapSpawnPoint {
  name?: string
  team?: number
  x: number
  y: number
}

/** 出生点标记对象（贴地几何 + 材质；reground 按新高度场重建几何）。 */
interface SpawnMarkerObject {
  gx: number
  gz: number
  disc: THREE.Mesh
  ring: THREE.Mesh
  reground(): void
}

const SPAWN_DISC_R = 2.2     // 米：单点小盘（2D 预览 4px 点的同量级地面呈现）
const SPAWN_RING_R = 3.4     // 米：外环提高远距可读性
const SPAWN_COLOR_FALLBACK = '#858f81'   // tokens.css --text-muted 缺省值

export function createSpawnMarkers({ getScene, groundY }: {
  getScene: () => Scene
  groundY: (x: number, z: number) => number
}): {
  build(points: readonly MapSpawnPoint[] | null | undefined): void
  clear(): void
  reground(): void
} {
let markers: SpawnMarkerObject[] = [];

function spawnColor(): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return SPAWN_COLOR_FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  return (cs.getPropertyValue('--text-muted') || '').trim() || SPAWN_COLOR_FALLBACK;
}

function clearSpawns() {
  for (const m of markers) {
    getScene().remove(m.disc); m.disc.geometry.dispose(); (m.disc.material as THREE.Material).dispose();
    getScene().remove(m.ring); m.ring.geometry.dispose(); (m.ring.material as THREE.Material).dispose();
  }
  markers = [];
}

function addSpawnMarker(gx: number, gz: number): void {
  const color = spawnColor();
  // 坐标口径与 3D 回放一致：replay/semantic x → scene −x 镜像（bases.addBaseMarker 同式）。
  const sx = -gx, sz = gz;
  const disc = new THREE.Mesh(
    makeGroundedDisc(groundY, sx, sz, SPAWN_DISC_R, 4, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
                                  depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  getScene().add(disc);
  const ring = new THREE.Mesh(
    makeGroundedRing(groundY, sx, sz, SPAWN_RING_R, 48),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
                                  depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  getScene().add(ring);
  markers.push({
    gx, gz, disc, ring,
    // 地形异步就绪后：按新高度场重建贴地几何（与基地 reground 同链）
    reground: () => {
      disc.geometry.dispose(); disc.geometry = makeGroundedDisc(groundY, sx, sz, SPAWN_DISC_R, 4, 24);
      ring.geometry.dispose(); ring.geometry = makeGroundedRing(groundY, sx, sz, SPAWN_RING_R, 48);
    },
  });
}

function buildSpawns(points: readonly MapSpawnPoint[] | null | undefined): void {
  clearSpawns();
  if (!Array.isArray(points)) return;   // 非数组（null/缺档）fail-closed：不画、不猜
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;   // 脏条目兜底
    addSpawnMarker(p.x, p.y);
  }
}

function regroundSpawns() {
  for (const m of markers) m.reground();
}

  return {
    build: buildSpawns,
    clear: clearSpawns,
    reground: regroundSpawns,
  };
}

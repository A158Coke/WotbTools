// 出生点贴地标记（地图预览 3D 会话；#835 spawn markers）。
//
// 数据面（唯一事实）：`common/map-semantics/<key>.semantic.json` 的
// `sceneEvidence.battlePoints`（type=spawnpoint），经 toMapOverview.parseMapGridProfile
// 解析为 profile.spawnPoints，由宿主（MapPreviewPage）下发 `setMapSpawns`。本模块
// **不读语义文件、不猜坐标**：宿主没给 / 给的不是数组 → 不画；条目坐标非有限 → 该条
// 不画（防御性兜底，解析器才是核验关口）。
//
// 呈现口径与 2D 预览一致（scene-team 身份色，#835）：语义面自带固定分组 team（物理
// Team 1/2），据此选色——Team 1 绿 / Team 2 红 / 未知中性；这是**场景分组身份色**，
// 不是回放的 friendly/enemy 相对语义（预览没有 friendlyTeam 上下文，不猜相对阵营）。
// 也不做 respawn 区域语义（语义面只有 EXACT_SCENE_DATA 的出生点位，没有重生语义，
// fail-closed 不发明）。
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
// 场景分组身份色（物理 Team 1/2，固定不随视角/方向交换——**不是** friendly/enemy 语义）：
// 复用回放阵营 token（--color-team-1/2，theme 内 green-400/700、red-400/700），不建第二套配置。
const SPAWN_TEAM1_FALLBACK = '#5cc280'   // tokens.css --color-team-1 缺省值
const SPAWN_TEAM2_FALLBACK = '#f2786d'   // tokens.css --color-team-2 缺省值
// 红绿盘的外环深色轮廓（压过草地/道路/建筑背景的辨识边）：复用 on-team-neutral 的
// 不透明近黑（双主题同值）；three 0.185 无法解析 `rgb(0 0 0 / α)` 语法，故不选含 alpha 的 token。
const SPAWN_RING_OUTLINE_FALLBACK = '#1c1f1d'   // tokens.css --color-on-team-neutral 缺省值

export function createSpawnMarkers({ getScene, groundY }: {
  getScene: () => Scene
  groundY: (x: number, z: number) => number
}): {
  build(points: readonly MapSpawnPoint[] | null | undefined): void
  clear(): void
  reground(): void
} {
let markers: SpawnMarkerObject[] = [];

function tokenColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  return (cs.getPropertyValue(name) || '').trim() || fallback;
}

/** 场景 Team 1/2 是固定身份分组：严格判定 1/2，其余（null/0/3/未知）一律中性，不猜。 */
function spawnColor(team: number | undefined | null): string {
  if (team === 1) return tokenColor('--color-team-1', SPAWN_TEAM1_FALLBACK);
  if (team === 2) return tokenColor('--color-team-2', SPAWN_TEAM2_FALLBACK);
  return tokenColor('--text-muted', SPAWN_COLOR_FALLBACK);
}

/** 红绿盘用不透明主题色（草地/道路/建筑上清晰可辨）；中性盘保持原半透明灰绿。 */
function isTeamColor(team: number | undefined | null): boolean {
  return team === 1 || team === 2;
}

function clearSpawns() {
  for (const m of markers) {
    getScene().remove(m.disc); m.disc.geometry.dispose(); (m.disc.material as THREE.Material).dispose();
    getScene().remove(m.ring); m.ring.geometry.dispose(); (m.ring.material as THREE.Material).dispose();
  }
  markers = [];
}

function addSpawnMarker(gx: number, gz: number, team: number | undefined | null): void {
  const color = spawnColor(team);
  // 坐标口径与 3D 回放一致：replay/semantic x → scene −x 镜像（bases.addBaseMarker 同式）。
  const sx = -gx, sz = gz;
  const teamColor = isTeamColor(team);
  const disc = new THREE.Mesh(
    makeGroundedDisc(groundY, sx, sz, SPAWN_DISC_R, 4, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,
                                  // 红绿身份盘不透明（无 alpha 混合即可远距辨色）；中性盘维持原半透明
                                  transparent: !teamColor, opacity: teamColor ? 1 : 0.85,
                                  depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  getScene().add(disc);
  const ringColor = teamColor ? tokenColor('--color-on-team-neutral', SPAWN_RING_OUTLINE_FALLBACK) : color;
  const ring = new THREE.Mesh(
    makeGroundedRing(groundY, sx, sz, SPAWN_RING_R, 48),
    new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
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
    addSpawnMarker(p.x, p.y, p.team);
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

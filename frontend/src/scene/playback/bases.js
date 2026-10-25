// 基地贴地标记系统（2026-10-24 自 initPlayback 闭包出仓，current-plan.md Step A4
// 叶子段；代码与搬移前逐字一致，闭包读数改经 getter 快照：getScene/getCamera/
// getData/getMapBases，groundY 由宿主注入——闭包内函数声明，创建期引用安全）。
// 语义注释（设计语言 token、语义红线、fail-closed 判据）随代码原样保留。
import * as THREE from 'three'
import { orientDiscUv } from '../baseDecal.js'
import { ASSAULT_BASE_ID, SUPREMACY_BASE_IDS, baseView, foldAssaultProgress, foldSupremacyTransitions } from '../../utils/baseStatus.js'

// ---------- 基地（争霸 A–D / 单基地）：贴地标记 ----------
// 几何来自 mapBases[key]（客户端 .sc2 提取，世界坐标；scene x = −游戏 x 镜像）；
// 状态口径与 2D 地图、顶部基地状态条共用 utils/baseStatus.js（seek 折叠：clock ≤ t 的最后一条）。
// 地上只画两样，全部贴着地形：
//   · 圆环：当前归属色（友绿 / 敌红 / 中立白）；
//   · 圆盘：淡归属底色 + 按占领进度从下往上"灌水"（占领方颜色）+ 圆心字母（单基地为旗帜）。
// 圆盘贴图随相机水平朝向转正——平躺在地上，但从任何方向看字都是正的。空中不再有 HUD。
// 颜色取自设计语言阵营 token（design-language §3.3：2D、3D 共用），读不到时用同值兜底。

export function createBaseMarkers({ getScene, getCamera, getData, getMapBases, store, groundY }) {
const BASE_TEX = 256;
const BASE_COLOR_FALLBACK = { friendly: '#5cc280', enemy: '#f2786d', neutral: '#f5f5f5', objective: '#ffc24b', onNeutral: '#1c1f1d' };
let baseObjects = [];   // { baseId, kind, gx, gz, r, ring, disc, canvas, ctx, tex, stateKey, uvDir, ringHex }
let baseColors = BASE_COLOR_FALLBACK;
let supremacyBaseIds = [];   // 本场出现过的争霸基地（轨迹 ∪ 几何），状态条按它列出
let lastBaseViewsKey = '';

function readBaseColors() {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return BASE_COLOR_FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const read = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    friendly: read('--color-team-ally', BASE_COLOR_FALLBACK.friendly),
    enemy: read('--color-team-enemy', BASE_COLOR_FALLBACK.enemy),
    neutral: read('--color-team-neutral', BASE_COLOR_FALLBACK.neutral),
    objective: read('--color-objective', BASE_COLOR_FALLBACK.objective),
    onNeutral: read('--color-on-team-neutral', BASE_COLOR_FALLBACK.onNeutral),
  };
}

// ---------- 单基地目标（Assault / Encounter）----------
// 几何来自 mapBases[key].assault（客户端 .sc2 提取，世界坐标；scene x = −游戏 x 镜像），
// 状态来自 Agent 契约 v2 的 assault_objective_present / assault_bases（wrapper8/root8）。
//
// 语义红线（docs/research/replay/assault-base-state.md）：单基地的 owner/capturing 恒为
// null，静态 scene 的 `team` 字段语义 UNKNOWN——一律不据此上色/推断归属；环与 HUD 用中性
// 色，进度条用呈现强调色（仅表示"有占领进度"，不代表阵营）。半径不做车辆距离推算。
//
// 目标存在性判据：assault_objective_present 优先（上游 v0.3.11 = **目标族存在性**：
// wrapper8 目标族 field2==1 且 field1∈{1,2} 出现即 true，不要求进度字段），旧产物
// 回退"有进度广播"。存在性只是前提——真正落地的标记还要求该地图 verified semantics
// 给出**唯一**单基地 controlpoint（多 candidate fail-closed，见 buildBases）。
const ASSAULT_RADIUS_FALLBACK = 20;      // 客户端 scene 常不声明 radius：20m 仅呈现兜底
const ASSAULT_PROGRESS_COLOR = 0xffc24b; // 呈现强调色（非阵营语义）
function assaultHasObjective() {
  if (getData().assault_objective_present === true) return true;
  if (getData().assault_objective_present === undefined) {
    return !!(getData().assault_bases && getData().assault_bases.length);
  }
  return false;
}

function clearBases() {
  for (const b of baseObjects) {
    getScene().remove(b.ring); b.ring.geometry.dispose(); b.ring.material.dispose();
    getScene().remove(b.disc); b.disc.geometry.dispose(); b.disc.material.dispose(); b.tex.dispose();
  }
  baseObjects = [];
  supremacyBaseIds = [];
  lastBaseViewsKey = '';
  store.baseViews = [];
}

function addBaseMarker(baseId, kind, gx, gz, r) {
  const ring = new THREE.Mesh(
    makeGroundedRing(gx, gz, r),
    new THREE.MeshBasicMaterial({ color: baseColors.neutral, side: THREE.DoubleSide,
                                  transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  getScene().add(ring);
  const canvas = document.createElement('canvas'); canvas.width = BASE_TEX; canvas.height = BASE_TEX;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const disc = new THREE.Mesh(
    makeGroundedDisc(gx, gz, r * 0.9),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false,
                                  toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  getScene().add(disc);
  const b = { baseId, kind, gx, gz, r, ring, disc, canvas, ctx: canvas.getContext('2d'), tex,
              stateKey: undefined, uvDir: null, ringHex: null,
              // 地形异步就绪后：按新高度场重建贴地环带与圆盘
              reground: () => {
                ring.geometry.dispose(); ring.geometry = makeGroundedRing(gx, gz, r);
                disc.geometry.dispose(); disc.geometry = makeGroundedDisc(gx, gz, r * 0.9);
                b.uvDir = null;
              } };
  baseObjects.push(b);
}

function buildBases() {
  clearBases();
  baseColors = readBaseColors();
  const tracks = getData().supremacy_bases || [];
  if (tracks.length) {
    // 非争霸场次不画（不靠静态几何猜模式）；无几何的地图不猜坐标，但状态条照样列出
    const seen = new Set(tracks.map((tr) => SUPREMACY_BASE_IDS[tr.base_id]).filter(Boolean));
    const pts = (getMapBases() && getMapBases().supremacy) || [];
    for (const p of pts) {
      if (!SUPREMACY_BASE_IDS.includes(p.baseId)) continue;
      seen.add(p.baseId);
      addBaseMarker(p.baseId, 'supremacy', -p.x, p.y, p.radius || 15);
    }
    supremacyBaseIds = SUPREMACY_BASE_IDS.filter((id) => seen.has(id));
  }
  if (assaultHasObjective()) {
    const pts = (getMapBases() && getMapBases().assault) || [];
    // 多 candidate 无证据 fail-closed（与 2D basesAt 同式）：几何不唯一就不画地面标记
    if (pts.length === 1) addBaseMarker(ASSAULT_BASE_ID, 'assault', -pts[0].x, pts[0].y, pts[0].radius || ASSAULT_RADIUS_FALLBACK);
  }
}

function regroundBases() {
  for (const b of baseObjects) b.reground();
}

/** 当前时刻的基地视图模型（与 2D 同一口径），状态条与贴地标记共用 */
function baseViewsAt(t) {
  const ft = getData().meta.friendly_team;
  const views = [];
  if (supremacyBaseIds.length) {
    for (const state of foldSupremacyTransitions(getData().supremacy_bases, t)) {
      if (supremacyBaseIds.includes(state.baseId)) views.push(baseView(state, ft));
    }
  }
  if (assaultHasObjective()) views.push(baseView(foldAssaultProgress(getData().assault_bases, t), ft));
  return views;
}

function drawBaseDecal(b, view) {
  const ctx = b.ctx, S = BASE_TEX, c = S / 2, R = S / 2 - 2;
  const owner = baseColors[view.owner];
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.2; ctx.fillStyle = owner; ctx.fillRect(0, 0, S, S);
  const fillColor = view.kind === 'assault' ? baseColors.objective : (view.capturing ? baseColors[view.capturing] : null);
  if (fillColor && view.progress != null) {
    // 从下往上"灌水"（下 = 靠近相机一侧，贴图随视角转正）
    const h = 2 * R * (view.progress / 100);
    ctx.globalAlpha = 0.5; ctx.fillStyle = fillColor; ctx.fillRect(0, c + R - h, S, h);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  if (view.kind === 'supremacy') {
    ctx.font = 'bold 132px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeText(b.baseId, c, c + 6); ctx.fillStyle = owner; ctx.fillText(b.baseId, c, c + 6);
  } else {
    // 旗帜（单基地没有字母）：旗杆 + 三角旗
    ctx.beginPath(); ctx.moveTo(c - 26, c + 54); ctx.lineTo(c - 26, c - 54);
    ctx.lineTo(c + 42, c - 30); ctx.lineTo(c - 26, c - 6);
    ctx.stroke(); ctx.strokeStyle = baseColors.neutral; ctx.lineWidth = 8; ctx.stroke();
  }
  b.tex.needsUpdate = true;
}

function updateBases(clock) {
  if (!getData()) return;
  const views = baseViewsAt(clock);
  const key = views.map((v) => v.baseId + ':' + v.owner + '/' + v.capturing + '/' + v.progress).join('|');
  if (key !== lastBaseViewsKey) { lastBaseViewsKey = key; store.baseViews = views; }
  for (const b of baseObjects) {
    const view = views.find((v) => v.baseId === b.baseId);
    if (!view) continue;
    const stateKey = view.owner + '/' + view.capturing + '/' + view.progress;
    if (b.stateKey !== stateKey) { b.stateKey = stateKey; drawBaseDecal(b, view); }
    const ringHex = baseColors[view.owner];
    if (b.ringHex !== ringHex) { b.ring.material.color.set(ringHex); b.ringHex = ringHex; }
    // 贴图转正：字母"上"指向远离相机的方向；水平朝向变化超过约 2° 才重算 UV
    const dx = b.gx - getCamera().position.x, dz = b.gz - getCamera().position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const ux = dx / len, uz = dz / len;
    if (!b.uvDir || ux * b.uvDir[0] + uz * b.uvDir[1] < 0.9994) {
      orientDisc(b.disc.geometry, ux, uz);
      b.uvDir = [ux, uz];
    }
  }
}

// 逐顶点贴地圆盘（极坐标网格，中心 + rings 圈）。offsets 记录每个顶点相对圆心的归一化偏移，
// UV 由 orientDiscUv 按观察方向旋转计算，几何本身不随视角重建。
function makeGroundedDisc(gx, gz, radius, rings = 10, seg = 48) {
  const count = 1 + rings * seg;
  const pos = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 2);
  pos[0] = gx; pos[1] = groundY(gx, gz) + 0.05; pos[2] = gz;
  let k = 1;
  for (let i = 1; i <= rings; i++) {
    const rr = (i / rings) * radius;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
      pos[k * 3] = gx + dx; pos[k * 3 + 1] = groundY(gx + dx, gz + dz) + 0.05; pos[k * 3 + 2] = gz + dz;
      offsets[k * 2] = dx / radius; offsets[k * 2 + 1] = dz / radius;
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + ((j + 1) % seg));
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * seg, b0 = 1 + i * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geo.setIndex(idx);
  geo.userData.offsets = offsets;
  return geo;
}

function orientDisc(geo, ux, uz) {
  orientDiscUv(geo.userData.offsets, geo.attributes.uv.array, ux, uz);
  geo.attributes.uv.needsUpdate = true;
}

// 逐顶点贴地圆环（与地面/边界同构：起伏地形上平面圆环会被坡地埋掉）
function makeGroundedRing(gx, gz, radius, seg = 72) {
  const pos = new Float32Array((seg + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const xo = gx + ca * radius, zo = gz + sa * radius;
    const xi = gx + ca * radius * 0.9, zi = gz + sa * radius * 0.9;
    pos[i * 6] = xo; pos[i * 6 + 1] = groundY(xo, zo) + 0.08; pos[i * 6 + 2] = zo;
    pos[i * 6 + 3] = xi; pos[i * 6 + 4] = groundY(xi, zi) + 0.08; pos[i * 6 + 5] = zi;
  }
  for (let i = 0; i < seg; i++) {
    idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
  return {
    build: buildBases,
    clear: clearBases,
    update: updateBases,
    reground: regroundBases,
  };
}

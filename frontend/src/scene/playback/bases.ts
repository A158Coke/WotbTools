import * as THREE from 'three'
import type { PerspectiveCamera, Scene, Texture } from 'three'
import type { AgentAssaultBaseTransition, AgentSupremacyBaseTransition } from '../../api/agent-replay-facets.js'
import { orientDiscUv } from '../baseDecal.js'
import { PLAYBACK_ROLES } from '../../data/mapTeamColors.js'
import { ASSAULT_BASE_ID, SUPREMACY_BASE_IDS, baseView, foldAssaultProgress, foldSupremacyTransitions } from '../../utils/baseStatus.js'

export type BaseSide = 'friendly' | 'enemy' | 'neutral'
export type BaseView = ReturnType<typeof baseView>

export interface MapBasePoint {
  baseId?: string
  x: number
  y: number
  radius?: number
}

export interface MapBasesEntry {
  supremacy?: MapBasePoint[]
  assault?: MapBasePoint[]
  variants?: Record<string, { supremacy?: MapBasePoint[]; assault?: MapBasePoint[] }>
}

export function basesForVariant(
  entry: MapBasesEntry | null | undefined,
  variant: string | null | undefined,
): MapBasesEntry | null {
  if (!entry) return null
  const picked = variant ? entry.variants?.[variant] : null
  return picked || entry
}

export interface BasesData {
  meta: { friendly_team?: number | null }
  supremacy_bases?: AgentSupremacyBaseTransition[] | null
  assault_bases?: AgentAssaultBaseTransition[] | null
  assault_objective_present?: boolean
}

export interface BaseColors {
  friendly: string
  enemy: string
  neutral: string
  objective: string
}

interface BaseMarkerObject {
  baseId: string
  kind: 'supremacy' | 'assault'
  gx: number
  gz: number
  r: number
  ring: THREE.Mesh
  disc: THREE.Mesh
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tex: Texture
  stateKey: string | undefined
  uvDir: [number, number] | null
  ringHex: string | null
  reground(): void
}

export interface BasesStore {
  baseViews: BaseView[]
}


export function makeGroundedDisc(groundY: (x: number, z: number) => number, gx: number, gz: number, radius: number, rings = 10, seg = 48): THREE.BufferGeometry {
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
  const idx: number[] = [];
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

export function makeGroundedRing(groundY: (x: number, z: number) => number, gx: number, gz: number, radius: number, seg = 72): THREE.BufferGeometry {
  const pos = new Float32Array((seg + 1) * 2 * 3);
  const idx: number[] = [];
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

export function createBaseMarkers({ getScene, getCamera, getData, getMapBases, store, groundY }: {
  getScene: () => Scene
  getCamera: () => PerspectiveCamera
  getData: () => BasesData
  getMapBases: () => MapBasesEntry | null
  store: BasesStore
  groundY: (x: number, z: number) => number
}): {
  build(): void
  buildStatic(kind: 'supremacy' | 'assault' | null): void
  clear(): void
  update(clock: number): void
  reground(): void
} {
const BASE_TEX = 256;
const baseColors: BaseColors = {
  friendly: PLAYBACK_ROLES.friendly.base,
  enemy: PLAYBACK_ROLES.enemy.base,
  neutral: PLAYBACK_ROLES.neutral.base,
  objective: PLAYBACK_ROLES.objective.base,
};
let baseObjects: BaseMarkerObject[] = [];
let supremacyBaseIds: string[] = [];
let lastBaseViewsKey = '';

const ASSAULT_RADIUS_FALLBACK = 20;
function assaultHasObjective(): boolean {
  if (getData().assault_objective_present === true) return true;
  if (getData().assault_objective_present === undefined) {
    return !!(getData().assault_bases?.length);
  }
  return false;
}

function clearBases() {
  staticKind = null;
  for (const b of baseObjects) {
    getScene().remove(b.ring); b.ring.geometry.dispose(); (b.ring.material as THREE.Material).dispose();
    getScene().remove(b.disc); b.disc.geometry.dispose(); (b.disc.material as THREE.Material).dispose(); b.tex.dispose();
  }
  baseObjects = [];
  supremacyBaseIds = [];
  lastBaseViewsKey = '';
  store.baseViews = [];
}

function addBaseMarker(baseId: string, kind: 'supremacy' | 'assault', gx: number, gz: number, r: number): void {
  const ring = new THREE.Mesh(
    makeGroundedRing(groundY, gx, gz, r),
    new THREE.MeshBasicMaterial({ color: baseColors.neutral, side: THREE.DoubleSide,
                                  transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  getScene().add(ring);
  const canvas = document.createElement('canvas'); canvas.width = BASE_TEX; canvas.height = BASE_TEX;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const disc = new THREE.Mesh(
    makeGroundedDisc(groundY, gx, gz, r * 0.9),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false,
                                  toneMapped: false,
                                  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  getScene().add(disc);
  const b: BaseMarkerObject = { baseId, kind, gx, gz, r, ring, disc, canvas, ctx: canvas.getContext('2d')!, tex,
              stateKey: undefined, uvDir: null, ringHex: null,
              reground: () => {
                ring.geometry.dispose(); ring.geometry = makeGroundedRing(groundY, gx, gz, r);
                disc.geometry.dispose(); disc.geometry = makeGroundedDisc(groundY, gx, gz, r * 0.9);
                b.uvDir = null;
              } };
  baseObjects.push(b);
}

function buildBases() {
  clearBases();
  const tracks = getData().supremacy_bases || [];
  if (tracks.length) {
    const seen = new Set(tracks.map((tr) => SUPREMACY_BASE_IDS[tr.base_id]).filter(Boolean));
    const pts = getMapBases()?.supremacy ?? [];
    for (const p of pts) {
      const id = p.baseId;
      if (!id || !SUPREMACY_BASE_IDS.includes(id)) continue;
      seen.add(id);
      addBaseMarker(id, 'supremacy', -p.x, p.y, p.radius || 15);
    }
    supremacyBaseIds = SUPREMACY_BASE_IDS.filter((id) => seen.has(id));
  }
  if (assaultHasObjective()) {
    const pts = getMapBases()?.assault ?? [];
    if (pts.length === 1) addBaseMarker(ASSAULT_BASE_ID, 'assault', -pts[0].x, pts[0].y, pts[0].radius || ASSAULT_RADIUS_FALLBACK);
  }
}

let staticKind: 'supremacy' | 'assault' | null = null;

function buildStatic(kind: 'supremacy' | 'assault' | null): void {
  clearBases();
  staticKind = (kind === 'supremacy' || kind === 'assault') ? kind : null;
  if (!staticKind) return;
  const pts = getMapBases()?.[staticKind] ?? [];
  if (staticKind === 'supremacy') {
    for (const p of pts) {
      const id = p.baseId;
      if (!id || !SUPREMACY_BASE_IDS.includes(id)) continue;
      addBaseMarker(id, 'supremacy', -p.x, p.y, p.radius || 15);
    }
    return;
  }
  if (pts.length === 1) addBaseMarker(ASSAULT_BASE_ID, 'assault', -pts[0].x, pts[0].y, pts[0].radius || ASSAULT_RADIUS_FALLBACK);
}

function regroundBases() {
  for (const b of baseObjects) b.reground();
}

function baseViewsAt(t: number): BaseView[] {
  if (staticKind) {
    return baseObjects.map((b) => ({ baseId: b.baseId, kind: b.kind, owner: 'neutral', capturing: null, progress: null }));
  }
  const ft = getData().meta.friendly_team;
  const views: BaseView[] = [];
  if (supremacyBaseIds.length) {
    for (const state of foldSupremacyTransitions(getData().supremacy_bases, t)) {
      if (supremacyBaseIds.includes(state.baseId)) views.push(baseView(state, ft));
    }
  }
  if (assaultHasObjective()) views.push(baseView(foldAssaultProgress(getData().assault_bases, t), ft));
  return views;
}

function drawBaseDecal(b: BaseMarkerObject, view: BaseView): void {
  const ctx = b.ctx, S = BASE_TEX, c = S / 2, R = S / 2 - 2;
  const owner = baseColors[view.owner as BaseSide];
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
  ctx.globalAlpha = 0.2; ctx.fillStyle = owner; ctx.fillRect(0, 0, S, S);
  const fillColor = view.kind === 'assault' ? baseColors.objective : (view.capturing ? baseColors[view.capturing as BaseSide] : null);
  if (fillColor && view.progress != null) {
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
    ctx.beginPath(); ctx.moveTo(c - 26, c + 54); ctx.lineTo(c - 26, c - 54);
    ctx.lineTo(c + 42, c - 30); ctx.lineTo(c - 26, c - 6);
    ctx.stroke(); ctx.strokeStyle = baseColors.neutral; ctx.lineWidth = 8; ctx.stroke();
  }
  b.tex.needsUpdate = true;
}

function updateBases(clock: number): void {
  if (!getData()) return;
  const views = baseViewsAt(clock);
  const key = views.map((v) => v.baseId + ':' + v.owner + '/' + v.capturing + '/' + v.progress).join('|');
  if (key !== lastBaseViewsKey) { lastBaseViewsKey = key; store.baseViews = views; }
  for (const b of baseObjects) {
    const view = views.find((v) => v.baseId === b.baseId);
    if (!view) continue;
    const stateKey = view.owner + '/' + view.capturing + '/' + view.progress;
    if (b.stateKey !== stateKey) { b.stateKey = stateKey; drawBaseDecal(b, view); }
    const ringHex = baseColors[view.owner as BaseSide];
    if (b.ringHex !== ringHex) { (b.ring.material as THREE.MeshBasicMaterial).color.set(ringHex); b.ringHex = ringHex; }
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

function orientDisc(geo: THREE.BufferGeometry, ux: number, uz: number): void {
  orientDiscUv(geo.userData.offsets, geo.attributes.uv.array, ux, uz);
  geo.attributes.uv.needsUpdate = true;
}
  return {
    build: buildBases,
    buildStatic,
    clear: clearBases,
    update: updateBases,
    reground: regroundBases,
  };
}

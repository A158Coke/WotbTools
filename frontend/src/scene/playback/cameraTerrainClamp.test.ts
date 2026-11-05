// cameraTerrainClamp 单测（#820 Wave B6A）：真实 THREE.Vector3，假 camera/controls。
// 断言的是出仓前 playbackScene.js 的既有语义（净空回退顺序、24 轮重采样、minDistance
// 锁定/释放、target 钳制框），不重复播放场景的装配。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createCameraTerrainClamp,
  type CameraLike,
  type CameraTerrainClampDeps,
  type OrbitControlsLike,
} from './cameraTerrainClamp.js'

function makeCamera(x: number, y: number, z: number): CameraLike {
  return { position: new THREE.Vector3(x, y, z), lookAt() {} };
}

function makeControls(target = new THREE.Vector3(0, 0, 0)): OrbitControlsLike {
  return { target, minDistance: 20, maxDistance: 1000 };
}

interface Harness {
  camera: CameraLike
  controls: OrbitControlsLike
  deps: CameraTerrainClampDeps
}

function makeHarness(opts: {
  camera?: CameraLike
  controls?: OrbitControlsLike
  heightField?: unknown | null
  heightMeta?: { size: number; span: number } | null
  rendered?: (x: number, z: number) => number | null
  height?: (x: number, z: number) => number
  terrainMesh?: unknown | null
  cameraDriven?: boolean
  following?: boolean
  worldCenter?: { cx: number; cz: number; ext: number }
} = {}): Harness {
  const camera = opts.camera ?? makeCamera(10, 10, 0)
  const controls = opts.controls ?? makeControls()
  const deps: CameraTerrainClampDeps = {
    getCamera: () => camera,
    getControls: () => controls,
    cameraDriven: () => opts.cameraDriven ?? false,
    getTerrainMesh: () => ('terrainMesh' in opts ? opts.terrainMesh ?? null : null),
    getHeightField: () => ('heightField' in opts ? opts.heightField ?? null : { filled: true }),
    getHeightMeta: () => ('heightMeta' in opts ? opts.heightMeta ?? null : { size: 4, span: 1000 }),
    sampleRenderedTerrainHeight: opts.rendered ?? (() => null),
    sampleHeight: opts.height ?? (() => 0),
    clearance: 0.5,
    getWorldCenter: () => opts.worldCenter ?? { cx: 0, cz: 0, ext: 300 },
    isFollowing: () => opts.following ?? false,
  };
  return { camera, controls, deps };
}

describe('applyCameraClamp', () => {
  it('min/max 距离由世界范围决定，下限 20 m', () => {
    const { controls, deps } = makeHarness();
    const clamp = createCameraTerrainClamp(deps);

    clamp.applyCameraClamp(300);
    expect(clamp.baseMinDistance()).toBe(24);       // max(20, 300 × 0.08)
    expect(controls.minDistance).toBe(24);
    expect(controls.maxDistance).toBeCloseTo(660, 9);   // 300 × 2.2

    clamp.applyCameraClamp(100);                    // 8 < 20：取下限
    expect(clamp.baseMinDistance()).toBe(20);
    expect(controls.minDistance).toBe(20);
    expect(controls.maxDistance).toBeCloseTo(220, 9);
  });
});

describe('terrainHeightForCameraClamp', () => {
  it('非有限坐标返回 null（不猜高度）', () => {
    const clamp = createCameraTerrainClamp(makeHarness().deps);
    expect(clamp.terrainHeightForCameraClamp(NaN, 0)).toBeNull();
    expect(clamp.terrainHeightForCameraClamp(0, Infinity)).toBeNull();
  });

  it('渲染网格三角面优先于高度场', () => {
    const clamp = createCameraTerrainClamp(makeHarness({
      terrainMesh: { geometry: {} },
      rendered: () => 42,
      height: () => 7,
    }).deps);
    expect(clamp.terrainHeightForCameraClamp(3, 4)).toBe(42);
  });

  it('无渲染三角面时回退高度场', () => {
    const clamp = createCameraTerrainClamp(makeHarness({
      terrainMesh: { geometry: {} },
      rendered: () => null,
      height: () => 7,
    }).deps);
    expect(clamp.terrainHeightForCameraClamp(3, 4)).toBe(7);
  });

  it('渲染采样非有限值同样回退高度场', () => {
    const clamp = createCameraTerrainClamp(makeHarness({
      terrainMesh: { geometry: {} },
      rendered: () => NaN,
      height: () => 7,
    }).deps);
    expect(clamp.terrainHeightForCameraClamp(3, 4)).toBe(7);
  });

  it('高度场边界外返回 null：不拿 0 制造假净空', () => {
    const clamp = createCameraTerrainClamp(makeHarness({ height: () => 7 }).deps);
    // span 1000 → 半幅 500，右/上边界闭区间外
    expect(clamp.terrainHeightForCameraClamp(499, 0)).toBe(7);
    expect(clamp.terrainHeightForCameraClamp(500, 0)).toBeNull();
    expect(clamp.terrainHeightForCameraClamp(0, -500)).toBe(7);
    expect(clamp.terrainHeightForCameraClamp(0, -500.5)).toBeNull();
  });

  it('无高度场或元数据不完整返回 null', () => {
    const noField = createCameraTerrainClamp(makeHarness({ heightField: null }).deps);
    expect(noField.terrainHeightForCameraClamp(0, 0)).toBeNull();

    const noMeta = createCameraTerrainClamp(makeHarness({ heightMeta: null }).deps);
    expect(noMeta.terrainHeightForCameraClamp(0, 0)).toBeNull();

    const badMeta = createCameraTerrainClamp(makeHarness({ heightMeta: { size: 1, span: 1000 } }).deps);
    expect(badMeta.terrainHeightForCameraClamp(0, 0)).toBeNull();

    const badSpan = createCameraTerrainClamp(makeHarness({ heightMeta: { size: 4, span: 0 } }).deps);
    expect(badSpan.terrainHeightForCameraClamp(0, 0)).toBeNull();
  });
});

describe('clampOrbitCameraToTerrain', () => {
  it('飞行/录像者相机不参与地形钳制', () => {
    const { camera, deps } = makeHarness({ cameraDriven: true, camera: makeCamera(0, -5, 0) });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(false);
    expect(camera.position.y).toBe(-5);
  });

  it('无高度场时 fail-closed（不改相机与距离）', () => {
    const { camera, controls, deps } = makeHarness({ heightField: null, camera: makeCamera(0, -5, 0) });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(false);
    expect(camera.position.y).toBe(-5);
    expect(controls.minDistance).toBe(20);
  });

  it('相机高于净空：只复位 minDistance，不动相机', () => {
    const { camera, controls, deps } = makeHarness();
    const clamp = createCameraTerrainClamp(deps);
    controls.minDistance = 999;                        // 上一帧可能锁过
    expect(clamp.clampOrbitCameraToTerrain()).toBe(false);
    expect(camera.position.toArray()).toEqual([10, 10, 0]);
    expect(controls.minDistance).toBe(20);             // 释放回基准值
  });

  it('沿射线退到安全距离（target 全程不动）', () => {
    // target 在平地，相机在 3 m 高的台地上方 2 m：抬高到净空 3.5 m。
    const { camera, controls, deps } = makeHarness({
      camera: makeCamera(0, 2, 0),
      height: () => 3,
    });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(true);
    expect(camera.position.x).toBe(0);
    expect(camera.position.z).toBe(0);
    expect(camera.position.y).toBeCloseTo(3.5, 6);      // 地形 3 + 净空 0.5
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(controls.minDistance).toBe(20);              // 安全距离 3.5 < 基准 20
  });

  it('坡面穿地：垂直抬到净空并按实际距离锁 minDistance', () => {
    // 斜坡 h = 0.5x，相机在 x=30 高 1 m（地形 15 m）：射线外推会出高度场，
    // 走垂直回退；锁定距离 = |camera - target|。
    const { camera, controls, deps } = makeHarness({
      camera: makeCamera(30, 1, 0),
      height: (x) => x * 0.5,
    });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(true);
    expect(camera.position.y).toBeCloseTo(15.5, 6);
    const dist = Math.hypot(30, 15.5);
    expect(controls.minDistance).toBeCloseTo(dist, 6);
    expect(controls.maxDistance).toBeGreaterThanOrEqual(dist);
  });

  it('安全点超出 maxDistance：改用垂直抬升并放大上限（避免来回振荡）', () => {
    const controls = makeControls();
    controls.maxDistance = 3;
    const { camera, deps } = makeHarness({
      camera: makeCamera(0, 2, 0),
      controls,
      height: () => 3,
    });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(true);
    expect(camera.position.y).toBeCloseTo(3.5, 6);
    expect(controls.maxDistance).toBeGreaterThanOrEqual(controls.minDistance);
  });

  it('相机点无地形数据：复位 minDistance 且不移动相机', () => {
    const { camera, controls, deps } = makeHarness({
      camera: makeCamera(600, -5, 0),                   // 高度场半幅 500 之外
      height: () => 0,
    });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(false);
    expect(camera.position.y).toBe(-5);
    expect(controls.minDistance).toBe(20);
  });

  it('相机与 target 重合：复位 minDistance', () => {
    const controls = makeControls(new THREE.Vector3(1, 2, 3));
    const { deps } = makeHarness({ camera: makeCamera(1, 2, 3), controls });
    const clamp = createCameraTerrainClamp(deps);
    expect(clamp.clampOrbitCameraToTerrain()).toBe(false);
    expect(controls.minDistance).toBe(20);
  });
});

describe('clampCameraTarget', () => {
  it('钳制框 = max(世界范围 × 1.1, 340)', () => {
    const controls = makeControls(new THREE.Vector3(400, 0, -400));
    const { deps } = makeHarness({ controls });
    const clamp = createCameraTerrainClamp(deps);
    clamp.clampCameraTarget();
    expect(controls.target.toArray()).toEqual([340, 0, -340]);
  });

  it('大世界按 ext × 1.1 放宽', () => {
    const controls = makeControls(new THREE.Vector3(1050, 0, -1050));
    const { deps } = makeHarness({ controls, worldCenter: { cx: 0, cz: 0, ext: 1000 } });
    const clamp = createCameraTerrainClamp(deps);
    clamp.clampCameraTarget();
    expect(controls.target.toArray()).toEqual([1050, 0, -1050]);   // 1100 内：不动
  });

  it('钳制框随世界中心平移', () => {
    const controls = makeControls(new THREE.Vector3(0, 0, 0));
    const { deps } = makeHarness({ controls, worldCenter: { cx: 100, cz: -200, ext: 300 } });
    const clamp = createCameraTerrainClamp(deps);
    controls.target.set(-500, 5, 500);
    clamp.clampCameraTarget();
    expect(controls.target.toArray()).toEqual([-240, 5, 140]);       // 100−340 / −200+340
  });

  it('跟随中 target 钉在坦克上：不钳制', () => {
    const controls = makeControls(new THREE.Vector3(1000, 0, 1000));
    const { deps } = makeHarness({ controls, following: true });
    const clamp = createCameraTerrainClamp(deps);
    clamp.clampCameraTarget();
    expect(controls.target.toArray()).toEqual([1000, 0, 1000]);
  });
});
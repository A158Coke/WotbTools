// treadBufferWriter 单测（#820 Wave B4A）：真实 THREE.BufferGeometry/BufferAttribute，
// 复刻 ensureTreadMesh 的槽位布局契约（position 4v×3、color 4v×4、交错槽、drawRange = slots×6）。
// 领域事实由 treadMarks.advanceTrail 生成——本文件不重复路径算法，只验证"TrailState → Buffer"投影。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { advanceTrail, createTrailState, treadAlphaAt, TREAD_FADE, type TrailSample, type TrailState } from '../treadMarks.js'
import { ageTreadBuffer, writeTreadBuffer, type TreadBufferInput } from './treadBufferWriter.js'

/** 与 ensureTreadMesh 同构的动态合并几何（槽位布局契约的测试侧真值）。 */
function makeGeometry(slots: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(slots * 4 * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  const uvArr = new Float32Array(slots * 4 * 2);
  for (let s = 0; s < slots; s++) uvArr.set([0, 0, 1, 0, 1, 1, 0, 1], s * 8);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  const col = new THREE.BufferAttribute(new Float32Array(slots * 4 * 4), 4);
  col.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('color', col);
  const idx = new Uint32Array(slots * 6);
  for (let s = 0; s < slots; s++) {
    const b = s * 4, o = s * 6;
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  return geo;
}

function makeInput(geo: THREE.BufferGeometry, trail: { L: TrailState; R: TrailState }, opts: {
  cap?: number; now?: number; width?: number; texScale?: number; heightAt?: (x: number, z: number) => number;
} = {}): TreadBufferInput {
  const cap = opts.cap ?? 50;
  return {
    geometry: geo,
    trail,
    width: opts.width ?? 0.9,
    texScale: opts.texScale ?? 1,
    now: opts.now ?? 1,
    heightAt: opts.heightAt ?? (() => 0),
    cap,
    slots: cap * 2,
  };
}

/** 场景同构泵：把样本喂给单侧路径态（treadMarks 生成路径事实）。 */
function feed(st: TrailState, pts: TrailSample[], space = 1, cap = 50): void {
  advanceTrail(st, pts, space, cap);
}

/** 沿 +x 匀速直线样本：从 x0 起每步 step 米、间隔 dt 秒。 */
function linePts(x0: number, n: number, step: number, dt: number, t0 = 0): TrailSample[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, z: 0, t: t0 + i * dt, yaw: 0 }));
}

/** 幂等泵：写 + 老化，返回true时按场景门控置 needsUpdate（version 因此递增）。 */
function pump(input: TreadBufferInput): { wrote: boolean; aged: boolean } {
  const wrote = writeTreadBuffer(input);
  const aged = ageTreadBuffer(input);
  if (wrote) { input.geometry.getAttribute('position').needsUpdate = true; input.geometry.getAttribute('color').needsUpdate = true; }
  if (aged) input.geometry.getAttribute('color').needsUpdate = true;
  return { wrote, aged };
}

describe('treadBufferWriter：槽位布局', () => {
  it('左右交错槽：L 占偶数槽（2k）、R 占奇数槽（2k+1），两侧各写各的', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 3, 1, 0.5));   // 2 枚 committed（0→1→2，space=1）
    feed(R, [{ x: 5, z: 0, t: 0, yaw: 0 }, ...linePts(5, 3, 1, 0.5).slice(1)]);
    const input = makeInput(geo, { L, R }, { cap: 3 });
    pump(input);
    const pos = geo.getAttribute('position').array as Float32Array;
    const col = geo.getAttribute('color').array as Float32Array;
    // L 第 0 枚戳在槽 0（pos 偏移 0），x 从 0 起步（宽度 0.9，横向 ±0.45）
    expect(pos[0]).toBeCloseTo(0.45, 5);             // 角0 = x0 - rx·hw（yaw=0 ⇒ rx=-1 ⇒ +0.45）
    expect(pos[1]).toBeCloseTo(0.12, 5);                       // TRAIL_LIFT（heightAt=0）
    expect(pos[3]).toBeCloseTo(-0.45, 5);            // 角1（R0）
    // R 第 0 枚戳在槽 1（pos 偏移 12），x 从 5 起步
    expect(pos[12]).toBeCloseTo(5.45, 5);
    expect(pos[12 + 3]).toBeCloseTo(5 - 0.45, 5);
    // R 的槽 0 同样可见（交错：两槽各自独立，颜色偏移差 16）
    expect(col[16 + 3]).toBeGreaterThan(0);
    // L 的槽 1（committed #2）可见，R 槽 1 可见
    expect(col[32 + 3]).toBeGreaterThan(0);
    expect(col[32 + 16 + 3]).toBeGreaterThan(0);
    expect(geo.drawRange.count).toBe(6 * 6);         // slots × 6
  });

  it('committed 与 active ownership：未激活 active（open=null）不占 write 槽，最老 committed 继续显示', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    // 环满（cap=3，total=3），open=null（新锚未激活）——write 槽 0 仍显示最老 committed
    feed(L, linePts(0, 4, 1, 0.5));
    expect(L.total).toBe(3);
    expect(L.open).toBeNull();
    const input = makeInput(geo, { L, R }, { cap: 3, now: 0.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    // 槽 0 = 最老 committed（x0=0），仍可见
    expect(col[3]).toBeGreaterThan(0);
    expect(pos[0]).toBeCloseTo(0.45, 5);
    // 老化也不清它（openActive=false ⇒ 活戳槽老化照旧按 committed 计算）
    const aged = ageTreadBuffer({ ...input, now: 3 });
    expect(aged).toBe(true);
    expect(col[3]).toBeGreaterThan(0);
  });

  it('环满回压：total=cap+2 时覆写槽 0/1，可见槽仍是 cap 个且不生成第 cap+1 槽', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 6, 1, 0.5), 1, cap);          // total=5，segs 环覆写槽 0/1
    expect(L.total).toBe(5);
    const input = makeInput(geo, { L, R }, { cap, now: 2.5 });   // now ≥ 全部戳 t（负年龄会被隐藏）
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    // 5 枚戳只占 3 槽：槽 0/1 = 最新的两枚（x0=3/4），槽 2 = 中间戳
    expect(pos[0]).toBeCloseTo(3.45, 5);
    expect(pos[24]).toBeCloseTo(4.45, 5);
    expect(pos[48]).toBeCloseTo(2.45, 5);
    // 活戳槽（total % cap = 2）此时 open=null 且环已满 ⇒ 保持 committed（上面槽 2）
    for (let s = 0; s < cap; s++) expect(col[s * 32 + 3]).toBeGreaterThan(0);
    // drawRange 恒为全槽位，与 total 无关
    expect(geo.drawRange.count).toBe(cap * 2 * 6);
  });

  it('已激活 active 的槽位切换：write 槽显示权切给活戳，被顶掉的最老 committed 隐藏', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5), 1, cap);          // total=3 环满
    // 激活：锚点(3,0) 位移 ≥0.3 的活戳末端
    advanceTrail(L, [{ x: 3.5, z: 0, t: 2, yaw: 0 }], 1, cap);
    expect(L.open).not.toBeNull();
    const input = makeInput(geo, { L, R }, { cap, now: 2 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    // write 槽 0 = 活戳：x0 = 3（锚点），可见
    expect(pos[0]).toBeCloseTo(3.45, 5);
    expect(col[3]).toBeGreaterThan(0);
    // 提交循环跳过 write 槽：被顶掉的最老 committed（x0=0）不再出现在槽 0
    expect(pos[0]).not.toBeCloseTo(0.45, 5);
  });

  it('null/空槽显式隐藏：环内残留旧戳的槽被清零（alpha 0），且未激活活戳槽也清零', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    // 先灌满再复位路径态但保留环：手工制造"环内 total < cap"的残留
    feed(L, linePts(0, 4, 1, 0.5), 1, cap);
    feed(L, [{ x: 100, z: 0, t: 99, yaw: 0 }], 1, cap); // 断链新锚（保留历史）
    L.total = 1;                                        // 模拟 total 回退：槽 1/2 是残留
    L.written = 0;
    feed(L, [{ x: 100.5, z: 0, t: 99.5, yaw: 0 }], 1, cap);
    const input = makeInput(geo, { L, R }, { cap, now: 99.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    // total=2：槽 0/1 重写可见，槽 2 残留必须隐藏
    expect(col[0 * 32 + 3]).toBeGreaterThan(0);
    expect(col[1 * 32 + 3]).toBeGreaterThan(0);
    expect(col[2 * 32 + 3]).toBe(0);
    // R 全空：所有槽隐藏
    for (let s = 0; s < cap; s++) expect(col[s * 32 + 16 + 3]).toBe(0);
  });

  it('Float32 量化：存储的 alpha === Math.fround(treadAlphaAt · texScale)，且严格等于 f32 值', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 3, 1, 0.5));
    const texScale = 1.1;
    const input = makeInput(geo, { L, R }, { cap: 3, now: 0.5, texScale });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const t = L.segs[0].t;
    const expected = Math.fround(treadAlphaAt(0.5 - t, TREAD_FADE) * texScale);
    // 选一个 double ≠ f32 的样本，验证量化真的发生（否则此断言空洞）
    expect(expected).not.toBe(treadAlphaAt(0.5 - t, TREAD_FADE) * texScale);
    expect(col[3]).toBe(expected);
  });
});

describe('treadBufferWriter：上传门控与老化', () => {
  it('静止 + 时钟不动：重复泵零变化（write/age 返回 false，needsUpdate 不再置位）', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 3, 1, 0.5));
    const input = makeInput(geo, { L, R }, { cap: 3, now: 0.5 });
    expect(pump(input).wrote).toBe(true);
    const vPos = (geo.getAttribute('position') as THREE.BufferAttribute).version;
    const vCol = (geo.getAttribute('color') as THREE.BufferAttribute).version;
    // 第二帧：完全相同输入 → 无变化、无上传
    const r2 = pump(input);
    expect(r2.wrote).toBe(false);
    expect(r2.aged).toBe(false);
    expect((geo.getAttribute('position') as THREE.BufferAttribute).version).toBe(vPos);
    expect((geo.getAttribute('color') as THREE.BufferAttribute).version).toBe(vCol);
  });

  it('时间推进只老化 alpha（color 脏、position 不脏），逐槽独立按各自出生时刻计算', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5));   // 3 枚 committed
    const input = makeInput(geo, { L, R }, { cap: 3, now: 0.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const vPos = (geo.getAttribute('position') as THREE.BufferAttribute).version;
    const a0 = col[3], a2 = col[64 + 3];
    const r = pump({ ...input, now: 6 });
    expect(r.aged).toBe(true);
    expect((geo.getAttribute('position') as THREE.BufferAttribute).version).toBe(vPos);   // position 未动
    expect(col[3]).toBe(Math.fround(treadAlphaAt(6 - L.segs[0].t, TREAD_FADE)));
    expect(col[64 + 3]).toBe(Math.fround(treadAlphaAt(6 - L.segs[2].t, TREAD_FADE)));
    expect(col[3]).not.toBe(a2);   // 各槽 alpha 不同 = 独立老化（非按 k 单调假设）
    expect(a0).not.toBe(col[3]);
  });

  it('正反向轨迹：倒车产生的戳四角依旧贴地且位置正确（角序跟朝向走）', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    // 前进 1m 再倒车 1m（yaw=0 恒定，x 先增后减）
    feed(L, linePts(0, 2, 1, 0.5));
    feed(L, linePts(1, 2, -1, 0.5, 1).slice(1));
    const heightAt = (x: number) => x * 0.5;   // 斜坡：四角各自独立采样
    const input = makeInput(geo, { L, R }, { cap: 3, now: 1, heightAt });
    pump(input);
    const pos = geo.getAttribute('position').array as Float32Array;
    // 第二枚戳 x0=1,x1=0（倒车）：槽 1 的四角 y = heightAt(x) + 0.12，逐角不同
    // 角 x（yaw=0）：[x0+hw, x0-hw, x1-hw, x1+hw] = [1.45, 0.55, -0.45, 0.45]
    const y = (i: number) => pos[24 + i * 3 + 1];
    const cx = [1.45, 0.55, -0.45, 0.45];
    for (let i = 0; i < 4; i++) expect(y(i)).toBeCloseTo(heightAt(cx[i]) + 0.12, 5);
    expect(y(0)).not.toBe(y(2));   // 坡上四角异高 = 逐角采样
  });
});

// ---------- Negative controls（守卫：回归到已知 bug 形态时必须失败） ----------

describe('negative controls', () => {
  it('NC1 去掉 fround 量化 → 静止重复泵会误报变化并重传（本测试失败）', () => {
    // 活戳角坐标含 f32 不可精确表示值：无 fround 门控时 double≠f32 逐帧判 changed
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, [{ x: 0.1, z: 0, t: 0, yaw: 0 }, { x: 0.1 + 0.2, z: 0.3, t: 0.5, yaw: 0.123 }, { x: 0.7, z: 0.6, t: 1, yaw: 0.123 }]);
    expect(L.open).not.toBeNull();   // 活戳激活，走 fround 变化检测路径
    const input = makeInput(geo, { L, R }, { cap: 3, now: 1 });
    pump(input);
    const vPos = (geo.getAttribute('position') as THREE.BufferAttribute).version;
    const r2 = pump(input);
    expect(r2.wrote).toBe(false);
    expect((geo.getAttribute('position') as THREE.BufferAttribute).version).toBe(vPos);
  });

  it('NC2 未激活 active 抢占 write 槽 → 最老 committed 被隐藏（本测试失败）', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5), 1, cap);   // 环满、open=null
    const input = makeInput(geo, { L, R }, { cap, now: 0.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    // write 槽 0 必须仍是最老 committed（x0=0）且可见；实现若在此隐藏/清零即回归七轮 P2
    expect(col[3]).toBeGreaterThan(0);
    expect(pos[0]).toBeCloseTo(0.45, 5);
    // 老化路径同守卫：write 槽 alpha 不得被老化清零
    ageTreadBuffer({ ...input, now: 10 });
    expect(col[3]).toBe(Math.fround(treadAlphaAt(10 - L.segs[0].t, TREAD_FADE)));
  });
});

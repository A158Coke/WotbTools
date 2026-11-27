import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { advanceTrail, createTrailState, treadAlphaAt, TREAD_FADE, type TrailSample, type TrailState } from '../treadMarks.js'
import { ageTreadBuffer, writeTreadBuffer, type TreadBufferInput } from './treadBufferWriter.js'

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

function feed(st: TrailState, pts: TrailSample[], space = 1, cap = 50): void {
  advanceTrail(st, pts, space, cap);
}

function linePts(x0: number, n: number, step: number, dt: number, t0 = 0): TrailSample[] {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, z: 0, t: t0 + i * dt, yaw: 0 }));
}

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
    feed(L, linePts(0, 3, 1, 0.5));
    feed(R, [{ x: 5, z: 0, t: 0, yaw: 0 }, ...linePts(5, 3, 1, 0.5).slice(1)]);
    const input = makeInput(geo, { L, R }, { cap: 3 });
    pump(input);
    const pos = geo.getAttribute('position').array as Float32Array;
    const col = geo.getAttribute('color').array as Float32Array;
    expect(pos[0]).toBeCloseTo(0.45, 5);
    expect(pos[1]).toBeCloseTo(0.12, 5);
    expect(pos[3]).toBeCloseTo(-0.45, 5);
    expect(pos[12]).toBeCloseTo(5.45, 5);
    expect(pos[12 + 3]).toBeCloseTo(5 - 0.45, 5);
    expect(col[16 + 3]).toBeGreaterThan(0);
    expect(col[32 + 3]).toBeGreaterThan(0);
    expect(col[32 + 16 + 3]).toBeGreaterThan(0);
    expect(geo.drawRange.count).toBe(6 * 6);
  });

  it('committed 与 active ownership：未激活 active（open=null）不占 write 槽，最老 committed 继续显示', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5));
    expect(L.total).toBe(3);
    expect(L.open).toBeNull();
    const input = makeInput(geo, { L, R }, { cap: 3, now: 0.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(col[3]).toBeGreaterThan(0);
    expect(pos[0]).toBeCloseTo(0.45, 5);
    const aged = ageTreadBuffer({ ...input, now: 3 });
    expect(aged).toBe(true);
    expect(col[3]).toBeGreaterThan(0);
  });

  it('环满回压：total=cap+2 时覆写槽 0/1，可见槽仍是 cap 个且不生成第 cap+1 槽', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 6, 1, 0.5), 1, cap);
    expect(L.total).toBe(5);
    const input = makeInput(geo, { L, R }, { cap, now: 2.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(pos[0]).toBeCloseTo(3.45, 5);
    expect(pos[24]).toBeCloseTo(4.45, 5);
    expect(pos[48]).toBeCloseTo(2.45, 5);
    for (let s = 0; s < cap; s++) expect(col[s * 32 + 3]).toBeGreaterThan(0);
    expect(geo.drawRange.count).toBe(cap * 2 * 6);
  });

  it('已激活 active 的槽位切换：write 槽显示权切给活戳，被顶掉的最老 committed 隐藏', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5), 1, cap);
    advanceTrail(L, [{ x: 3.5, z: 0, t: 2, yaw: 0 }], 1, cap);
    expect(L.open).not.toBeNull();
    const input = makeInput(geo, { L, R }, { cap, now: 2 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(pos[0]).toBeCloseTo(3.45, 5);
    expect(col[3]).toBeGreaterThan(0);
    expect(pos[0]).not.toBeCloseTo(0.45, 5);
  });

  it('null/空槽显式隐藏：环内残留旧戳的槽被清零（alpha 0），且未激活活戳槽也清零', () => {
    const cap = 3;
    const geo = makeGeometry(cap * 2);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5), 1, cap);
    feed(L, [{ x: 100, z: 0, t: 99, yaw: 0 }], 1, cap);
    L.total = 1;
    L.written = 0;
    feed(L, [{ x: 100.5, z: 0, t: 99.5, yaw: 0 }], 1, cap);
    const input = makeInput(geo, { L, R }, { cap, now: 99.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    expect(col[0 * 32 + 3]).toBeGreaterThan(0);
    expect(col[1 * 32 + 3]).toBeGreaterThan(0);
    expect(col[2 * 32 + 3]).toBe(0);
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
    const r2 = pump(input);
    expect(r2.wrote).toBe(false);
    expect(r2.aged).toBe(false);
    expect((geo.getAttribute('position') as THREE.BufferAttribute).version).toBe(vPos);
    expect((geo.getAttribute('color') as THREE.BufferAttribute).version).toBe(vCol);
  });

  it('时间推进只老化 alpha（color 脏、position 不脏），逐槽独立按各自出生时刻计算', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 4, 1, 0.5));
    const input = makeInput(geo, { L, R }, { cap: 3, now: 0.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const vPos = (geo.getAttribute('position') as THREE.BufferAttribute).version;
    const a0 = col[3], a2 = col[64 + 3];
    const r = pump({ ...input, now: 6 });
    expect(r.aged).toBe(true);
    expect((geo.getAttribute('position') as THREE.BufferAttribute).version).toBe(vPos);
    expect(col[3]).toBe(Math.fround(treadAlphaAt(6 - L.segs[0].t, TREAD_FADE)));
    expect(col[64 + 3]).toBe(Math.fround(treadAlphaAt(6 - L.segs[2].t, TREAD_FADE)));
    expect(col[3]).not.toBe(a2);
    expect(a0).not.toBe(col[3]);
  });

  it('正反向轨迹：倒车产生的戳四角依旧贴地且位置正确（角序跟朝向走）', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, linePts(0, 2, 1, 0.5));
    feed(L, linePts(1, 2, -1, 0.5, 1).slice(1));
    const heightAt = (x: number) => x * 0.5;
    const input = makeInput(geo, { L, R }, { cap: 3, now: 1, heightAt });
    pump(input);
    const pos = geo.getAttribute('position').array as Float32Array;
    const y = (i: number) => pos[24 + i * 3 + 1];
    const cx = [1.45, 0.55, -0.45, 0.45];
    for (let i = 0; i < 4; i++) expect(y(i)).toBeCloseTo(heightAt(cx[i]) + 0.12, 5);
    expect(y(0)).not.toBe(y(2));
  });
});


describe('negative controls', () => {
  it('NC1 去掉 fround 量化 → 静止重复泵会误报变化并重传（本测试失败）', () => {
    const geo = makeGeometry(6);
    const L = createTrailState(), R = createTrailState();
    feed(L, [{ x: 0.1, z: 0, t: 0, yaw: 0 }, { x: 0.1 + 0.2, z: 0.3, t: 0.5, yaw: 0.123 }, { x: 0.7, z: 0.6, t: 1, yaw: 0.123 }]);
    expect(L.open).not.toBeNull();
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
    feed(L, linePts(0, 4, 1, 0.5), 1, cap);
    const input = makeInput(geo, { L, R }, { cap, now: 0.5 });
    pump(input);
    const col = geo.getAttribute('color').array as Float32Array;
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(col[3]).toBeGreaterThan(0);
    expect(pos[0]).toBeCloseTo(0.45, 5);
    ageTreadBuffer({ ...input, now: 10 });
    expect(col[3]).toBe(Math.fround(treadAlphaAt(10 - L.segs[0].t, TREAD_FADE)));
  });
});

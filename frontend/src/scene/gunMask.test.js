import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import {
  gunHasMaskPart,
  gunMaskNodeName,
  gunMaskPlaneWorld,
  gunMaskSliceKey,
} from './gunMask.js'

const record = {
  node: 1,
  position: [0, 1, 0],
  normal: [0, 1, 0],
  axis: [0, 1, 0],
  plane_slice_mode: 1,
  frustum_cone_slice_mode: 0,
  cone_base_radius: 0.2,
  cone_angle_deg: 5,
}

describe('gunMaskSliceKey', () => {
  it('键 = tank_id:turret_local:gun_local（同炮不同炮塔必须区分）', () => {
    expect(gunMaskSliceKey(1, { turret_local: 0, gun_local: 0 })).toBe('1:0:0')
    expect(gunMaskSliceKey(1, { turret_local: 1, gun_local: 0 })).toBe('1:1:0')
  })
  it('缺 id/局部 id → null（不拼半截键）', () => {
    expect(gunMaskSliceKey(null, { turret_local: 0, gun_local: 0 })).toBeNull()
    expect(gunMaskSliceKey(1, null)).toBeNull()
    expect(gunMaskSliceKey(1, { turret_local: 0 })).toBeNull()
  })
})

describe('gunHasMaskPart', () => {
  it('客户端 enabled 记录优先（表里只存 enabled 记录）', () => {
    expect(gunHasMaskPart(record, { gun_mask: null })).toBe(true)
  })
  it('无记录（旧包/预览车）退回标量 gun_mask；0 视同无 mask', () => {
    expect(gunHasMaskPart(null, { gun_mask: 0.84 })).toBe(true)
    expect(gunHasMaskPart(null, { gun_mask: 0 })).toBe(false)
    expect(gunHasMaskPart(null, { gun_mask: null })).toBe(false)
    expect(gunHasMaskPart(null, null)).toBe(false)
  })
})

describe('gunMaskPlaneWorld（客户端 position/normal → 世界系平面）', () => {
  it('单位矩阵：局部系平移到世界系原样', () => {
    const n = new Vector3()
    const p = new Vector3()
    expect(gunMaskPlaneWorld(record, new Matrix4(), n, p)).toBe(true)
    expect([n.x, n.y, n.z]).toEqual([0, 1, 0])
    expect([p.x, p.y, p.z]).toEqual([0, 1, 0])
  })

  it('模型 -90°X 旋转：局部 +Y（炮口）→ 世界 -Z，法线随矩阵变换', () => {
    const m = new Matrix4().makeRotationX(-Math.PI / 2)
    const n = new Vector3()
    const p = new Vector3()
    expect(gunMaskPlaneWorld(record, m, n, p)).toBe(true)
    expect(n.x).toBeCloseTo(0)
    expect(n.y).toBeCloseTo(0)
    expect(n.z).toBeCloseTo(-1)
    // 局部 (0,1,0) 经 -90°X → 世界 (0,0,-1)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0)
    expect(p.z).toBeCloseTo(-1)
  })

  it('planeSliceMode !== 1：客户端不做平面切割 → 不建平面', () => {
    expect(gunMaskPlaneWorld({ ...record, plane_slice_mode: 0 }, new Matrix4(), new Vector3(), new Vector3()))
      .toBe(false)
  })

  it('记录不完整/非法：fail-closed（不猜）', () => {
    expect(gunMaskPlaneWorld(null, new Matrix4(), new Vector3(), new Vector3())).toBe(false)
    expect(gunMaskPlaneWorld({ ...record, position: [0, 1] }, new Matrix4(), new Vector3(), new Vector3()))
      .toBe(false)
    expect(gunMaskPlaneWorld({ ...record, position: [0, NaN, 0] }, new Matrix4(), new Vector3(), new Vector3()))
      .toBe(false)
    expect(gunMaskPlaneWorld({ ...record, normal: [0, 0, 0] }, new Matrix4(), new Vector3(), new Vector3()))
      .toBe(false)
  })
})

describe('gunMaskNodeName', () => {
  it('gun_NN 两位补零', () => {
    expect(gunMaskNodeName({ node: 1 })).toBe('gun_01')
    expect(gunMaskNodeName({ node: 13 })).toBe('gun_13')
  })
  it('非法 node → null', () => {
    expect(gunMaskNodeName(null)).toBeNull()
    expect(gunMaskNodeName({ node: -1 })).toBeNull()
    expect(gunMaskNodeName({ node: 1.5 })).toBeNull()
  })
})

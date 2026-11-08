// 坦克接地阴影「选择 + 句柄生命周期」owner（#907 主干随迁，自 initPlayback 闭包出仓）：
// 画质门禁（shadowQualityEligible）/ store 投影 / 模板缓冲（stencil）申请 /
// startPlayback 装配（buildVehicles 之后）/ 会话 teardown 释放。
// 选择不持久化、无 URL 参数：新实例 / 换文件 / 降档即 OFF（teardown 只释放资源，
// 选择跨 teardown 保留给本次 startPlayback）。逐车挂接与逐帧同步在 vehicleRuntime；
// 地形重建 / 逐图光照同步经宿主 hooks（mapWorld deps）转发到句柄。
import type { DirectionalLight, Scene } from 'three'
import { shadowQualityEligible } from './quality.js'
import { createTankContactShadows } from './tankContactShadows.js'
import type { TankContactShadows } from './tankContactShadows.js'

export interface ContactShadowControlDeps {
  store: { contactShadows: boolean }
  qualityKey(): string
  getScene(): Scene | null
  getSunLight(): DirectionalLight | null
  /** 地表采样口径 = annotation 地表（与阴影贴地同一权威，owner = mapWorld）。 */
  surfaceHeightAt(x: number, z: number): number
  /** 当前渲染器是否带模板缓冲（wantsStencil 定型于 initScene；复用/重建按失配检测）。 */
  stencilAssembled(): boolean
}

export interface ContactShadowControl {
  /** 唯一写入口：门禁不通过时恒 OFF（直接调 API 也不能绕过）。 */
  setEnabled(on: boolean): void
  /** 轮廓投影阴影要模板缓冲；只在阴影有效时申请，关闭路径的渲染上下文与原来一致。 */
  wantsStencil(): boolean
  /** 装配层复核门禁 + 资源创建（startPlayback 编排在 buildVehicles 之后调用）。 */
  setup(): void
  /** 只释放资源；选择跨 teardown 保留。 */
  dispose(): void
  handle(): TankContactShadows | null
  /** ?perf snapshot 消费（null = 未启用）。 */
  count(): number | null
}

export function createContactShadowControl(deps: ContactShadowControlDeps): ContactShadowControl {
  let enabled = false;
  let handle: TankContactShadows | null = null;
  const eligible = () => shadowQualityEligible(deps.qualityKey());
  return {
    setEnabled(on) {
      enabled = !!on && eligible();
      deps.store.contactShadows = enabled;
    },
    wantsStencil: () => enabled && eligible(),
    setup() {
      handle?.dispose();
      handle = null;
      const scene = deps.getScene(), sunLight = deps.getSunLight();
      if (enabled && eligible() && scene && sunLight) {   // 渲染器未就绪 = 不装配（fail-closed）
        handle = createTankContactShadows({
          scene, sunLight,
          heightAt: deps.surfaceHeightAt, silhouettes: deps.stencilAssembled(),
        });
      }
    },
    dispose() {
      handle?.dispose();
      handle = null;
    },
    handle: () => handle,
    count: () => (handle ? handle.count() : null),
  };
}

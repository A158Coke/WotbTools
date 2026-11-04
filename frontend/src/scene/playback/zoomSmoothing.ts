// 滚轮缩放的纯平滑数学：不依赖 Three，scene 负责接线（cameraRig 同款分层）。
//
// #835 用户反馈「鼠标滚轮缩放没有过渡感，观感生硬」：此前两条滚轮路径都是**每事件
// 立即跳一整步**——OrbitControls 的 wheel dolly 在事件处理内直接改球面半径（源码
// _handleMouseWheel → update() 当帧生效，无阻尼），fly 模式的 flyDolly 同样逐事件
// 改视距。一格滚轮 = 一次视距突变。
//
// 本模块把「事件 → 缩放意图」与「逐帧向目标收敛」拆开，两条路径各有一个平滑器：
//   · orbit（top/follow）：wheel 事件把**视距比例**（log 空间）累积进剩余预算；
//   · fly：wheel 事件把**可加世界位移**（旧 flyDolly 语义的一次性位移）累积进预算——
//     fly 的视距在缩放中不变，比例预算不与其旧语义等价（见 createFlyZoomSmoother）；
//   · scene 每帧 advance(dt) 取走剩余预算的固定份额（指数逼近，帧率无关）施加到
//     实际相机上——轨道路径受 min/maxDistance（含地形锁定值）钳制、fly 路径受地形
//     净空钳制，被钳掉的部分自然吸收（与即时缩放同一钳制语义，只是节奏从
//     「一步到位」变成「短窗收敛」），预算不会因钳制漂移。
//
// 不引入输入延迟：首帧立即取走 (1-exp(-dt/tau)) 份预算（约 1-tau 秒内收敛到 0.4%
// 残差），手感是「跟手但带一小段缓动」，不是「先等待后执行」。

/** 剩余缩放预算（log 视距坐标）：>0 拉远 / <0 推近 / 0 已收敛。 */
export interface ZoomSmoother {
  /** 累积一格滚轮的目标视距比例（>1 拉远 / <1 推近；连乘坐标） */
  push(factor: number): void
  /** 推进一帧：返回本帧应施加的视距比例（相对当前视距）；已收敛返回 1 */
  advance(dt: number): number
  /** 是否仍有未收敛的预算（调用方据此继续渲染/推进） */
  active(): boolean
  /** 清空预算（相机模式切换 / 装载新图后调用，防旧目标在新机位上继续生效） */
  reset(): void
}

/** 收敛时间常数（秒）：0.09 → 12% 的事件约 0.4s 收敛到 0.4% 残差。 */
export const ZOOM_SMOOTH_TAU_SEC = 0.09
/** 残差低于该 log 值（≈0.4% 视距）即整段收敛，不再拖尾。 */
export const ZOOM_SETTLE_LOG_EPS = 0.004
/** fly 路径的单事件步长界限（既有实现：clamp(Δ×0.0012, ±0.3)，即比例 0.7–1.3）。 */
const FLY_EVENT_FACTOR_MAX = 0.3
const FLY_EVENT_DELTA_SCALE = 0.0012

/** 单事件比例换算成 log 预算：非有限 / 非正比例按无缩放处理
 *  （fail-closed：脏输入不得制造 NaN/无穷预算；幅度本身不做二次钳制——
 *  各路径的事件级界限由 wheelFactor 公式承担，钳制语义归 scene 的视距/净空钳制）。 */
function toLogBudget(factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return 0
  return Math.log(factor)
}

/** 创建剩余预算式平滑器（scene 侧每帧 advance 一次；事件侧只 push）。 */
export function createZoomSmoother(tau = ZOOM_SMOOTH_TAU_SEC): ZoomSmoother {
  let remaining = 0
  return {
    push(factor) {
      remaining += toLogBudget(factor)
    },
    advance(dt) {
      if (remaining === 0) return 1
      if (Math.abs(remaining) <= ZOOM_SETTLE_LOG_EPS) {
        const settled = Math.exp(remaining)
        remaining = 0   // 尾段残差（≤0.4% 视距）整段应用并收掉：不拖尾，也不丢终点
        return settled
      }
      // 剩余预算的固定比例本帧释放（指数逼近，帧率无关：dt 大到 tau 量级即一步到位）
      const take = remaining * (1 - Math.exp(-Math.max(0, dt) / tau))
      remaining -= take
      return Math.exp(take)
    },
    active() { return remaining !== 0 },
    reset() { remaining = 0 },
  }
}

/**
 * fly（自由飞行）滚轮事件 → **视距比例**。与既有即时实现逐值一致：
 * 旧 onFlyCaptureWheel 的步长公式为 `f_step = clamp(-deltaY*0.0012, ±0.3)`、
 * `flyDolly(dist * f_step)`（step>0 沿视线前进 = 视距收缩），即每格滚轮把当前视距
 * 乘以 `1 − f_step = 1 + clamp(deltaY*0.0012, ±0.3)`。本函数返回的就是这个比例：
 * 连滚 k 格的总视距变化与旧实现逐值相等（旧实现本来就是逐格乘上当前视距）。
 * >1 拉远 / <1 推近；对 |deltaY| 加法对称（1.12 与 0.88 非互逆——原公式语义如此）。
 */
export function flyWheelFactor(deltaY: number): number {
  const step = Math.max(-FLY_EVENT_FACTOR_MAX, Math.min(FLY_EVENT_FACTOR_MAX, deltaY * FLY_EVENT_DELTA_SCALE))
  return 1 + step
}

/**
 * fly 收敛残差的整段应用阈值（世界单位）：低于该值一次付清，不拖尾。
 */
export const FLY_SETTLE_EPS = 0.01

/** fly 路径平滑器的帧步：返回本帧应施加的**世界位移**（>0 沿视线前进）。 */
export interface FlyZoomSmoother {
  /** 累积一段可加的世界空间位移（与旧即时实现的事件级位移同单位） */
  pushDisplacement(amount: number): void
  /** 推进一帧：返回本帧应施加的世界位移；已收敛返回 0 */
  advance(dt: number): number
  /** 是否仍有未收敛的预算 */
  active(): boolean
  /** 清空预算 */
  reset(): void
}

/**
 * fly（自由飞行）路径的**可加世界位移预算**平滑器。与比例版（createZoomSmoother）
 * 的关键差异：旧 fly 语义是「事件时刻按当前视距算出一段可加位移，flyDolly 同步平移
 * camera 与 target，视距本身不变」——逐帧释放 `dist × (1−f)` 类比例步长不与旧语义
 * 等价（比例乘在不变的 dist 上，各帧份额相加不等于一次性的 dist×step，且随帧率漂移）。
 * 本平滑器直接以世界位移为预算单位：事件侧 push 旧公式的一次性位移
 * （`dist × (1 − flyWheelFactor(deltaY))`），逐帧指数逼近地取走，**各帧取走量之和
 * 恒等于预算总量**——平滑只改变时间分布，终点位移与旧即时实现逐值一致，且与帧率无关。
 */
export function createFlyZoomSmoother(tau = ZOOM_SMOOTH_TAU_SEC): FlyZoomSmoother {
  let remaining = 0
  return {
    pushDisplacement(amount) {
      if (!Number.isFinite(amount)) return   // fail-closed：脏输入不制造 NaN 预算
      remaining += amount
    },
    advance(dt) {
      if (remaining === 0) return 0
      if (Math.abs(remaining) <= FLY_SETTLE_EPS) {
        const settled = remaining
        remaining = 0   // 尾段残差整段付清：不拖尾，也不丢终点
        return settled
      }
      const take = remaining * (1 - Math.exp(-Math.max(0, dt) / tau))
      remaining -= take
      return take
    },
    active() { return remaining !== 0 },
    reset() { remaining = 0 },
  }
}

/**
 * 轨道（top/follow，OrbitControls 路径）滚轮事件 → 视距比例。公式与 three
 * OrbitControls._getZoomScale / _handleMouseWheel 逐值同构（pow(0.95, zoomSpeed·|deltaY|·0.01)，
 * deltaY>0 = dollyOut = 比例 >1 拉远）：被拦截的滚轮与 OrbitControls 直收滚轮的
 * 单事件幅度完全相同，拦截只是把「当帧生效」换成「平滑收敛」。
 */
export function orbitWheelFactor(deltaY: number, zoomSpeed = 1): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1
  const scale = Math.pow(0.95, Math.max(0, zoomSpeed) * Math.abs(deltaY) * 0.01)
  return deltaY > 0 ? 1 / scale : scale
}

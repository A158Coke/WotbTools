// 3D 装甲检视器：viewer.rs 嵌入 INDEX_HTML 的模块脚本整体抽取平移（含另一会话新增的
// 配件自动判定逻辑），除包一层 initTankViewer() 外一行未改。
// 数据面（WotBTools 增量）：tank 数据/名册/弹表/GLB/封面/射击数据经 agentData.ts
// 资产面优先 + /api 回退；击穿判定为 penetration.js 客户端移植（上游 Rust 单测同源）。
// /api/hold、/api/ready 保留（Agent 自托管无头截图链专用，静态面缺席时静默无操作）。
// 初始车辆/射手经 options.initialTankId / initialShooterId 显式传入（ArmorView 从路由
// 参数解析后注入；2026-10-24 起替代 window.__INITIAL_TANK__ / __INITIAL_SHOOTER__ 全局）。
// 加载状态（审计 3D-23）：options.onLoadState 收到 { state: 'loading'|'ready'|'error', progress, message }，
// 宿主页据此显示进度条 / 失败重试；返回的 retry() 重新加载当前目标坦克。
// 生命周期：返回 { destroy, retry, selectTank, canPick }——SPA 路由离开时必须调用（ArmorView onBeforeUnmount）：
// 取消 rAF 循环、摘除 window 监听器、释放 WebGL 上下文；不调用则多次进出路由会
// 耗尽浏览器 WebGL 上下文上限（~16 个）出现"context lost"黑屏。selectTank/canPick 供宿主页的
// 共享选车菜单（TankCatalogMenu）加载射手/目标；名册与当前选择经 onTankList/onTankSelection 回调。
/**
 * 拆分模块共享的宿主对象类型（迁移期声明：宿主字段由各 owner 模块安装，逐字段类型化随迁移推进）。
 * @typedef {Record<string, any>} Host
 */
export { dollyZoomFov, mirrorShotData } from './viewer/viewerMath.js'
import { createTankHost } from './tankViewer/sceneHost.js'
import { bindTankStatus, initTankStatus } from './tankViewer/tankStatus.js'
import { bindTankScene, initTankScene } from './tankViewer/tankScene.js'
import { bindTankArmor, initTankArmor } from './tankViewer/tankArmor.js'
import { bindTankTransport, initTankTransport } from './tankViewer/tankTransport.js'
import { bindTankShell, initTankShell } from './tankViewer/tankRuntime.js'
import { bindTankShotCheck, initTankShotCheck } from './tankViewer/tankLoop.js'
import { createTankApi } from './tankViewer/tankApi.js'

/**
 * @param {object} [options]
 * @param {object} [options.labels] 界面文案（审计 3D-16：由宿主页按当前语言提供；缺省为英文原文）
 * @param {(state: { state: string, progress?: number | null, message?: string }) => void} [options.onLoadState]
 * @param {(list: Array) => void} [options.onTankList] 名册视图模型（normalizeTankCache）就绪
 * @param {(selection: { shooter: number|null, target: number|null }) => void} [options.onTankSelection] 当前射手/目标变化
 * @param {(index: number) => void} [options.onConfigSelection] 原生配置下拉切换目标配置（宿主写回 URL）
 * @param {(index: number) => void} [options.onShellSelection] 原生弹种下拉切换（宿主写回 URL）
 * @param {(kind: 'calibrated'|'enhanced', value: boolean) => void} [options.onEquipmentSelection] 原生装备勾选切换（宿主写回 URL）
 */
export function initTankViewer({
    labels = {},
    onLoadState = null,
    onTankList = null,
    onTankSelection = null,
    onConfigSelection = null,
    onShellSelection = null,
    onEquipmentSelection = null,
    onDistanceChange = null,
    initialTankId = null,
    initialShooterId = null,
    pitchDeviceBonus = null,
    pitchDeviceAvailable = false,
} = {}) {
    const S = createTankHost({
        labels,
        onLoadState,
        onTankList,
        onTankSelection,
        onConfigSelection,
        onShellSelection,
        onEquipmentSelection,
        onDistanceChange,
        initialTankId,
        initialShooterId,
        pitchDeviceBonus,
        pitchDeviceAvailable,
    })
    // 绑定阶段只安装函数引用（闭包内声明已提升），不执行任何构造；这样场景装配可以先拿到
    // 后续 owner 的函数（厚度取色/URL 选项），构造顺序与原闭包提升语义一致。
    bindTankStatus(S)
    bindTankScene(S)
    bindTankArmor(S)
    bindTankTransport(S)
    bindTankShell(S)
    bindTankShotCheck(S)
    // 初始化阶段按拆分前的源码顺序执行各自的顶层语句。
    initTankStatus(S)
    initTankScene(S)
    initTankArmor(S)
    initTankTransport(S)
    initTankShell(S)
    initTankShotCheck(S)
    return createTankApi(S)
}

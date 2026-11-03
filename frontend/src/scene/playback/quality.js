// 四档渲染预设，面板与场景共用。
import { FX_BUDGETS } from '../battleFx.js'

// 四档渲染预设（面板与场景共用；桌面默认高清，Tauri/移动 WebView 默认均衡）。
// 抗锯齿/DPR/场景资源在渲染器与场景首次创建时一次性定型，加载后改档需整页刷新。
// 四档共享完整场景与分层地面；画质差异由抗锯齿、DPR、车辆与特效预算控制。
// 相邻档的差异包括流畅→均衡启用真实车模，高清/极致启用履带印。
// treadMarks / forceGlb（2026-10-11 用户裁示）：履带印只在高清/极致提供，且这两档
// **强制** GLB 真实车模——印记的左右轨距取自 suspension 解析的模型实测 halfW，
// 低模回落常数与之不同，允许中途切车模会让同一车前后的印记轨距突变。
// fx（2026-10-13）：3D 战斗特效预算（粒子批次容量与各元素数量），数值表在 battleFx.js 的 FX_BUDGETS；
// 信息类特效（曳光、光迹、命中火光、爆炸闪光）四档都有，氛围特效按档裁剪。
export const QUALITY_PRESETS = {
  low:   { label: '流畅', antialias: false, maxDpr: 1,    anisotropy: 1, terrainSeg: 192, allowGlb: false, treadMarks: false, forceGlb: false, fx: FX_BUDGETS.low },
  mid:   { label: '均衡', antialias: true,  maxDpr: 1.25, anisotropy: 2, terrainSeg: 256, allowGlb: true,  treadMarks: false, forceGlb: false, fx: FX_BUDGETS.mid },
  high:  { label: '高清', antialias: true,  maxDpr: 1.5,  anisotropy: 4, terrainSeg: 384, allowGlb: true,  treadMarks: true,  forceGlb: true, fx: FX_BUDGETS.high },
  ultra: { label: '极致', antialias: true,  maxDpr: 2,    anisotropy: 8, terrainSeg: 512, allowGlb: true,  treadMarks: true,  forceGlb: true, fx: FX_BUDGETS.ultra },
}

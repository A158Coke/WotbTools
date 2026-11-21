// 阵营/炮线调色（唯一事实源）：playbackScene（炮线、基地归属、标签）与消费方共用。
//
// 阵营/中立：green / red / white——中立与未知阵营一律 white（unknown ≠ enemy）。
// 阵营色深色板（2026-10-05 加深）：原亮绿/亮红在明亮地表上对比不足；统一到与车辆
// tint 同源的深绿/深红（「与上游 Agent 同值」，`teamColor` 原已用此对），炮线与车辆
// 着色共用一个事实源。
export const COLOR_FRIENDLY = 0x26794a; // 深绿
export const COLOR_ENEMY = 0x98322a;    // 深红
export const COLOR_UNKNOWN = 0xf5f5f5;

// 炮线专用亮色（与车辆 tint **分离**，2026-10-05 用户反馈"亮度/鲜艳度不够"）：
// 两者取色目标相反——车辆 tint 要压得住（亮色在明亮地表上刺眼且车体显脏，已回退），
// 炮线是细长高动态、只存在一两秒的物体，需要**字面亮度**才看得清（材质 toneMapped=false
// 直出字面色，故提亮只能靠颜色本身与不透明度）。保持"绿=友 / 红=敌"色相，仅提亮提饱和。
// 车辆/基地/标签**不得**改用这两个值（回退即车辆 tint 变亮）。
export const TRACER_FRIENDLY = 0x3ee08a; // 亮绿（同色相提亮 #26794a）
export const TRACER_ENEMY = 0xff5a45;    // 亮红（同色相提亮 #98322a）

/** 车辆/基地/标签阵营色（深色板；中立与未知阵营一律 white——unknown ≠ enemy）。
 *  入参是**队伍号本身**而非车辆对象：调用方必须显式解出 `v.def.team`（RuntimeVehicle
 *  带索引签名，整对象传入无法被类型拦下——评审 P2 的阵营色全白回归即源于此）。 */
export function teamColorOf(team: number | null | undefined, friendlyTeam: number | null | undefined): number {
  const f = friendlyTeam ?? 0, t = team ?? 0
  if (t === 0 || f === 0) return COLOR_UNKNOWN   // 中立＝白（green / red / white 口径）
  return t === f ? COLOR_FRIENDLY : COLOR_ENEMY
}

package com.wotb.core.replay.evidence;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Backend Evidence Skills 编排器（文档 §25 的 Backend Evidence Skills 模块）。
 * <p>顺序：HP 动量 → 阵亡连锁 → 换血 → 局部支援 → 路线 → 空间分离 → 关键窗口聚合。
 * 各 Skill 独立、确定性、可单测；输出只含事实与确定性派生测量，不包含任何战术裁决。</p>
 * <p><b>Backend Evidence Boundary（PR #103 架构收口）</b>：本编排器输出的所有 AiEvidence
 * 必须表示 observed facts / deterministic derived measurements / neutral structural
 * classifications；不得编码 player intent、tactical correctness、tactical benefit、
 * tactical blame 或 recommendation——战术解释全部由 LLM 负责。</p>
 * <p>{@code OBSERVED_DAMAGE_IS_PARTIAL} 时跳过 {@link EngagementTradeSkill}：
 * 换血数字来自事件流交火（观测子集），覆盖不全不得送入 LLM；
 * {@link CriticalWindowSkill} 随后基于过滤后的 HP 动量/阵亡/支援/路线/空间分离证据重新聚合窗口，
 * 保留独立可靠的死亡、路线、局部支援与共同观察实体 HP momentum 证据。</p>
 */
public final class EvidenceSkillEngine {

    public EvidenceSkillResult run(final EvidenceSkillContext ctx) {
        final HpMomentumSkill hpSkill = new HpMomentumSkill();
        final List<HpMomentumSkill.HpMomentumSample> momentumSeries =
                hpSkill.sample(ctx.recon(), ctx.battle());

        final Integer recorderTeam = ctx.recorder() != null ? ctx.recorder().team() : null;
        final List<AiEvidence> hp = hpSkill.detect(momentumSeries);
        final List<AiEvidence> deaths = new DeathCascadeSkill().detect(ctx.battle(), recorderTeam);
        final boolean damagePartial = ctx.features() != null && ctx.features().limitations() != null
                && ctx.features().limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
        final List<AiEvidence> trades = damagePartial
                ? List.of()
                : new EngagementTradeSkill().detect(ctx, momentumSeries);
        final List<AiEvidence> support = new LocalSupportSkill().detect(ctx);
        final List<AiEvidence> routes = new RouteSkill().detect(ctx);
        final List<AiEvidence> separations = PlayerSeparationEvidenceSkill.detect(ctx);

        final List<AiEvidence> all = new ArrayList<>();
        all.addAll(hp);
        all.addAll(deaths);
        all.addAll(trades);
        all.addAll(support);
        all.addAll(routes);
        all.addAll(separations);
        all.sort(Comparator.comparingDouble(AiEvidence::startSec));

        final List<AiEvidence> windows = new CriticalWindowSkill().detect(all);
        return new EvidenceSkillResult(all, windows, momentumSeries);
    }
}

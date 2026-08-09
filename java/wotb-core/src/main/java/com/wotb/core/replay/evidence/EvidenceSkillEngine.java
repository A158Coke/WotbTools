package com.wotb.core.replay.evidence;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Backend Evidence Skills 编排器（文档 §25 的 Backend Evidence Skills 模块）。
 * <p>顺序：HP 动量 → 阵亡连锁 → 换血 → 局部支援 → 路线 → 关键窗口聚合。
 * 各 Skill 独立、确定性、可单测；输出不包含任何战术裁决。</p>
 */
public final class EvidenceSkillEngine {

    public EvidenceSkillResult run(final EvidenceSkillContext ctx) {
        final HpMomentumSkill hpSkill = new HpMomentumSkill();
        final List<HpMomentumSkill.HpMomentumSample> momentumSeries =
                hpSkill.sample(ctx.recon(), ctx.battle());

        final Integer recorderTeam = ctx.recorder() != null ? ctx.recorder().team() : null;
        final List<AiEvidence> hp = hpSkill.detect(momentumSeries);
        final List<AiEvidence> deaths = new DeathCascadeSkill().detect(ctx.battle(), recorderTeam);
        final List<AiEvidence> trades = new EngagementTradeSkill().detect(ctx, momentumSeries);
        final List<AiEvidence> support = new LocalSupportSkill().detect(ctx);
        final List<AiEvidence> routes = new RouteSkill().detect(ctx);

        final List<AiEvidence> all = new ArrayList<>();
        all.addAll(hp);
        all.addAll(deaths);
        all.addAll(trades);
        all.addAll(support);
        all.addAll(routes);
        all.sort(Comparator.comparingDouble(AiEvidence::startSec));

        final List<AiEvidence> windows = new CriticalWindowSkill().detect(all);
        return new EvidenceSkillResult(all, windows, momentumSeries);
    }
}

package com.wotb.core.replay.evidence;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

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

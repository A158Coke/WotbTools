package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * Backend Evidence Skill 的统一输入。所有 Skill 只读此上下文，产出 {@link AiEvidence}。
 */
public record EvidenceSkillContext(
        Battle battle,
        ReplayReconstruction recon,
        PlayerBattleFeatureSet features,
        RecorderEntityMapping recorder
) {
    public EvidenceSkillContext {
        if (battle == null) {
            throw new IllegalArgumentException("battle must not be null");
        }
        if (recon == null) {
            throw new IllegalArgumentException("recon must not be null");
        }
        if (features == null) {
            features = PlayerBattleFeatureSet.empty();
        }
        if (recorder == null) {
            recorder = RecorderEntityMapping.unresolved();
        }
    }
}

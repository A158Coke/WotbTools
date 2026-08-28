package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.PlaybackCombatReconstruction;

/**
 * 击杀者证据（PR147 §11）：settlement field25 killerID（result/entity-id → accountId）是<b>强 authority</b>；
 * live reconstruction（{@link PlaybackCombatReconstruction.Destroyed}）是 cross-check。
 * <ul>
 *   <li>settlement killer 已知 → {@link Source#SETTLEMENT}（confirmed）；</li>
 *   <li>live killer 已知（settlement 未知）→ {@link Source#LIVE}；</li>
 *   <li>两者已知但<b>冲突</b> → {@link Source#CONFLICT}（fail-closed，killer null，绝不静默选一个）；</li>
 *   <li>皆未知 → {@link Source#UNKNOWN}。</li>
 * </ul>
 */
public final class KillerEvidenceResolver {

    private KillerEvidenceResolver() {
    }

    public enum Source {
        SETTLEMENT,
        LIVE,
        CONFLICT,
        UNKNOWN
    }

    public record KillerEvidence(Long killerAccountId, Source source, boolean confirmed) {
    }

    /** Resolve the authoritative killer of {@code victim} (settlement-first, live cross-check, fail-closed). */
    public static KillerEvidence resolve(
            final PlayerResult victim,
            final PlaybackCombatReconstruction.Result combat) {
        final Long settlementKiller = victim == null ? null : victim.killerAccountId;
        final Long liveKiller = liveKiller(combat, victim == null ? -1 : victim.accountId);
        if (settlementKiller != null && liveKiller != null
                && !settlementKiller.equals(liveKiller)) {
            return new KillerEvidence(null, Source.CONFLICT, false);
        }
        if (settlementKiller != null) {
            return new KillerEvidence(settlementKiller, Source.SETTLEMENT, true);
        }
        if (liveKiller != null) {
            return new KillerEvidence(liveKiller, Source.LIVE, true);
        }
        return new KillerEvidence(null, Source.UNKNOWN, false);
    }

    private static Long liveKiller(final PlaybackCombatReconstruction.Result combat, final long victimAccountId) {
        if (combat == null || combat.destroyed() == null) {
            return null;
        }
        for (final PlaybackCombatReconstruction.Destroyed d : combat.destroyed()) {
            if (d.victimAccountId() == victimAccountId) {
                return d.killerAccountId();
            }
        }
        return null;
    }
}

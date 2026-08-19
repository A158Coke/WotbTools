package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * {@link DamageEvent} 攻击者/受击者身份解析（Player/Team 共用，唯一实现）。
 *
 * <p>真实 {@link com.wotb.core.replay.decoder.EntityMethodDecoder} 生成的 DamageEvent
 * 直填账号字段恒为 null，必须沿
 * {@link com.wotb.core.replay.event.ParticipantMappingEvent} 的 entityId→accountId 映射
 * （复用 {@link com.wotb.core.processing.TeamEntityMapper} 的确定性解析）按
 * {@code attackerEid/victimEid} 解析。
 * 合成 fixture 若直填账号则优先使用；无法解析返回 0，由调用方跳过/标记。</p>
 */
final class DamageEventIdentityResolver {

    private DamageEventIdentityResolver() {
    }

    /** 构建 entityId→accountId 映射（battle/recon 为 null 时返回空映射，直填账号仍可用）。 */
    static TeamEntityMapping mapping(final Battle battle, final ReplayReconstruction recon) {
        return TeamEntityMapper.resolve(battle, recon);
    }

    /** 受击者账号：直填 >0 优先，否则按 victimEid 解析；无法解析返回 0。 */
    static long victimAccount(final DamageEvent damage, final TeamEntityMapping mapping) {
        if (damage.victimAccountId() != null && damage.victimAccountId() > 0) {
            return damage.victimAccountId();
        }
        return accountOf(damage.victimEid(), mapping);
    }

    /** 攻击者账号：直填 >0 优先，否则按 attackerEid 解析；无法解析返回 0。 */
    static long attackerAccount(final DamageEvent damage, final TeamEntityMapping mapping) {
        if (damage.attackerAccountId() != null && damage.attackerAccountId() > 0) {
            return damage.attackerAccountId();
        }
        return accountOf(damage.attackerEid(), mapping);
    }

    private static long accountOf(final int entityId, final TeamEntityMapping mapping) {
        if (entityId <= 0) {
            return 0L;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null ? identity.accountId() : 0L;
    }
}

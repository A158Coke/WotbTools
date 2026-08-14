package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放实测最大血量（type-7 propId=3，u16 LE，含装备/物资加成）。
 * <p>血量事实权威口径：回放事件流里的 {@code HealthChangedEvent.currentHealth}
 * 是客户端同步的「当前血量」，含装备与物资加成；阵亡到 0、存活不到 0、受击时同步。
 * 因此每个账号在事件流里观测到的最大 hp 即该车本场初始满血量（只增不减语义下）。
 * 兜底：观测缺失（敌方从未点亮/低置信度）时回退 tankopedia base，
 * 最终值取 {@code max(观测, tankopedia base)}——装备加成只会提高上限，base 是下界。</p>
 */
public final class ObservedMaxHp {

    private ObservedMaxHp() {
    }

    /** 按账号统计回放实测最大血量（EXACT 置信度且 hp>0；re-entry 跨实体合并取 max）。 */
    public static Map<Long, Integer> byAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        final Map<Long, Integer> observed = new HashMap<>();
        if (events == null || mapping == null) {
            return observed;
        }
        for (final ReplayEvent event : events) {
            if (!(event instanceof HealthChangedEvent hp)) {
                continue;
            }
            // 只接受可信正 HP：signed i16 语义下 0xFFFD(-3) 死亡 sentinel、0xFFFF(-1)
            // UNKNOWN sentinel 及其它 ≤0/≥0xFF00 高位值一律不得进入（防 65533/65535 污染）
            if (hp.confidence() != DecodeConfidence.EXACT
                    || !HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.identity(hp.entityId());
            if (identity == null || identity.accountId() <= 0) {
                continue;
            }
            observed.merge(identity.accountId(), hp.currentHealth(), Math::max);
        }
        return observed;
    }

    /** 解析该玩家血量：max(回放实测, tankopedia base)；均无 → null（调用方回退 tankopedia 语义）。 */
    public static Integer resolve(final Integer observed, final long tankId) {
        final Integer base = ReplayDisplayNames.tankMaxHpValue(tankId);
        if (observed == null) {
            return base;
        }
        if (base == null) {
            return observed;
        }
        return Math.max(observed, base);
    }

    /** 幂等回填：把解析后的本场血量写入 battle.players 的 {@code observedMaxHp}（无重建时跳过）。 */
    public static void populate(
            final Battle battle,
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping
    ) {
        if (battle == null || battle.players == null || events == null || mapping == null) {
            return;
        }
        final Map<Long, Integer> observed = byAccount(events, mapping);
        for (final PlayerResult player : battle.players) {
            if (player == null) {
                continue;
            }
            player.observedMaxHp = resolve(observed.get(player.accountId), player.tankId);
        }
    }
}

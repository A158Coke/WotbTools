package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 掉血窗口测试 fixture：为直填账号（或 entityId）的 DAMAGE 事件自动生成
 * 「prev/cur HP sample 对 + entityId→accountId 映射 + 参与者」，使
 * {@code PlaybackCombatReconstruction.derive} 能为每条掉血产出可 attribution 的 Loss。
 *
 * <p>窗口 (t-0.5, t] 内只放一条 DAMAGE 通知 → 精确 attribution；
 * 准备阶段（t &lt; battleStart）事件与 HP 链被 {@code derive} 过滤，天然排除。</p>
 */
final class DamageWindowFixture {

    private DamageWindowFixture() {
    }

    /** 为直填账号事件生成 recon（victim entityId = (int) victimAccountId）。 */
    static ReplayReconstruction recon(final Float battleStart, final DamageEvent... events) {
        return recon(battleStart, List.of(), events);
    }

    /**
     * 生成带 HP 链的 recon：为每条 damage 自动生成 prev/cur HP sample
     * （victim 从 2000 逐条递减），并为每个出现的账号生成 entityId→accountId 映射
     * 与参与者（battle 为 null 时 identity 也能从 participants 解析）。
     */
    static ReplayReconstruction recon(final Float battleStart,
                                      final List<ParticipantMappingEvent> explicitMappings,
                                      final DamageEvent... events) {
        final List<ReplayEvent> all = new ArrayList<>();
        final List<ReplayEvent> sortedEvents = new ArrayList<>(List.of(events));
        sortedEvents.sort(Comparator.comparingDouble(e ->
                e.timestamp() == null ? 0 : e.timestamp().rawClockSec()));
        // victim 账号 → 当前 HP（从 2000 递减），生成 HP 链
        final Map<Long, Integer> curHp = new LinkedHashMap<>();
        final Map<Long, Integer> victimEid = new LinkedHashMap<>();
        for (final ReplayEvent e : sortedEvents) {
            if (!(e instanceof DamageEvent d)) {
                continue;
            }
            final Long victim = d.victimAccountId() != null && d.victimAccountId() > 0
                    ? d.victimAccountId()
                    : accountOf(d.victimEid(), explicitMappings);
            if (victim == null || victim <= 0 || d.damage() <= 0) {
                continue;
            }
            final int eid = d.victimEid() > 0 ? d.victimEid() : (int) (long) victim;
            victimEid.putIfAbsent(victim, eid);
            final float t = d.timestamp().rawClockSec();
            if (battleStart != null && t < battleStart) {
                continue; // 准备阶段：HP sample 也在战斗开始前，derive 会过滤
            }
            final int prev = curHp.getOrDefault(victim, 2000);
            all.add(new HealthChangedEvent(seq(victim, 0), new ReplayTimestamp(t - 0.5f, null), 7,
                    DecodeConfidence.EXACT, eid, prev, null, true));
            all.add(new HealthChangedEvent(seq(victim, 1), new ReplayTimestamp(t, null), 7,
                    DecodeConfidence.EXACT, eid, prev - d.damage(), null, true));
            curHp.put(victim, prev - d.damage());
        }
        // 为每个出现的账号补 mapping + 参与者（battle=null 时 identity 从 participants 解析）
        final Map<Long, Integer> allAccounts = new LinkedHashMap<>();
        for (final DamageEvent d : events) {
            if (d.victimAccountId() != null && d.victimAccountId() > 0) {
                allAccounts.put(d.victimAccountId(), (int) (long) d.victimAccountId());
            }
            if (d.attackerAccountId() != null && d.attackerAccountId() > 0) {
                allAccounts.put(d.attackerAccountId(), (int) (long) d.attackerAccountId());
            }
        }
        allAccounts.putAll(victimEid);
        final List<ParticipantMappingEvent> mappings = new ArrayList<>(explicitMappings);
        final List<BattleParticipant> participants = new ArrayList<>();
        for (final Map.Entry<Long, Integer> e : allAccounts.entrySet()) {
            final int eid = e.getValue();
            final long account = e.getKey();
            boolean known = false;
            for (final ParticipantMappingEvent m : explicitMappings) {
                if (m.entityId() == eid && m.accountId() == account) {
                    known = true;
                    break;
                }
            }
            if (!known) {
                mappings.add(new ParticipantMappingEvent(seq(account, 2), new ReplayTimestamp(1f, null), 8,
                        DecodeConfidence.EXACT, eid, account));
            }
            participants.add(new BattleParticipant(account, "P" + account, 1, 4481, "kranvagn", false));
        }
        all.addAll(mappings);
        all.addAll(List.of(events));
        return new ReplayReconstruction(null, null, 600f, battleStart,
                participants, all, List.of(), null, null, null);
    }

    static Long accountOf(final int entityId, final List<ParticipantMappingEvent> mappings) {
        for (final ParticipantMappingEvent m : mappings) {
            if (m.entityId() == entityId && m.accountId() > 0) {
                return m.accountId();
            }
        }
        return null;
    }

    private static int seq(final long key, final int salt) {
        return (int) ((key * 31 + salt) % 100_000) + 1;
    }
}
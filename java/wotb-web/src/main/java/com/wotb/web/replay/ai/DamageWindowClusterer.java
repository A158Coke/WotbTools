package com.wotb.web.replay.ai;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 把受击者视角的逐次伤害事件按时间间隙聚类成「掉血窗口」，供 Player/Team 证据复用。
 *
 * <p>同一窗口内相邻伤害事件的时间间隔 ≤ {@link #MAX_GAP_SEC}；超过则新开窗口。
 * 小窗口大量掉血（如数秒内掉血过半）或窗口末次事件 lethal（被秒）可直接被 AI
 * 识别为问题场景。时间统一为战斗相对秒（与 PER_HIT_DAMAGE_EVENTS 同口径，
 * 准备阶段事件不计）。</p>
 */
final class DamageWindowClusterer {

    /** 同一窗口内相邻伤害事件的最大时间间隔（秒）；超过则新开窗口。 */
    static final double MAX_GAP_SEC = 10.0;

    /** 一个掉血窗口：起止时间（battle-relative 秒）、总掉血量、命中次数、是否含致死伤害。 */
    record DamageWindow(float startSec, float endSec, int totalDamage, int hitCount, boolean lethal) {
    }

    private DamageWindowClusterer() {
    }

    /**
     * 按受击账号聚合掉血窗口（battle-relative 秒，按时间升序）。
     *
     * @param recon     重建结果（含事件流）；null / 无事件 → 空列表
     * @param accountId 受击者账号；≤0 → 空列表
     */
    static List<DamageWindow> receivedWindows(final ReplayReconstruction recon, final long accountId) {
        if (recon == null || recon.events() == null || accountId <= 0) {
            return List.of();
        }
        final Float battleStart = recon.battleStartRawClockSec();
        final List<DamageEvent> received = new ArrayList<>();
        for (final ReplayEvent event : recon.events()) {
            if (!(event instanceof DamageEvent damage)) {
                continue;
            }
            if (damage.damage() <= 0) {
                continue;
            }
            final Long victim = damage.victimAccountId();
            if (victim == null || victim != accountId) {
                continue;
            }
            if (battleStart != null && damage.timestamp() != null
                    && damage.timestamp().rawClockSec() < battleStart) {
                continue; // 准备阶段不计（与其它证据同口径）
            }
            received.add(damage);
        }
        if (received.isEmpty()) {
            return List.of();
        }
        received.sort(Comparator.comparingDouble(
                d -> d.timestamp() == null ? 0.0 : d.timestamp().rawClockSec()));

        final List<DamageWindow> windows = new ArrayList<>();
        float windowStart = -1f;
        float windowEnd = -1f;
        int total = 0;
        int hits = 0;
        boolean lethal = false;
        for (final DamageEvent damage : received) {
            final float relative = relativeSec(damage, battleStart);
            if (windowStart < 0f || relative - windowEnd > MAX_GAP_SEC) {
                if (windowStart >= 0f) {
                    windows.add(new DamageWindow(windowStart, windowEnd, total, hits, lethal));
                }
                windowStart = relative;
                total = 0;
                hits = 0;
                lethal = false;
            }
            windowEnd = relative;
            total += damage.damage();
            hits++;
            lethal |= damage.lethal();
        }
        windows.add(new DamageWindow(windowStart, windowEnd, total, hits, lethal));
        return windows;
    }

    private static float relativeSec(final DamageEvent damage, final Float battleStart) {
        final float raw = damage.timestamp() == null ? 0f : damage.timestamp().rawClockSec();
        return battleStart != null ? raw - battleStart : raw;
    }
}

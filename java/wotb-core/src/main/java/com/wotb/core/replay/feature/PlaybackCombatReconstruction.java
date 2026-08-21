package com.wotb.core.replay.feature;

import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.timeline.TimelineClock;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Playback 战斗事实重建（docs/current-plan.md §11–§17）：把「攻击通知（Type-8，raw 值语义未证明）」
 * 与「权威 HP 变化（Type-7 propId=3，signed i16 绝对当前 HP）」在语义上分离。
 *
 * <p>产出：</p>
 * <ul>
 *   <li><b>HP loss 记录</b>：同一车辆连续可信 HP sample 的 drop（previousHp − newHp，HP 单调非增无治疗），
 *       带时间窗口与攻击者 attribution——窗口 (prevT, curT] 内的 DAMAGE 通知全部来自同一攻击者才可
 *       attribution（§12/§13：单通知=精确 attribution；同攻击者多通知=整体 attribution；
 *       0 通知或混合攻击者=不 attribution，受害者掉血事实保留但不得伪造攻击者）。</li>
 *   <li><b>击毁事件</b>：HealthChangedEvent alive=false / HP=0（EXACT）为权威击毁时刻；
 *       destroyed 事实与 killer attribution 完全分离——killer 仅在致死窗口
 *       (timeSec − KILL_BACKING_WINDOW_SEC, timeSec] 内存在**唯一可信攻击者**时产生：
 *       窗口内全部该受害者的 DAMAGE 通知攻击者身份均可解析、候选一致、且攻击者 ≠ 受害者；
 *       任一条件不满足（无通知 / 多个不同攻击者 / 含未解析攻击者 / 自伤候选）→ killer = null，
 *       保留 destroyed 事实但绝不伪造 KILL。同一 victim 重复 alive=false/HP=0 事件去重，
 *       每车最多一个 destroyed 事实（保留最早可信击毁时刻）。</li>
 * </ul>
 *
 * <p>本类只消费 canonical 事件流 + 实体映射，不触碰 raw packets；供
 * {@code MapOverviewBuilder} 与 {@code BattlePlaybackAdapter} 两个 playback builder 共用，
 * 保证用户契约一致（BattlePlaybackAdapterParityTest）。</p>
 */
public final class PlaybackCombatReconstruction {

    /** KILL 必须由同一炮 DAMAGE 支撑的最大时间差（秒，与 parity 契约 §15 对齐）。 */
    public static final double KILL_BACKING_WINDOW_SEC = 0.25;

    private PlaybackCombatReconstruction() {
    }

    /** 一次权威 HP 变化（attacker 可能为 null：无法可靠 attribution 的掉血事实）。 */
    public record Loss(
            double fromSec,
            double toSec,
            int hpLoss,
            Long attackerAccountId,
            boolean attackerReliable,
            int damageEventCount
    ) {
    }

    /** 击毁事实：victim 在 timeSec 被击毁；killerAccountId 可空（无可靠击杀者证明）。 */
    public record Destroyed(double timeSec, long victimAccountId, Long killerAccountId) {
    }

    /** 重建结果：按 victim 账号分组的 HP loss + 击毁列表（均 battle-relative 秒升序）。 */
    public record Result(Map<Long, List<Loss>> lossesByVictim, List<Destroyed> destroyed) {
        public Result {
            lossesByVictim = lossesByVictim == null ? Map.of() : Map.copyOf(lossesByVictim);
            destroyed = destroyed == null ? List.of() : List.copyOf(destroyed);
        }

        /** 某账号的 HP loss 列表（升序；无则空表）。 */
        public List<Loss> lossesOf(final long accountId) {
            final List<Loss> list = lossesByVictim.get(accountId);
            return list == null ? List.of() : list;
        }
    }

    /**
     * 从 canonical 事件流重建 HP loss + 击毁。
     *
     * @param events                全部 canonical 事件（recon 或 timeline 同源）
     * @param mapping               entityId → accountId 映射
     * @param battleStartRawClockSec battle-relative 时钟基准
     * @param duration              战斗时长（结果只保留 [0, duration]）
     */
    public static Result derive(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final double battleStartRawClockSec,
            final double duration) {
        final Map<Long, List<Loss>> losses = new HashMap<>();
        final List<Destroyed> destroyed = new ArrayList<>();
        if (events == null || mapping == null) {
            return new Result(losses, destroyed);
        }

        // 1) 每账号 EXACT HP sample 时间线（正数可信 HP + 阵亡 0；sentinel 绝不进入）
        final Map<Long, List<double[]>> samples = new HashMap<>();
        // 每账号 damage 通知（battle-relative 秒升序；{timeSec, attackerAccountId}）
        final Map<Long, List<double[]>> damagesByVictim = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (event instanceof HealthChangedEvent hp) {
                if (hp.confidence() != DecodeConfidence.EXACT || hp.currentHealth() == null) {
                    continue;
                }
                final Long account = accountOf(hp.entityId(), mapping);
                if (account == null || account <= 0) {
                    continue;
                }
                final double t = battleClockOf(hp, battleStartRawClockSec);
                if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                    continue;
                }
                if (hp.currentHealth() != 0
                        && !HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                    continue;
                }
                samples.computeIfAbsent(account, k -> new ArrayList<>())
                        .add(new double[]{t, hp.currentHealth()});
            } else if (event instanceof DamageEvent damage) {
                if (damage.damage() <= 0) {
                    continue;
                }
                // 直填账号优先（合成 fixture/直填事件），否则按 entityId 解析（真实 decoder 直填恒 null）
                final Long victim = damage.victimAccountId() != null && damage.victimAccountId() > 0
                        ? damage.victimAccountId()
                        : accountOf(damage.victimEid(), mapping);
                if (victim == null || victim <= 0) {
                    continue;
                }
                final double t = battleClockOf(damage, battleStartRawClockSec);
                if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                    continue;
                }
                final Long attackerL = damage.attackerAccountId() != null && damage.attackerAccountId() > 0
                        ? damage.attackerAccountId()
                        : accountOf(damage.attackerEid(), mapping);
                final double attacker = attackerL == null ? 0.0 : attackerL;
                damagesByVictim.computeIfAbsent(victim, k -> new ArrayList<>())
                        .add(new double[]{t, attacker});
            }
        }
        for (final List<double[]> list : samples.values()) {
            list.sort(Comparator.comparingDouble(a -> a[0]));
        }
        for (final List<double[]> list : damagesByVictim.values()) {
            list.sort(Comparator.comparingDouble(a -> a[0]));
        }

        // 2) 连续 sample drop → Loss（attribution 只信任窗口内同攻击者；左开右闭 (prevT, curT]）
        for (final Map.Entry<Long, List<double[]>> entry : samples.entrySet()) {
            final long victim = entry.getKey();
            final List<double[]> list = entry.getValue();
            for (int i = 1; i < list.size(); i++) {
                final double prevT = list.get(i - 1)[0];
                final int prevHp = (int) list.get(i - 1)[1];
                final double curT = list.get(i)[0];
                final int curHp = (int) list.get(i)[1];
                if (prevHp <= 0 || curHp >= prevHp) {
                    continue; // 无掉血或非法顺序（HP 单调非增，仅信任下降）
                }
                final int hpLoss = prevHp - curHp;
                final List<double[]> dmg = damagesByVictim.get(victim);
                Long soleAttacker = null;
                int inWindow = 0;
                boolean mixed = false;
                if (dmg != null) {
                    for (final double[] d : dmg) {
                        if (d[0] > prevT + 1e-6 && d[0] <= curT + 1e-6) {
                            inWindow++;
                            final long a = (long) d[1];
                            if (a <= 0) {
                                mixed = true; // 通知身份无法解析 → 无法证明归属
                            } else if (soleAttacker == null) {
                                soleAttacker = a;
                            } else if (soleAttacker != a) {
                                mixed = true;
                            }
                        }
                    }
                }
                final boolean reliable = !mixed && inWindow >= 1 && soleAttacker != null;
                losses.computeIfAbsent(victim, k -> new ArrayList<>()).add(new Loss(
                        prevT, curT, hpLoss,
                        reliable ? soleAttacker : null,
                        reliable,
                        inWindow));
            }
        }

        // 3) 击毁：alive=false / HP=0（EXACT）→ Destroyed 事实（每 victim 去重，保留最早时刻）。
        //    killer 仅在致死窗口内存在**唯一可信攻击者**时产生（fail-closed）：
        //    - 窗口 (t − KILL_BACKING_WINDOW_SEC, t] 内该 victim 的全部 DAMAGE 通知（damagesByVictim
        //      已按 victim 分组，天然满足「全部指向同一 victim」）；
        //    - 每条通知的攻击者身份均可解析（attacker > 0）；
        //    - 所有候选攻击者一致（无冲突候选）；
        //    - 攻击者 ≠ 受害者（自伤候选不得作 killer）；
        //    任一不满足 → killer = null（保留 destroyed，不生成伪造 KILL）。
        final Map<Long, Destroyed> destroyedByVictim = new HashMap<>();
        for (final ReplayEvent event : events) {
            if (!(event instanceof HealthChangedEvent hp)
                    || hp.confidence() != DecodeConfidence.EXACT
                    || hp.currentHealth() == null
                    || hp.currentHealth() != 0
                    || !Boolean.FALSE.equals(hp.alive())) {
                continue;
            }
            final Long victim = accountOf(hp.entityId(), mapping);
            if (victim == null || victim <= 0) {
                continue;
            }
            final double t = battleClockOf(hp, battleStartRawClockSec);
            if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                continue;
            }
            // 去重：每车最多一个 destroyed 事实；重复事件保留最早可信击毁时刻
            final Destroyed existing = destroyedByVictim.get(victim);
            if (existing != null && existing.timeSec() <= t) {
                continue;
            }
            Long killer = null;
            final List<double[]> dmg = damagesByVictim.get(victim);
            if (dmg != null) {
                boolean unique = true;
                Long sole = null;
                int inWindow = 0;
                for (final double[] d : dmg) {
                    final double dt = t - d[0];
                    if (dt > KILL_BACKING_WINDOW_SEC + 1e-6) {
                        continue; // 更早的通知不在窗口内
                    }
                    if (d[0] <= t + 1e-6) {
                        inWindow++;
                        final long a = (long) d[1];
                        if (a <= 0) {
                            unique = false; // 攻击者身份无法解析 → 无法证明归属
                        } else if (a == victim) {
                            unique = false; // 自伤候选 → 不得作 killer
                        } else if (sole == null) {
                            sole = a;
                        } else if (sole != a) {
                            unique = false; // 多个不同攻击者 → 冲突候选
                        }
                    }
                }
                if (unique && inWindow >= 1 && sole != null) {
                    killer = sole;
                }
            }
            destroyedByVictim.put(victim, new Destroyed(t, victim, killer));
        }
        destroyed.addAll(destroyedByVictim.values());
        destroyed.sort(Comparator.comparingDouble(Destroyed::timeSec));

        final Map<Long, List<Loss>> immutable = new HashMap<>();
        losses.forEach((k, v) -> {
            v.sort(Comparator.comparingDouble(Loss::fromSec));
            immutable.put(k, List.copyOf(v));
        });
        return new Result(immutable, destroyed);
    }

    /**
     * 事件级可归属掉血（§12/§13）：仅当该受害者掉血窗口内**恰好一条**伤害通知
     * （= 唯一攻击者 + 精确 attribution）且事件时刻位于窗口 (fromSec, toSec] 时返回掉血值；
     * 多通知窗口 / 无通知 / 窗口外 → null（不得把窗口掉血拆到单个事件）。
     */
    public static Integer observedHpLossAt(final Result result, final long victimAccountId, final double timeSec) {
        for (final Loss l : result.lossesOf(victimAccountId)) {
            if (l.damageEventCount() != 1) {
                continue;
            }
            if (timeSec > l.fromSec() + 1e-6 && timeSec <= l.toSec() + 1e-6) {
                return l.hpLoss();
            }
        }
        return null;
    }

    private static Long accountOf(final int entityId, final TeamEntityMapping mapping) {
        if (entityId <= 0) {
            return null;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null ? identity.accountId() : null;
    }

    private static double battleClockOf(final ReplayEvent event, final double battleStartRawClockSec) {
        return TimelineClock.battleClockOf(event, battleStartRawClockSec);
    }
}
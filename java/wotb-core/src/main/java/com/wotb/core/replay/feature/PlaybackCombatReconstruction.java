package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.UnsupportedDamageEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.facts.ReplayTerminalLifecycle;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.timeline.TimelineClock;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Canonical playback combat reconstruction.
 *
 * <p>HP loss is derived only from trustworthy observed current-HP samples. Destroyed/death is derived
 * independently from {@link ReplayTerminalLifecycle}; this is essential for positive-HP drowning and
 * terminal sentinels that are not HP=0.</p>
 */
public final class PlaybackCombatReconstruction {

    public static final double KILL_BACKING_WINDOW_SEC = 0.25;

    private PlaybackCombatReconstruction() {
    }

    public record Loss(
            double fromSec,
            double toSec,
            int hpLoss,
            Long attackerAccountId,
            boolean attackerReliable,
            int damageEventCount,
            int fromHp,
            int toHp
    ) {
    }

    public record Destroyed(double timeSec, long victimAccountId, Long killerAccountId) {
    }

    public record Result(Map<Long, List<Loss>> lossesByVictim, List<Destroyed> destroyed) {
        public Result {
            lossesByVictim = lossesByVictim == null ? Map.of() : Map.copyOf(lossesByVictim);
            destroyed = destroyed == null ? List.of() : List.copyOf(destroyed);
        }

        public List<Loss> lossesOf(final long accountId) {
            final List<Loss> list = lossesByVictim.get(accountId);
            return list == null ? List.of() : list;
        }
    }

    public static Result derive(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final double battleStartRawClockSec,
            final double duration) {
        return derive(events, mapping, battleStartRawClockSec, duration, null);
    }

    public static Result derive(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final double battleStartRawClockSec,
            final double duration,
            final Battle battle) {
        final Map<Long, List<Loss>> losses = new HashMap<>();
        if (events == null || mapping == null) {
            return new Result(losses, List.of());
        }

        // Canonical current-HP samples only. Terminal sentinels are intentionally not rewritten to HP=0.
        final Map<Long, List<double[]>> samples = new HashMap<>();
        final Map<Long, List<double[]>> damagesByVictim = new HashMap<>();
        final Map<Long, List<double[]>> unsupportedByVictim = new HashMap<>();
        final List<double[]> unsupportedUnresolved = new ArrayList<>();

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
                if (!inBattle(t, duration)) {
                    continue;
                }
                final int current = hp.currentHealth();
                if (current != 0 && !HealthChangedEvent.isPlausibleHp(current)) {
                    continue;
                }
                samples.computeIfAbsent(account, k -> new ArrayList<>())
                        .add(new double[]{t, current});
            } else if (event instanceof VehicleHitEvent hit) {
                // method8 is a hit/result-feedback family (VehicleHitEvent), NOT a damage number.
                // A proven hit is the attacker→victim engagement signal for attribution; authoritative HP
                // loss is derived from the Type7 samples (above), never from a method8 magnitude.
                if (hit.confidence() != DecodeConfidence.EXACT) {
                    continue;
                }
                final double t = battleClockOf(hit, battleStartRawClockSec);
                if (!inBattle(t, duration)) {
                    continue;
                }
                final Long attackerL = accountOf(hit.attackerEntityId(), mapping);
                final double attacker = attackerL == null ? 0.0 : attackerL;
                final Long victim = accountOf(hit.victimEntityId(), mapping);
                if (victim == null || victim <= 0) {
                    unsupportedUnresolved.add(new double[]{t, attacker});
                    continue;
                }
                damagesByVictim.computeIfAbsent(victim, k -> new ArrayList<>())
                        .add(new double[]{t, attacker});
            } else if (event instanceof DamageEvent damage) {
                // legacy DamageEvent consumers (non-method8 sources, if any) keep attribution semantics.
                if (damage.damage() <= 0) {
                    continue;
                }
                final double t = battleClockOf(damage, battleStartRawClockSec);
                if (!inBattle(t, duration)) {
                    continue;
                }
                final Long attackerL = damage.attackerAccountId() != null && damage.attackerAccountId() > 0
                        ? damage.attackerAccountId()
                        : accountOf(damage.attackerEid(), mapping);
                final double attacker = attackerL == null ? 0.0 : attackerL;
                final Long victim = damage.victimAccountId() != null && damage.victimAccountId() > 0
                        ? damage.victimAccountId()
                        : accountOf(damage.victimEid(), mapping);
                if (victim == null || victim <= 0) {
                    unsupportedUnresolved.add(new double[]{t, attacker});
                    continue;
                }
                damagesByVictim.computeIfAbsent(victim, k -> new ArrayList<>())
                        .add(new double[]{t, attacker});
            } else if (event instanceof UnsupportedDamageEvent unsupported) {
                final double t = battleClockOf(unsupported, battleStartRawClockSec);
                if (!inBattle(t, duration)) {
                    continue;
                }
                final Long attackerL = unsupported.attackerAccountId() != null
                        && unsupported.attackerAccountId() > 0
                        ? unsupported.attackerAccountId()
                        : accountOf(unsupported.attackerEid(), mapping);
                final double attacker = attackerL == null ? 0.0 : attackerL;
                final Long victim = unsupported.victimAccountId() != null && unsupported.victimAccountId() > 0
                        ? unsupported.victimAccountId()
                        : accountOf(unsupported.victimEid(), mapping);
                if (victim == null || victim <= 0) {
                    unsupportedUnresolved.add(new double[]{t, attacker});
                    continue;
                }
                unsupportedByVictim.computeIfAbsent(victim, k -> new ArrayList<>())
                        .add(new double[]{t, attacker});
            }
        }

        samples.values().forEach(list -> list.sort(Comparator.comparingDouble(a -> a[0])));
        damagesByVictim.values().forEach(list -> list.sort(Comparator.comparingDouble(a -> a[0])));
        unsupportedByVictim.values().forEach(list -> list.sort(Comparator.comparingDouble(a -> a[0])));

        deriveLosses(samples, damagesByVictim, unsupportedByVictim, unsupportedUnresolved, losses);

        // Final live terminal state per account is the only destroyed authority. Same-clock terminal beats
        // positive HP; a strictly later alive/rematerialization state negates an earlier terminal.
        final Map<Long, ReplayTerminalLifecycle.Evidence> finalLifecycle =
                ReplayTerminalLifecycle.finalStateByAccount(
                        events, mapping, battleStartRawClockSec, battle);
        final List<Destroyed> destroyed = new ArrayList<>();
        for (final ReplayTerminalLifecycle.Evidence terminal : finalLifecycle.values()) {
            if (!terminal.terminal() || !inBattle(terminal.timeSec(), duration)) {
                continue;
            }
            final long victim = terminal.accountId();
            final double t = terminal.timeSec();
            Long killer = null;
            if (terminal.allowsDamageKillerAttribution()) {
                double winStart = t - KILL_BACKING_WINDOW_SEC;
                final double[] lethal = lethalLossWindow(samples, victim, t);
                if (lethal != null) {
                    winStart = lethal[0];
                }
                killer = uniqueKiller(victim, winStart, t,
                        damagesByVictim, unsupportedByVictim, unsupportedUnresolved);
            }
            destroyed.add(new Destroyed(t, victim, killer));
        }
        destroyed.sort(Comparator.comparingDouble(Destroyed::timeSec));

        final Map<Long, List<Loss>> immutable = new HashMap<>();
        losses.forEach((account, values) -> {
            values.sort(Comparator.comparingDouble(Loss::fromSec));
            immutable.put(account, List.copyOf(values));
        });
        return new Result(immutable, destroyed);
    }

    private static void deriveLosses(
            final Map<Long, List<double[]>> samples,
            final Map<Long, List<double[]>> damagesByVictim,
            final Map<Long, List<double[]>> unsupportedByVictim,
            final List<double[]> unsupportedUnresolved,
            final Map<Long, List<Loss>> losses) {
        for (final Map.Entry<Long, List<double[]>> entry : samples.entrySet()) {
            final long victim = entry.getKey();
            final List<double[]> list = collapseSameClockDuplicates(entry.getValue());
            for (int i = 1; i < list.size(); i++) {
                final double prevT = list.get(i - 1)[0];
                final int prevHp = (int) list.get(i - 1)[1];
                final double curT = list.get(i)[0];
                final int curHp = (int) list.get(i)[1];
                if (prevHp <= 0 || curHp >= prevHp) {
                    continue;
                }
                final int hpLoss = prevHp - curHp;
                final List<double[]> dmg = damagesByVictim.get(victim);
                Long soleAttacker = null;
                int inWindow = 0;
                boolean mixed = false;
                if (dmg != null) {
                    for (final double[] d : dmg) {
                        if (inWindow(d[0], prevT, curT)) {
                            inWindow++;
                            final long a = (long) d[1];
                            if (a <= 0) {
                                mixed = true;
                            } else if (soleAttacker == null) {
                                soleAttacker = a;
                            } else if (soleAttacker != a) {
                                mixed = true;
                            }
                        }
                    }
                }
                final boolean unsupportedConflict = anyInWindow(unsupportedByVictim.get(victim), prevT, curT)
                        || anyInWindow(unsupportedUnresolved, prevT, curT);
                final boolean reliable = !mixed && !unsupportedConflict && inWindow >= 1 && soleAttacker != null;
                losses.computeIfAbsent(victim, k -> new ArrayList<>()).add(new Loss(
                        prevT, curT, hpLoss,
                        reliable ? soleAttacker : null,
                        reliable,
                        inWindow,
                        prevHp,
                        curHp));
            }
        }
    }

    /** Collapse exact same-clock duplicate HP mirrors; conflicting values make that clock unusable. */
    private static List<double[]> collapseSameClockDuplicates(final List<double[]> source) {
        final List<double[]> out = new ArrayList<>();
        int i = 0;
        while (i < source.size()) {
            final double t = source.get(i)[0];
            final int hp = (int) source.get(i)[1];
            boolean conflict = false;
            int j = i + 1;
            while (j < source.size() && Math.abs(source.get(j)[0] - t) <= 1e-6) {
                if ((int) source.get(j)[1] != hp) {
                    conflict = true;
                }
                j++;
            }
            if (!conflict) {
                out.add(new double[]{t, hp});
            }
            i = j;
        }
        return out;
    }

    private static Long uniqueKiller(
            final long victim,
            final double from,
            final double to,
            final Map<Long, List<double[]>> damagesByVictim,
            final Map<Long, List<double[]>> unsupportedByVictim,
            final List<double[]> unsupportedUnresolved) {
        if (anyInWindow(unsupportedByVictim.get(victim), from, to)
                || anyInWindow(unsupportedUnresolved, from, to)) {
            return null;
        }
        Long sole = null;
        int count = 0;
        final List<double[]> damages = damagesByVictim.get(victim);
        if (damages != null) {
            for (final double[] d : damages) {
                if (!inWindow(d[0], from, to)) {
                    continue;
                }
                count++;
                final long attacker = (long) d[1];
                if (attacker <= 0 || attacker == victim) {
                    return null;
                }
                if (sole == null) {
                    sole = attacker;
                } else if (sole != attacker) {
                    return null;
                }
            }
        }
        return count > 0 ? sole : null;
    }

    public static Integer observedHpLossAt(final Result result, final long victimAccountId, final double timeSec) {
        for (final Loss l : result.lossesOf(victimAccountId)) {
            if (l.damageEventCount() == 1 && l.attackerReliable()
                    && timeSec > l.fromSec() + 1e-6 && timeSec <= l.toSec() + 1e-6) {
                return l.hpLoss();
            }
        }
        return null;
    }

    private static boolean anyInWindow(final List<double[]> events, final double fromT, final double toT) {
        if (events == null) {
            return false;
        }
        for (final double[] event : events) {
            if (inWindow(event[0], fromT, toT)) {
                return true;
            }
        }
        return false;
    }

    private static boolean inWindow(final double t, final double fromT, final double toT) {
        return t > fromT + 1e-6 && t <= toT + 1e-6;
    }

    private static boolean inBattle(final double t, final double duration) {
        return Double.isFinite(t) && t >= 0 && t <= duration + 1e-6;
    }

    private static double[] lethalLossWindow(
            final Map<Long, List<double[]>> samples,
            final long victim,
            final double destroyedT) {
        final List<double[]> raw = samples.get(victim);
        if (raw == null) {
            return null;
        }
        final List<double[]> list = collapseSameClockDuplicates(raw);
        for (int i = list.size() - 1; i >= 1; i--) {
            final double[] cur = list.get(i);
            if (Math.abs(cur[0] - destroyedT) > 1e-6) {
                continue;
            }
            final double[] prev = list.get(i - 1);
            if ((int) cur[1] == 0 && (int) prev[1] > 0) {
                return new double[]{prev[0], destroyedT};
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

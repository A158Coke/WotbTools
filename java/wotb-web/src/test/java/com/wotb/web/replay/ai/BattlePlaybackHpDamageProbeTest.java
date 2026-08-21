package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.dto.MapOverview;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 非 CI 手动探针：真实回放的 HP / DAMAGE 数据链路调查（docs/current-plan.md §37/§38）。
 *
 * <p>输出（stdout / surefire report）：</p>
 * <ul>
 *   <li>每辆车：accountId / nickname / tankId / tankName / team / tankType / tankopedia class /
 *       maxHp / entryHpSource / entryHp / 全部 hpSamples（type-7 propId=3，EXACT）</li>
 *   <li>全部 DAMAGE（raw Type-8 value）/ DESTROYED / KILL 事件（battle-relative 秒）</li>
 *   <li>HP change 交叉分析：同一车辆相邻可信 HP sample 的 derived delta vs 附近的
 *       Type-8 raw damage——验证 raw damage 是否等于真实 HP loss</li>
 * </ul>
 *
 * <p>Run: {@code mvn -pl wotb-web -am test -Dtest=BattlePlaybackHpDamageProbeTest
 * -Dprobe.replay=<file.wotbreplay> -DfailIfNoTests=false}</p>
 */
class BattlePlaybackHpDamageProbeTest {

    @Test
    void probe() throws Exception {
        final String path = System.getProperty("probe.replay");
        Assumptions.assumeTrue(path != null, "set -Dprobe.replay=<file>");
        final byte[] bytes = Files.readAllBytes(Path.of(path));
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new com.wotb.core.model.Source(Path.of(path).getFileName().toString(), bytes),
                        ReplayProcessingOptions.full());
        Assumptions.assumeTrue(result != null && result.battle() != null, "battle parse failed");
        final Battle battle = result.battle();
        final ReplayReconstruction recon = result.reconstruction();

        final PlayerResult recorder = battle.recorderResult();
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder != null && recorder.accountId > 0 ? recorder.accountId : null,
                        recorder != null ? recorder.team : 0));
        System.out.println("timeline usable=" + (tl != null && tl.usable())
                + (tl != null && !tl.usable() ? " errors=" + tl.validation().errors() : ""));
        if (tl == null || !tl.usable()) {
            return;
        }
        final BattleTimeline timeline = tl.timeline();
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final MapOverview.Playback playback = BattlePlaybackAdapter.build(battle, timeline, mapping);

        System.out.printf(Locale.ROOT,
                "battle map=%s duration=%.1fs players=%d recorderAcc=%d (team=%d)%n",
                battle.mapName, battle.durationS, battle.players.size(),
                recorder == null ? 0 : recorder.accountId,
                recorder == null ? 0 : recorder.team);
        System.out.println("playback duration=" + (playback == null ? null : playback.durationSec())
                + " vehicles=" + (playback == null ? 0 : playback.vehicles().size())
                + " events=" + (playback == null ? 0 : playback.events().size()));

        // ---- 车辆级信息 + 全部 hpSamples ----
        final Map<Long, MapOverview.PlaybackVehicle> byAccount = new HashMap<>();
        if (playback != null) {
            for (final MapOverview.PlaybackVehicle v : playback.vehicles()) {
                byAccount.put(v.accountId(), v);
                System.out.printf(Locale.ROOT,
                        "VEHICLE acc=%d tankId=%d tank=%-20s player=%-16s team=%d%n"
                                + "  tankType(player)=%s tankopediaClass=%s baseHp=%s observedCap=%s"
                                + " entrySrc=%s entryHp=%s%n"
                                + "  hpSamples=%d death=%s finalStats=dealt%d recv%d assist%d kills%d shots%d hits%d pens%d%n",
                        v.accountId(), v.tankId(), v.tankName(), v.playerName(), v.team(),
                        quote(v.tankType()),
                        com.wotb.core.ref.ReplayDisplayNames.tankClass(v.tankId()),
                        v.baseHp(), v.observedCapacityHp(),
                        v.entryHpSource(), v.entryHp(),
                        v.hpSamples().size(), v.deathSec(),
                        v.finalStats().damageDealt(), v.finalStats().damageReceived(),
                        v.finalStats().damageAssisted(), v.finalStats().kills(),
                        v.finalStats().nShots(), v.finalStats().nHitsDealt(),
                        v.finalStats().nPenetrationsDealt());
                final StringBuilder hp = new StringBuilder("  HP:");
                for (final MapOverview.HpSample s : v.hpSamples()) {
                    if (hp.length() > 16000) {
                        hp.append(" ...(truncated)");
                        break;
                    }
                    hp.append(String.format(Locale.ROOT, " [%.1f=%d]", s.timeSec(), s.hp()));
                }
                System.out.println(hp);
                System.out.println("  tankTypeFallback='" + com.wotb.core.ref.ReplayDisplayNames.tankClassEn(v.tankId()) + "'");
                final StringBuilder losses = new StringBuilder("  LOSSES:");
                for (final MapOverview.HpLoss l : v.hpLosses()) {
                    if (losses.length() > 16000) {
                        losses.append(" ...(truncated)");
                        break;
                    }
                    losses.append(String.format(Locale.ROOT,
                            " [%.1f->%.1f -%d attacker=%s attributed=%s]",
                            l.fromSec(), l.toSec(), l.hpLoss(),
                            l.attackerAccountId() == null ? "null" : l.attackerAccountId(),
                            l.attackerReliable()));
                }
                System.out.println(losses);
            }
        }

        // ---- 时间轴事件（DAMAGE/DESTROYED/KILL，battle-relative）----
        System.out.println("--- DAMAGE events (raw Type-8 value) ---");
        if (playback != null) {
            for (final MapOverview.PlaybackEvent ev : playback.events()) {
                if ("DAMAGE".equals(ev.type())) {
                    System.out.printf(Locale.ROOT,
                            "  t=%7.1f attacker=%d victim=%d raw=%d hpLoss=%s%n",
                            ev.timeSec(), ev.accountId() == null ? 0 : ev.accountId(),
                            ev.targetAccountId() == null ? 0 : ev.targetAccountId(),
                            ev.rawProtocolValue() == null ? -1 : ev.rawProtocolValue(),
                            ev.observedHpLoss());
                } else if ("DESTROYED".equals(ev.type()) || "KILL".equals(ev.type())) {
                    System.out.printf(Locale.ROOT, "  t=%7.1f %-9s acc=%d victim=%d%n",
                            ev.timeSec(), ev.type(),
                            ev.accountId() == null ? 0 : ev.accountId(),
                            ev.targetAccountId() == null ? 0 : ev.targetAccountId());
                }
            }
        }

        // ---- HP change 交叉分析（§38：derived HP delta vs nearby Type-8 raw）----
        System.out.println("--- HP change cross-analysis ---");
        if (playback != null) {
            for (final MapOverview.PlaybackVehicle v : playback.vehicles()) {
                final List<MapOverview.HpSample> samples = v.hpSamples();
                final List<MapOverview.PlaybackEvent> damages = new ArrayList<>();
                for (final MapOverview.PlaybackEvent ev : playback.events()) {
                    if ("DAMAGE".equals(ev.type())
                            && ev.targetAccountId() != null && ev.targetAccountId() == v.accountId()) {
                        damages.add(ev);
                    }
                }
                if (samples.size() < 2 && damages.isEmpty()) {
                    continue;
                }
                System.out.println("  VEHICLE acc=" + v.accountId() + " tank=" + v.tankName());
                MapOverview.HpSample prev = null;
                for (final MapOverview.HpSample s : samples) {
                    if (prev != null && s.hp() < prev.hp()) {
                        final int delta = prev.hp() - s.hp();
                        final List<String> near = new ArrayList<>();
                        for (final MapOverview.PlaybackEvent d : damages) {
                            if (d.timeSec() >= prev.timeSec() - 0.5 && d.timeSec() <= s.timeSec() + 0.5) {
                                near.add(String.format(Locale.ROOT, "t=%.1f raw=%d", d.timeSec(),
                            d.rawProtocolValue() == null ? -1 : d.rawProtocolValue()));
                            }
                        }
                        System.out.printf(Locale.ROOT,
                                "    HP %.1f(%d) -> %.1f(%d) delta=%d nearbyRawDamage=%s%n",
                                prev.timeSec(), prev.hp(), s.timeSec(), s.hp(), delta, near.isEmpty() ? "NONE" : near);
                    }
                    prev = s;
                }
            }
        }

        // ---- HealthChangedEvent 原始置信度分布（EXACT vs PARTIAL vs UNKNOWN）----
        if (recon != null && recon.events() != null) {
            final Map<String, Integer> conf = new HashMap<>();
            for (final ReplayEvent ev : recon.events()) {
                if (ev instanceof HealthChangedEvent hp) {
                    final String k = hp.confidence() == null ? "null" : hp.confidence().name();
                    conf.merge(k, 1, Integer::sum);
                }
            }
            System.out.println("HealthChangedEvent confidence distribution=" + conf);
            final Map<Integer, Integer> destroyedByEntity = new HashMap<>();
            for (final ReplayEvent ev : recon.events()) {
                if (ev instanceof VehicleDestroyedEvent d) {
                    destroyedByEntity.merge(d.entityId(), 1, Integer::sum);
                }
            }
            System.out.println("VehicleDestroyedEvent count=" + destroyedByEntity.size());
        }
    }

    private static String quote(final String s) {
        return s == null || s.isEmpty() ? "''" : "'" + s + "'";
    }
}
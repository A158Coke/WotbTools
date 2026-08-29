package com.wotb.core;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.util.PlayerResultFormat;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

/**
 * IS-4 假死调查探针（手动维护，不进常规 CI）：
 * 运行方式 {@code mvn -pl wotb-core test -Dtest=Is4DeathProbeTest -Dprobe.dir=<dir>} 或
 * {@code -Dprobe.replay=<single file>}。
 *
 * <p>输出：每场 roster（结算存活/死亡时刻）+ 每实体事件时间线；定位 IS-4 (tankId=6145)
 * 并打印其 HP/移除/伤害/位置/方向完整时间线，用于验证「约 01:51 被误判阵亡」。</p>
 */
class Is4DeathProbeTest {

    private static final long IS4_TANK_ID = 6145L;

    @Test
    void probe() throws Exception {
        final String replay = System.getProperty("probe.replay");
        final String dir = System.getProperty("probe.dir");
        Assumptions.assumeTrue(replay != null || dir != null,
                "set -Dprobe.replay=<file> or -Dprobe.dir=<dir> to run");

        final List<Path> files = new ArrayList<>();
        if (replay != null) {
            files.add(Path.of(replay));
        }
        if (dir != null) {
            try (Stream<Path> s = Files.walk(Path.of(dir))) {
                s.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted(Comparator.comparing(Path::toString))
                        .forEach(files::add);
            }
        }

        for (final Path f : files) {
            System.out.println("\n################ " + f.getFileName() + " ################");
            try {
                probeOne(f);
            } catch (Exception e) {
                System.out.println("  PROBE ERROR: " + e);
            }
        }
    }

    private void probeOne(final Path f) throws Exception {
        final byte[] bytes = Files.readAllBytes(f);
        final DefaultReplayProcessingFacade facade = new DefaultReplayProcessingFacade();
        final ReplayProcessingResult result = facade.process(
                new Source(f.getFileName().toString(), bytes), ReplayProcessingOptions.full());

        if (result.battle() == null) {
            System.out.println("  no battle (status=" + result.status() + " err=" + result.error() + ")");
            return;
        }
        final var battle = result.battle();
        System.out.println("  map=" + battle.mapName + " durS=" + battle.durationS
                + " bonusType=" + battle.arenaBonusType + " winner=" + battle.winnerTeam
                + " rosterComplete=" + battle.rosterComplete
                + " recorder=" + battle.recorder + " recorderVehicle=" + battle.recorderVehicle);
        System.out.println("  -- roster (settlement) --");
        for (final PlayerResult p : battle.players) {
            final double dSec = PlayerResultFormat.deathSec(p);
            System.out.printf(Locale.ROOT,
                    "    acc=%d nick=%-16s tank=%-14s(%d) team=%d survived=%s deathMs=%d survivalSec=%.1f deathSec=%.1f dmgRecv=%d%n",
                    p.accountId, p.nickname, p.tankName, p.tankId, p.team,
                    p.survived, p.deathTimeMillis, p.survivalTimeSec, dSec, p.damageReceived);
        }

        final var recon = result.reconstruction();
        if (recon == null) {
            System.out.println("  no reconstruction (reconError=" + result.reconstructionError() + ")");
            return;
        }

        // entity → account 映射
        final Map<Integer, Long> eidToAcc = new HashMap<>();
        for (final ReplayEvent ev : recon.events()) {
            if (ev instanceof ParticipantMappingEvent pm && pm.accountId() > 0) {
                eidToAcc.put(pm.entityId(), pm.accountId());
            }
        }
        final Map<Long, Integer> accToEid = new HashMap<>();
        for (final Map.Entry<Integer, Long> e : eidToAcc.entrySet()) {
            accToEid.put(e.getValue(), e.getKey());
        }

        // 定位 IS-4 的 entityId（结算 tankId=6145 的账号 → entity）
        final List<PlayerResult> is4players = battle.players.stream()
                .filter(p -> p.tankId == IS4_TANK_ID).toList();
        System.out.println("  -- IS-4 players --");
        for (final PlayerResult p : is4players) {
            final Integer eid = accToEid.get(p.accountId);
            System.out.println("    acc=" + p.accountId + " nick=" + p.nickname
                    + " eid=" + eid + " survived=" + p.survived
                    + " deathSec=" + PlayerResultFormat.deathSec(p));
            if (eid != null) {
                printEntityTimeline(recon.events(), eid);
            }
        }
        if (is4players.isEmpty()) {
            System.out.println("    (no IS-4 in this replay)");
        }
        // ---- 全玩家 HP 证据死亡时刻 vs 估算 deathSec 对比 ----
        System.out.println("  -- per-player HP-evidence death time vs estimated deathSec --");
        for (final PlayerResult p : battle.players) {
            if (p.survived || p.accountId <= 0) {
                continue;
            }
            final Integer eid = accToEid.get(p.accountId);
            Double evid = null;
            if (eid != null) {
                evid = evidenceDeathTime(recon.events(), eid, battleStartRaw(recon));
            }
            System.out.printf(Locale.ROOT, "    acc=%d tank=%d estimated=%.1f hpEvidence=%s%n",
                    p.accountId, p.tankId, PlayerResultFormat.deathSec(p),
                    evid == null ? "-" : String.format(Locale.ROOT, "%.2f", evid));
        }
    }

    /** 该实体最后一次 EXACT alive=false (HP=0) 事件的 battle-relative 秒；无则 null。 */
    private static Double evidenceDeathTime(
            final List<ReplayEvent> events, final int eid, final Float battleStartRawClockSec) {
        Double last = null;
        for (final ReplayEvent ev : events) {
            if (ev instanceof HealthChangedEvent h && h.entityId() == eid
                    && h.alive() != null && !h.alive()
                    && h.confidence() == com.wotb.core.replay.event.DecodeConfidence.EXACT) {
                final float raw = h.timestamp().rawClockSec();
                final double t = battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)
                        ? raw - battleStartRawClockSec : raw;
                if (t > 0 && (last == null || t > last)) {
                    last = t;
                }
            }
        }
        return last;
    }

    private static Float battleStartRaw(final com.wotb.core.replay.reconstruction.ReplayReconstruction recon) {
        return recon.battleStartRawClockSec();
    }

    private void printEntityTimeline(final List<ReplayEvent> events, final int eid) {
        final List<String> lines = new ArrayList<>();
        int hpCount = 0, posCount = 0, turCount = 0, dmgVictim = 0, leaves = 0;
        float firstPos = -1f, lastPos = -1f;
        for (final ReplayEvent ev : events) {
            switch (ev) {
                case HealthChangedEvent h when h.entityId() == eid -> {
                    hpCount++;
                    lines.add(String.format(Locale.ROOT,
                            "      HP @%8.2fs seq=%d conf=%s hp=%s max=%s alive=%s",
                            h.timestamp().rawClockSec(), h.sequence(), h.confidence(),
                            h.currentHealth(), h.maxHealth(), h.alive()));
                }
                case EntityRemovedEvent r when r.entityId() == eid -> {
                    leaves++;
                    lines.add(String.format(Locale.ROOT,
                            "      LEAVE @%8.2fs seq=%d", r.timestamp().rawClockSec(), r.sequence()));
                }
                case DamageEvent d when d.victimEid() == eid -> {
                    dmgVictim++;
                    lines.add(String.format(Locale.ROOT,
                            "      DMG-RECV @%8.2fs seq=%d attacker=%d dmg=%d",
                            d.timestamp().rawClockSec(), d.sequence(), d.attackerEid(), d.damage()));
                }
                case PositionChangedEvent p when p.entityId() == eid -> {
                    posCount++;
                    if (firstPos < 0) firstPos = p.timestamp().rawClockSec();
                    lastPos = p.timestamp().rawClockSec();
                }
                case TurretDirectionChangedEvent t when t.entityId() == eid -> turCount++;
                default -> { }
            }
        }
        System.out.println("    entity " + eid + ": hpEvents=" + hpCount
                + " posEvents=" + posCount + " (first=" + firstPos + " last=" + lastPos + ")"
                + " turretEvents=" + turCount + " dmgReceivedEvents=" + dmgVictim + " leaves=" + leaves);
        lines.forEach(System.out::println);
        if (hpCount == 0 && leaves == 0 && dmgVictim == 0) {
            System.out.println("      (no HP/leave/damage events for this entity)");
        }
    }
}
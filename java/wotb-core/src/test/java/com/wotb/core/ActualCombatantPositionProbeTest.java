
package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.PickleReader;
import com.wotb.core.parse.Protobuf;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.feature.BattleStartResolution;
import com.wotb.core.replay.feature.BattleStartResolver;
import com.wotb.core.replay.feature.DefaultTeamBattleFeatureExtractor;
import com.wotb.core.replay.feature.TacticalTimeResolution;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.util.PlayerResultFormat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * PR #103 调查探针（临时诊断，不修改业务逻辑）：
 * 对真实回放输出 actual combatant（#301）/ broad roster（#201 / event entities）/
 * spectator 生命周期 / friendly position coverage / PositionChanged change-driven 证据。
 * <p>运行：cd java &amp;&amp; mvn -s settings.xml test -Dtest=ActualCombatantPositionProbeTest
 * -Dsurefire.failIfNoSpecifiedTests=false（无样本自动跳过）。</p>
 */
@Tag("probe")
@Tag("manual")
class ActualCombatantPositionProbeTest {

    @Test
    void probe() throws Exception {
        final List<Path> samples = discoverSamples();
        Assumptions.assumeTrue(!samples.isEmpty(),
                "未发现任何回放样本（common/fixtures 缺失或 common/data 为空）——探针自动跳过");
        for (final Path file : samples) {
            System.out.println("\n########## SAMPLE: " + file.getFileName() + " ##########");
            try {
                runSample(file);
            } catch (final Exception e) {
                System.out.println("  [sample error] " + e);
            }
        }
    }

    private static List<Path> discoverSamples() throws Exception {
        final List<Path> dirs = new ArrayList<>();
        final Path moduleDir = Path.of(System.getProperty("user.dir"));
        final Path fixtures = moduleDir.resolve("../../common/fixtures/replays").normalize();
        final Path data = moduleDir.resolve("../../common/data").normalize();
        if (Files.isDirectory(fixtures)) {
            dirs.add(fixtures);
        }
        if (Files.isDirectory(data)) {
            dirs.add(data);
        }
        final List<Path> out = new ArrayList<>();
        for (final Path dir : dirs) {
            try (var stream = Files.list(dir)) {
                stream.filter(p -> p.toString().toLowerCase().endsWith(".wotbreplay"))
                        .sorted(Comparator.comparing(Path::getFileName))
                        .forEach(out::add);
            }
        }
        return out;
    }

    private static void runSample(final Path file) throws Exception {
        final byte[] bytes = Files.readAllBytes(file);
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final TeamPerspectiveResolution perspective = TeamPerspectiveResolver.resolve(battle, recon);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final BattleStartResolution battleStart = BattleStartResolver.resolve(
                recon.battleStartRawClockSec(), recon.diagnostics(), recon.events(), battle);

        final int perspectiveTeam = perspective.perspectiveTeam() != null
                ? perspective.perspectiveTeam() : 0;

        System.out.println("== 基本信息 ==");
        System.out.println("map=" + battle.mapName + " arenaBonusType=" + battle.arenaBonusType
                + " duration=" + battle.durationS + " recorder=" + battle.recorder
                + " recorderTeam=" + perspectiveTeam
                + " rosterComplete=" + battle.rosterComplete
                + " battleStartStatus=" + battleStart.status()
                + " battleStartRaw=" + battleStart.battleStartRawClockSec());

        // ---- raw #201 / #301 from battle_results.dat ----
        final RawRoster raw = readRawRoster(bytes);
        System.out.println("== #301 actual combatants (" + raw.results301().size() + ") ==");
        for (final RawPlayer rp : raw.results301()) {
            System.out.println("  acc=" + rp.accountId + " nick='" + rp.nickname + "' team=" + rp.team
                    + " tank=" + rp.tankId + " survived=" + rp.survived + " deathSec=" + rp.deathSec);
        }
        final Set<Long> combatantAccounts = new LinkedHashSet<>();
        raw.results301().forEach(rp -> combatantAccounts.add(rp.accountId));
        final Set<Long> rosterAccounts201 = new LinkedHashSet<>();
        raw.roster201().forEach(rp -> rosterAccounts201.add(rp.accountId));
        final Set<Long> extra201 = new LinkedHashSet<>(rosterAccounts201);
        extra201.removeAll(combatantAccounts);
        System.out.println("== #201 roster accounts = " + rosterAccounts201.size()
                + " | #201 - #301 (potential non-combatants) = " + extra201.size());
        for (final long acc : extra201) {
            final RawPlayer rp = raw.roster201().stream().filter(p -> p.accountId == acc).findFirst().orElse(null);
            System.out.println("  EXTRA #201 acc=" + acc + " nick='" + (rp == null ? "" : rp.nickname)
                    + "' team=" + (rp == null ? "?" : rp.team));
        }

        // ---- event stream entities ----
        final Map<Integer, EntityStats> entityStats = collectEntityStats(recon, battleStart, mapping);
        System.out.println("== event-stream entities = " + entityStats.size() + " ==");


        // ---- entity lifecycle + mapping trace (spectator detection) ----
        System.out.println("== entity lifecycle / mapping trace ==");
        for (final Map.Entry<Integer, EntityStats> entry : entityStats.entrySet()) {
            final EntityStats es = entry.getValue();
            final StringBuilder sb = new StringBuilder();
            sb.append("  eid=").append(entry.getKey())
                    .append(" created=").append(es.createdSec == null ? "-" : String.format("%.1f", es.createdSec))
                    .append(" leaves=").append(es.leaves.isEmpty() ? "-"
                            : es.leaves.stream().map(lv -> String.format("%.1f", lv)).toList())
                    .append(" mappedAccount=").append(es.mappedAccount == 0 ? "-" : es.mappedAccount)
                    .append(" firstPosSec=").append(es.firstUsableSec == null ? "-" : String.format("%.1f", es.firstUsableSec))
                    .append(" lastPosSec=").append(es.lastUsableSec == null ? "-" : String.format("%.1f", es.lastUsableSec));
            System.out.println(sb);
        }
        final Set<Long> mappedAccounts = new LinkedHashSet<>();
        for (final ReplayEvent event : recon.events()) {
            if (event instanceof ParticipantMappingEvent pm) {
                mappedAccounts.add(pm.accountId());
            }
        }
        final Set<Long> combatantOnly = new LinkedHashSet<>(mappedAccounts);
        combatantOnly.removeAll(combatantAccounts);
        final Set<Long> mappedButNot301 = new LinkedHashSet<>(mappedAccounts);
        mappedButNot301.removeAll(combatantAccounts);
        System.out.println("  mappingEvents accountIds total=" + mappedAccounts.size()
                + " mappedButNot#301=" + mappedButNot301.size() + " -> " + mappedButNot301);

        // ---- friendly actual combatant analysis ----
        final int friendlyTeam = perspectiveTeam;
        final List<PlayerResult> friendlyCombatants = battle.players == null ? List.of()
                : battle.players.stream().filter(p -> p != null && p.team == friendlyTeam).toList();
        System.out.println("== friendly #301 combatants: " + friendlyCombatants.size() + " ==");
        int friendlyMapped = 0;
        int friendlyWithUsablePosition = 0;
        double overallMaxGap = 0;
        for (final PlayerResult p : friendlyCombatants) {
            final List<Integer> eids = mapping.entityIds(p.accountId, p.nickname);
            final boolean mapped = !eids.isEmpty();
            if (mapped) {
                friendlyMapped++;
            }
            double maxGap = 0;
            int posCount = 0;
            int preBattleCount = 0;
            int outOfBoundsCount = 0;
            Double firstPos = null;
            Double lastPos = null;
            final List<String> gaps = new ArrayList<>();
            double prevT = Double.NaN;
            float prevX = 0, prevZ = 0;
            Double lastLeaveAt = null;
            for (final int eid : eids) {
                final EntityStats es = entityStats.get(eid);
                if (es == null) {
                    continue;
                }
                if (es.lastLeaveSec != null && (lastLeaveAt == null || es.lastLeaveSec > lastLeaveAt)) {
                    lastLeaveAt = es.lastLeaveSec;
                }
                final List<PositionChangedEvent> usable = es.usablePositions;
                for (final PositionChangedEvent pos : usable) {
                    final float t = es.usableSec.get(pos);
                    posCount++;
                    if (firstPos == null || t < firstPos) {
                        firstPos = (double) t;
                    }
                    if (lastPos == null || t > lastPos) {
                        lastPos = (double) t;
                    }
                    if (!Double.isNaN(prevT)) {
                        final double gap = t - prevT;
                        if (gap > maxGap) {
                            maxGap = gap;
                        }
                        final double dist = Math.hypot(pos.x() - prevX, pos.z() - prevZ);
                        if (gap > 5.0 && dist < 1.0) {
                            final double prevTForLambda = prevT;
                            final double tForLambda = t;
                            final List<String> leaveBetween = es.leaves.stream()
                                    .filter(lv -> lv >= prevTForLambda - 1e-6 && lv <= tForLambda + 1e-6)
                                    .map(lv -> String.format("%.1f", lv)).toList();
                            gaps.add(String.format("  gap=%.1fs [%.1fs->%.1fs] sameXY(dist=%.1fm) leaveBetween=%s",
                                    gap, prevT, t, dist, leaveBetween));
                        }
                    }
                    prevT = t;
                    prevX = pos.x();
                    prevZ = pos.z();
                }
                preBattleCount += es.preBattleCount;
                outOfBoundsCount += es.outOfBoundsCount;
            }
            final boolean hasUsable = posCount > 0;
            if (hasUsable) {
                friendlyWithUsablePosition++;
            }
            if (maxGap > overallMaxGap) {
                overallMaxGap = maxGap;
            }
            System.out.println("  member acc=" + p.accountId + " nick='" + p.nickname + "' tank=" + p.tankId
                    + " entityIds=" + eids + " mapped=" + mapped
                    + " usablePositions=" + posCount + " preBattlePositions=" + preBattleCount
                    + " outOfBounds=" + outOfBoundsCount
                    + " firstPosSec=" + (firstPos == null ? "-" : String.format("%.1f", firstPos))
                    + " lastPosSec=" + (lastPos == null ? "-" : String.format("%.1f", lastPos))
                    + " maxGapSec=" + String.format("%.1f", maxGap)
                    + " leaveSec=" + (lastLeaveAt == null ? "-" : String.format("%.1f", lastLeaveAt))
                    + " deathSec=" + (p.survived || PlayerResultFormat.deathSec(p) <= 0 ? "-" : String.format("%.1f", PlayerResultFormat.deathSec(p))));
            for (final String g : gaps) {
                System.out.println("      " + g);
            }
        }
        System.out.println("friendly mapped = " + friendlyMapped + "/" + friendlyCombatants.size()
                + " | with >=1 usable position = " + friendlyWithUsablePosition + "/" + friendlyCombatants.size()
                + " | overallMaxGapSec=" + String.format("%.1f", overallMaxGap));
        // 协议契约硬断言（PR #103）：正常 replay 下 actual friendly combatant 必须 100% 映射 + 100% 有可用位置；
        // spectator/non-#301 实体不得影响 actual combatant position coverage。
        assertEquals(friendlyCombatants.size(), friendlyMapped,
                "actual friendly combatant 必须全部建立 entity mapping: " + file.getFileName());
        // PR147: battle-relative position only assertable when battle clock resolves (wrapper3 BATTLE /
        // method4 RoundFinished). 无该锚点 → BattleStartResolver 正确返回 UNRESOLVED（fail-closed，不得用
        // Type14 stream-close / raw clock 冒充 battle start），此时位置覆盖断言降级为 fail-closed。
        if (battleStart.resolved()) {
            assertEquals(friendlyCombatants.size(), friendlyWithUsablePosition,
                    "actual friendly combatant 必须全部有 >=1 usable position: " + file.getFileName());
        } else {
            System.out.println("   [fail-closed] battle clock UNRESOLVED（无 wrapper3 BATTLE / method4）→ "
                    + "跳过 battle-relative usable-position 硬断言 (file=" + file.getFileName() + ")");
        }

        // ---- non-combatant / spectator entity analysis ----
        System.out.println("== non-#301 event entities ==");
        int nonCombatantWithPosition = 0;
        for (final Map.Entry<Integer, EntityStats> entry : entityStats.entrySet()) {
            final EntityStats es = entry.getValue();
            if (es.combatant) {
                continue;
            }
            final StringBuilder sb = new StringBuilder();
            sb.append("  eid=").append(entry.getKey());
            if (es.identity != null) {
                sb.append(" identity(acc=").append(es.identity.accountId())
                        .append(" nick='").append(es.identity.nickname())
                        .append("' team=").append(es.identity.team())
                        .append(" usable=").append(es.identity.usable()).append(")");
            } else {
                sb.append(" identity=null");
            }
            sb.append(" created=").append(es.createdSec == null ? "-" : String.format("%.1f", es.createdSec))
                    .append(" leaves=").append(es.leaves.isEmpty() ? "-"
                            : es.leaves.stream().map(lv -> String.format("%.1f", lv)).toList())
                    .append(" positions(total=").append(es.allPositions.size())
                    .append(" usable=").append(es.usablePositions.size())
                    .append(" preBattle=").append(es.preBattleCount).append(")")
                    .append(" in#301=").append(es.combatant);
            if (es.usablePositions.size() > 0 || es.preBattleCount > 0) {
                nonCombatantWithPosition++;
            }
            System.out.println(sb);
        }
        System.out.println("non-#301 entities with any position: " + nonCombatantWithPosition);

        // ---- extractor limitations ----
        final TeamBattleFeatureSet features = new DefaultTeamBattleFeatureExtractor()
                .extract(battle, recon, perspective);
        System.out.println("== TeamBattleFeatureSet ==");
        System.out.println("  coverage.mappedMembers=" + features.coverage().mappedMemberCount()
                + " observedPositionEventCount=" + features.coverage().observedPositionEventCount()
                + " unattributedPositionCount=" + features.coverage().unattributedPositionEventCount()
                + " outOfBoundsPositionCount=" + features.coverage().ignoredOutOfBoundsPositionEventCount()
                + " authoritativeMembers=" + features.coverage().authoritativeMemberCount());
        System.out.println("  limitations=" + features.limitations());
        System.out.println("  memberCount=" + features.members().size());
        for (final var m : features.members()) {
            System.out.println("    member " + m.accountId() + " '" + m.nickname() + "' entityIds=" + m.entityIds()
                    + " limitations=" + m.limitations() + " movements=" + m.movements().size());
        }
        final List<Long> memberAccounts = features.members().stream().map(m -> m.accountId()).sorted().toList();
        final List<Long> combatantAccountsSorted = friendlyCombatants.stream()
                .map(p -> p.accountId).sorted().toList();
        System.out.println("  authoritativeMemberAccounts=" + combatantAccountsSorted);
        System.out.println("  featureMemberAccounts=" + memberAccounts);
    }

    private static Map<Integer, EntityStats> collectEntityStats(
            final ReplayReconstruction recon,
            final BattleStartResolution battleStart,
            final TeamEntityMapping mapping) {
        final Map<Integer, EntityStats> stats = new LinkedHashMap<>();
        for (final ReplayEvent event : recon.events()) {
            if (event instanceof EntityCreatedEvent created) {
                stats.computeIfAbsent(created.entityId(), EntityStats::new)
                        .createdSec = battleStart.tryRelative(created.timestamp()).battleRelativeSec();
            } else if (event instanceof EntityRemovedEvent removed) {
                final TacticalTimeResolution res = battleStart.tryRelative(removed.timestamp());
                final float sec = res.isUsable() ? res.battleRelativeSec() : removed.timestamp().rawClockSec();
                stats.computeIfAbsent(removed.entityId(), EntityStats::new)
                        .leaves.add((double) sec);
            } else if (event instanceof PositionChangedEvent pos) {
                final EntityStats es = stats.computeIfAbsent(pos.entityId(), EntityStats::new);
                es.allPositions.add(pos);
                final TacticalTimeResolution res = battleStart.tryRelative(pos.timestamp());
                if (res.isUsable()) {
                    es.usablePositions.add(pos);
                    es.usableSec.put(pos, res.battleRelativeSec());
                    if (es.firstUsableSec == null || res.battleRelativeSec() < es.firstUsableSec) {
                        es.firstUsableSec = (double) res.battleRelativeSec();
                    }
                    if (es.lastUsableSec == null || res.battleRelativeSec() > es.lastUsableSec) {
                        es.lastUsableSec = (double) res.battleRelativeSec();
                    }
                } else if (res.status() == TacticalTimeResolution.Status.PRE_BATTLE) {
                    es.preBattleCount++;
                }
            } else if (event instanceof ParticipantMappingEvent pm) {
                stats.computeIfAbsent(pm.entityId(), EntityStats::new)
                        .mappedAccount = pm.accountId();
            }
        }
        // fill identity + combatant flags
        for (final Map.Entry<Integer, EntityStats> entry : stats.entrySet()) {
            final EntityStats es = entry.getValue();
            es.identity = mapping.identity(entry.getKey());
            es.combatant = es.identity != null && es.identity.accountId() > 0;
        }
        // out-of-bounds & lastLeave
        for (final EntityStats es : stats.values()) {
            for (final PositionChangedEvent p : es.usablePositions) {
                if (Math.abs(p.y()) > 500f) {
                    es.outOfBoundsCount++;
                }
            }
            if (!es.leaves.isEmpty()) {
                es.lastLeaveSec = es.leaves.get(es.leaves.size() - 1);
            }
        }
        return stats;
    }

    private static RawRoster readRawRoster(final byte[] replayBytes) throws Exception {
        final Map<String, byte[]> entries = ReplayArchiveReader.read(replayBytes);
        final byte[] dat = entries.get("battle_results.dat");
        final Object pickle = PickleReader.loads(dat);
        final List<RawPlayer> roster201 = new ArrayList<>();
        final List<RawPlayer> results301 = new ArrayList<>();
        if (pickle instanceof Object[] tuple && tuple.length == 2 && tuple[1] instanceof byte[] pb) {
            final Map<Integer, List<Object>> root = Protobuf.decode(pb);
            for (final Object praw : root.getOrDefault(201, List.of())) {
                if (praw instanceof byte[] playerBytes) {
                    final Map<Integer, List<Object>> p = Protobuf.decode(playerBytes);
                    final long acc = Protobuf.firstLong(p, 1, 0);
                    final Map<Integer, List<Object>> info = Protobuf.message(p, 2);
                    final String nick = Protobuf.string(info, 1);
                    final Object team = Protobuf.first(info, 3);
                    roster201.add(new RawPlayer(acc, nick, team instanceof Number ? ((Number) team).intValue() : 0, 0));
                }
            }
            for (final Object rraw : root.getOrDefault(301, List.of())) {
                if (rraw instanceof byte[] resultBytes) {
                    final Map<Integer, List<Object>> r = Protobuf.decode(resultBytes);
                    final Map<Integer, List<Object>> info = Protobuf.message(r, 2);
                    final long acc = Protobuf.firstLong(info, 101, 0);
                    final int team = (int) Protobuf.firstLong(info, 102, 0);
                    final long tank = Protobuf.firstLong(info, 103, 0);
                    final Object survived = Protobuf.first(info, 105);
                    final boolean alive = (survived instanceof Number) && ((Number) survived).longValue() == -1L;
                    final long deathMs = Protobuf.firstLong(info, 104, 0);
                    final String nick = Protobuf.string(info, 1);
                    results301.add(new RawPlayer(acc, nick, team, tank, alive, deathMs / 1000.0));
                }
            }
        }
        return new RawRoster(roster201, results301);
    }

    private record RawRoster(List<RawPlayer> roster201, List<RawPlayer> results301) {
    }

    private record RawPlayer(long accountId, String nickname, int team, long tankId, boolean survived, double deathSec) {
        RawPlayer(long accountId, String nickname, int team, long tankId) {
            this(accountId, nickname, team, tankId, false, 0);
        }
    }

    private static final class EntityStats {
        final int entityId;
        final List<PositionChangedEvent> allPositions = new ArrayList<>();
        final List<PositionChangedEvent> usablePositions = new ArrayList<>();
        final Map<PositionChangedEvent, Float> usableSec = new HashMap<>();
        final List<Double> leaves = new ArrayList<>();
        Float createdSec;
        Double lastLeaveSec;
        long mappedAccount;
        Double firstUsableSec;
        Double lastUsableSec;
        TeamEntityIdentity identity;
        boolean combatant;
        int preBattleCount;
        int outOfBoundsCount;

        EntityStats(final int entityId) {
            this.entityId = entityId;
        }
    }
}

package com.wotb.web.replay;

import com.wotb.core.league.LeagueFailure;
import com.wotb.core.league.LeagueRatingBatchAggregator;
import com.wotb.core.league.LeagueRatingCalculator;
import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueRatingValidator;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.parse.EventStreamReader;
import com.wotb.core.parse.PickleReader;
import com.wotb.core.parse.Protobuf;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.parse.ReplayParser;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;

/**
 * 真实回放 roster/结算完整性 probe（可重复运行，无样本自动跳过）：
 * 对每份样本输出 #201（名册）/ #301（结算）/ Type0（basePlayerCreate arena info
 * accountDatabaseIds）三套账号集合的计数与两两差集，以及当前 parser 的 rosterComplete
 * 与 LeagueRatingValidator 失败码——用于证明「#201 全集合 == #301 全集合」是否为
 * 错误 schema assumption（plan：名册可含 non-combatant，actual combatant = #301）。
 */
class RosterCompletenessProbeTest {

    private static final List<String> SAMPLES = List.of(
            "fixtures/replays/random-battle-example.wotbreplay",
            "fixtures/hall-of-fame/training-room-example.wotbreplay",
            "data/20260725_1535__CHRD-A158布丁_A178_SPHT_9036183479040937(2).wotbreplay",
            "data/20260725_1600__CHRD-A158布丁_A178_SPHT_9034890693886323.wotbreplay",
            "data/20260725_1555__CHRD-A158布丁_A178_SPHT_12142703259467849.wotbreplay",
            "data/20260725_1604__CHRD-A158布丁_A178_SPHT_12142600180253313.wotbreplay",
            "data/20260808_1608__CHRD-A158布丁_Maus_13102443767740493.wotbreplay");

    @Test
    void probeRosterCompletenessAcrossRealSamples() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        int analyzed = 0;
        for (final String rel : SAMPLES) {
            final Path file = common.resolve(rel);
            if (!Files.exists(file)) {
                System.out.println("\n===== SKIP（样本缺失）: " + rel);
                continue;
            }
            final byte[] bytes = Files.readAllBytes(file);
            try {
                print(rel, bytes);
                analyzed++;
            } catch (final Exception e) {
                System.out.println("\n===== PROBE_FAIL " + rel + " : " + e.getMessage());
            }
        }
        System.out.println("\n===== analyzed=" + analyzed + " / " + SAMPLES.size());
    }

    private static void print(final String rel, final byte[] bytes) throws Exception {
        final Battle battle = ReplayParser.parse(bytes);
        final Map<String, byte[]> entries = ReplayArchiveReader.read(bytes);
        final Object pickle = PickleReader.loads(entries.get("battle_results.dat"));
        final Object[] tuple = (Object[]) pickle;
        final byte[] pb = (byte[]) tuple[1];
        final Map<Integer, List<Object>> root = Protobuf.decode(pb);

        // #201 名册账号（含 non-combatant）
        final Set<Long> rosterAccounts = new TreeSet<>();
        for (final Object praw : root.getOrDefault(201, List.of())) {
            if (!(praw instanceof byte[] playerBytes)) {
                continue;
            }
            rosterAccounts.add(Protobuf.firstLong(Protobuf.decode(playerBytes), 1, 0));
        }
        // #301 结算账号
        final Set<Long> resultAccounts = new TreeSet<>();
        final List<Integer> teams = new ArrayList<>();
        for (final Object rraw : root.getOrDefault(301, List.of())) {
            if (!(rraw instanceof byte[] resultBytes)) {
                continue;
            }
            final Map<Integer, List<Object>> r = Protobuf.decode(resultBytes);
            final Map<Integer, List<Object>> info = Protobuf.message(r, 2);
            resultAccounts.add(Protobuf.firstLong(info, 101, 0));
            teams.add((int) Protobuf.firstLong(info, 102, 0));
        }
        // Type0 basePlayerCreate arena info
        final Set<Long> type0Accounts = new TreeSet<>();
        final byte[] eventData = entries.get("data.wotreplay");
        if (eventData != null) {
            try {
                final EventStreamReader.ArenaInfo info =
                        EventStreamReader.extractArenaInfo(EventStreamReader.read(eventData).packets);
                if (info != null && info.accountDatabaseIds() != null) {
                    type0Accounts.addAll(info.accountDatabaseIds());
                }
            } catch (final Exception ignored) {
            }
        }

        final Set<Long> rosterExtra = diff(rosterAccounts, resultAccounts);
        final Set<Long> resultMissingInRoster = diff(resultAccounts, rosterAccounts);
        final Set<Long> type0Extra = diff(type0Accounts, resultAccounts);
        final Set<Long> resultMissingInType0 = diff(resultAccounts, type0Accounts);

        int team1 = 0;
        int team2 = 0;
        int missingTank = 0;
        int missingDeathTime = 0;
        for (final PlayerResult p : battle.players) {
            if (p.team == 1) {
                team1++;
            } else if (p.team == 2) {
                team2++;
            }
            if (p.tankId == 0) {
                missingTank++;
            }
            if (!p.survived && !(p.survivalTimeSec > 0)) {
                missingDeathTime++;
            }
        }
        final List<LeagueFailure> failures = LeagueRatingValidator.validate(battle);
        final String firstCode = failures.isEmpty() ? "PASS" : failures.getFirst().code();

        System.out.println("\n===== " + rel);
        System.out.println("arenaId=" + battle.arenaId + " arenaBonusType=" + battle.arenaBonusType
                + " version=" + battle.version + " map=" + battle.mapName + " winnerTeam=" + battle.winnerTeam
                + " durationS=" + battle.durationS);
        System.out.println("#201=" + rosterAccounts.size() + " #301=" + resultAccounts.size()
                + " (team1=" + team1 + ", team2=" + team2 + ") type0=" + type0Accounts.size());
        System.out.println("#301 unique=" + resultAccounts.size() + " (players.size=" + battle.players.size() + ")");
        System.out.println("rosterComplete(current)=" + battle.rosterComplete
                + " validatorFirstCode=" + firstCode + " failures=" + failures.stream().map(LeagueFailure::code).toList());
        System.out.println("rosterExtra(#201-#301)=" + rosterExtra);
        System.out.println("resultMissingInRoster(#301-#201)=" + resultMissingInRoster);
        System.out.println("type0Extra(type0-#301)=" + type0Extra);
        System.out.println("resultMissingInType0(#301-type0)=" + resultMissingInType0);
        System.out.println("missingTank=" + missingTank + " missingDeathTime=" + missingDeathTime);
    }

    private static Set<Long> diff(final Set<Long> a, final Set<Long> b) {
        final Set<Long> out = new LinkedHashSet<>(a);
        out.removeAll(b);
        return out;
    }

    /**
     * 用户批次冠军赛回放批量验证（common/34冠军赛回放，gitignore 本地样本；无文件自动跳过）：
     * 全批 parse → LeagueRatingValidator → 每份失败码计数；再走 LeagueReplays.collect 端到端
     * （Rating + 汇总），验证 0/N 是否已消除。
     */
    @Test
    void probeUserChampionshipBatchWhenPresent() throws Exception {
        final Path batch = Path.of(System.getProperty("user.dir"), "..", "..", "common", "34冠军赛回放");
        if (!Files.isDirectory(batch)) {
            System.out.println("\n===== SKIP（34冠军赛回放 目录缺失）");
            return;
        }
        final List<Path> replays;
        try (Stream<Path> s = Files.walk(batch)) {
            replays = s.filter(p -> Files.isRegularFile(p) && p.toString().endsWith(".wotbreplay"))
                    .sorted().toList();
        }
        if (replays.isEmpty()) {
            System.out.println("\n===== SKIP（34冠军赛回放 无 .wotbreplay）");
            return;
        }

        int parsed = 0;
        int rated = 0;
        int parseFailed = 0;
        final Map<String, Integer> failureCodes = new TreeMap<>();
        final List<Source> sources = new ArrayList<>();
        for (final Path p : replays) {
            final byte[] bytes = Files.readAllBytes(p);
            try {
                final Battle b = ReplayParser.parse(bytes);
                parsed++;
                sources.add(new Source(p.getFileName().toString(), bytes));
                final List<LeagueFailure> fs = LeagueRatingValidator.validate(b);
                if (fs.isEmpty()) {
                    rated++;
                } else {
                    failureCodes.merge(fs.getFirst().code(), 1, Integer::sum);
                }
                System.out.println(p.getFileName() + " arenaBonusType=" + b.arenaBonusType
                        + " players=" + (b.players == null ? 0 : b.players.size())
                        + " rosterComplete=" + b.rosterComplete
                        + " firstCode=" + (fs.isEmpty() ? "PASS" : fs.getFirst().code()));
            } catch (final Exception e) {
                parseFailed++;
                System.out.println("PARSE_FAIL " + p.getFileName() + " : " + e.getMessage());
            }
        }

        // 端到端：全批 collect → League 汇总（只对 eligible 场次评分）
        int ratedInBatch = 0;
        if (!sources.isEmpty()) {
            final LeagueReplays.LeagueCollectResult r = LeagueReplays.collect(
                    sources, source -> ReplayParser.parse(source.bytes()), null, null);
            System.out.println("batch mode=" + r.mode()
                    + " battles=" + r.battles().size()
                    + " leagueFailures=" + r.leagueFailures().size());
            if (r.leagueBatch() != null) {
                ratedInBatch = r.leagueBatch().battleResults().size();
                System.out.println("batch ratedBattles=" + ratedInBatch
                        + " playerSummaries=" + r.leagueBatch().playerSummaries().size()
                        + " teamSummaries=" + r.leagueBatch().teamSummaries().size());
            }
        }

        System.out.println("===== 34冠军赛回放 batch summary: files=" + replays.size()
                + " parsed=" + parsed + " rated=" + rated + " parseFailed=" + parseFailed
                + " ratedInBatch=" + ratedInBatch
                + " failureCodes=" + failureCodes);
    }
}

import com.wotb.core.rating.LeagueBatchRatingCalculator;
import com.wotb.core.rating.LeagueRatingCalculator;
import com.wotb.core.rating.LeagueRatingNormalizer;
import com.wotb.core.rating.LeagueRatingResult;
import com.wotb.core.rating.PlayerLeagueRating;
import com.wotb.core.rating.TeamLeagueRating;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.TradeFacts;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;

/**
 * Golden generator for client-engine League Rating parity.
 *
 * <p>Runs the production League Rating implementation over deterministic synthetic 7v7 battles and
 * prints one JSON document containing both the inputs and the production outputs. The committed
 * output lets CI (which has no Java toolchain) verify the Rust port field by field.
 *
 * <p>Run (from the repository root, after {@code mvn -pl wotb-core -DskipTests package}):
 *
 * <pre>
 * javac -cp java/wotb-core/target/classes -d /tmp/golden replay-engine/tests/java-golden/RatingGoldenDumper.java
 * java -cp java/wotb-core/target/classes:/tmp/golden RatingGoldenDumper > replay-engine/tests/golden/league-rating-v41.json
 * </pre>
 *
 * <p>This file is migration tooling: it lives with the engine and never ships in production.
 */
public final class RatingGoldenDumper {

    private static final int[] TEAM_1_DAMAGE = {0, 0, 1500, 2400, 3100, 4200, 900, 2600, 1800, 5000, 1200, 3300, 700, 2900};
    private static final int[] TEAM_2_DAMAGE = {0, 0, 1350, 2250, 3000, 3900, 1100, 2500, 1700, 4700, 1400, 3200, 800, 2700};

    public static void main(String[] args) {
        final Random random = new Random(20260927L);
        final StringBuilder json = new StringBuilder();
        json.append("{\n  \"source\": \"com.wotb.core.rating.LeagueRatingCalculator (V4.1) + LeagueBatchRatingCalculator (V6)\",\n");
        json.append("  \"scenarios\": [\n");

        final List<String> scenarios = new ArrayList<>();
        scenarios.add(scenario("typical", 1, typicalPlayers(random, 0)));
        scenarios.add(scenario("loser-wins", 2, typicalPlayers(random, 1)));
        scenarios.add(scenario("all-zero", 1, zeroPlayers()));
        scenarios.add(scenario("single-shot-perfect", 1, singleShotPlayers(false)));
        scenarios.add(scenario("single-shot-survivors", 1, singleShotPlayers(true)));
        scenarios.add(scenario("damage-cap", 1, cappedPlayers()));
        scenarios.add(scenario("identical-players-tie", 1, identicalPlayers()));
        scenarios.add(scenario("trade-window", 1, tradeWindowPlayers(5.0)));
        scenarios.add(scenario("trade-just-outside", 1, tradeWindowPlayers(5.5)));
        scenarios.add(scenario("blocked-heavy", 1, blockedHeavyPlayers()));
        scenarios.add(scenario("sparse-shooting", 1, sparseShootingPlayers()));
        scenarios.add(scenario("randomized-1", randomWinner(random), randomPlayers(random)));
        scenarios.add(scenario("randomized-2", randomWinner(random), randomPlayers(random)));
        scenarios.add(scenario("randomized-3", randomWinner(random), randomPlayers(random)));

        for (int i = 0; i < scenarios.size(); i++) {
            json.append(scenarios.get(i));
            json.append(i + 1 == scenarios.size() ? "\n" : ",\n");
        }
        json.append("  ],\n");
        json.append("  \"batch\": [\n");
        json.append(batchRow("player", LeagueBatchRatingCalculator.playerRating(1000.0, 1)));
        json.append(",\n");
        json.append(batchRow("player-none", LeagueBatchRatingCalculator.playerRating(0.0, 0)));
        json.append(",\n");
        json.append(batchRow("team", LeagueBatchRatingCalculator.teamRating(1000.0, 1)));
        json.append(",\n");
        json.append(batchRow("observed-mean", LeagueBatchRatingCalculator.observedMean(1500.0, 3)));
        json.append("\n  ],\n");
        final List<Battle> aggBattles = aggregateBattles(random);
        json.append("  \"aggregateInput\": [\n");
        for (int i = 0; i < aggBattles.size(); i++) {
            json.append(aggregateInputRow(aggBattles.get(i)));
            json.append(i + 1 == aggBattles.size() ? "\n" : ",\n");
        }
        json.append("  ],\n");
        json.append("  \"aggregate\": [\n");
        final java.util.Map<Long, com.wotb.core.model.Agg> aggregated =
                com.wotb.core.stats.Aggregator.aggregate(aggBattles,
                        com.wotb.core.ref.Tankopedia.load());
        int aggregateIndex = 0;
        for (final com.wotb.core.model.Agg a : aggregated.values()) {
            json.append(aggregateRow(a));
            json.append(++aggregateIndex == aggregated.size() ? "\n" : ",\n");
        }
        json.append("  ],\n");
        json.append("  \"normalizer\": [\n");
        json.append(normalizerRow("wilson-1-1", LeagueRatingNormalizer.wilsonLowerBound(1, 1)));
        json.append(",\n");
        json.append(normalizerRow("wilson-10-20", LeagueRatingNormalizer.wilsonLowerBound(10, 20)));
        json.append(",\n");
        json.append(normalizerRow("team-index-average", LeagueRatingNormalizer.teamIndex(1000, 1000)));
        json.append(",\n");
        json.append(normalizerRow("trade-window-sec", TradeFacts.TRADE_AFTER_DEATH_WINDOW_SEC));
        json.append("\n  ]\n}\n");

        System.out.print(json);
    }

    private static String batchRow(String name, Double value) {
        return "    {\"name\": \"" + name + "\", \"value\": " + number(value) + "}";
    }

    private static String normalizerRow(String name, double value) {
        return "    {\"name\": \"" + name + "\", \"value\": " + number(value) + "}";
    }

    private static String scenario(String name, int winnerTeam, List<PlayerResult> players) {
        final Battle battle = new Battle();
        battle.arenaId = "9000000000000000" + name.length();
        battle.winnerTeam = winnerTeam;
        battle.players = players;
        final LeagueRatingResult result = LeagueRatingCalculator.calculate(battle);

        final StringBuilder out = new StringBuilder();
        out.append("    {\n      \"name\": \"").append(name).append("\",\n");
        out.append("      \"winnerTeam\": ").append(winnerTeam).append(",\n");
        out.append("      \"players\": [\n");
        for (int i = 0; i < players.size(); i++) {
            final PlayerResult p = players.get(i);
            out.append("        {\"accountId\": \"").append(p.accountId).append("\"")
                    .append(", \"team\": ").append(p.team)
                    .append(", \"damageDealt\": ").append(p.damageDealt)
                    .append(", \"damageAssisted\": ").append(p.damageAssisted)
                    .append(", \"damageBlocked\": ").append(p.damageBlocked)
                    .append(", \"damageReceived\": ").append(p.damageReceived)
                    .append(", \"kills\": ").append(p.kills)
                    .append(", \"shots\": ").append(p.nShots)
                    .append(", \"hitsDealt\": ").append(p.nHitsDealt)
                    .append(", \"penetrationsDealt\": ").append(p.nPenetrationsDealt)
                    .append(", \"survived\": ").append(p.survived)
                    .append(", \"lifeTimeSec\": ").append(number((double) p.settlementLifeTimeSec))
                    .append("}");
            out.append(i + 1 == players.size() ? "\n" : ",\n");
        }
        out.append("      ],\n      \"expected\": {\n");
        out.append("        \"players\": [\n");
        for (int i = 0; i < result.players().size(); i++) {
            final PlayerLeagueRating p = result.players().get(i);
            out.append("          {\"accountId\": \"").append(p.accountId()).append("\"")
                    .append(", \"dimensions\": ").append(array(p.dimensionScores()))
                    .append(", \"preliminary\": ").append(number(p.preliminary()))
                    .append(", \"baseRating\": ").append(number(p.baseRating()))
                    .append(", \"finalRating\": ").append(number(p.finalRating()))
                    .append(", \"survivalState\": \"").append(p.survivalState()).append("\"")
                    .append(", \"mvp\": ").append(p.mvp())
                    .append(", \"teamBest\": ").append(p.teamBest())
                    .append("}");
            out.append(i + 1 == result.players().size() ? "\n" : ",\n");
        }
        out.append("        ],\n        \"teams\": [\n");
        final TeamLeagueRating[] teams = {result.team1(), result.team2()};
        for (int i = 0; i < teams.length; i++) {
            final TeamLeagueRating t = teams[i];
            out.append("          {\"team\": ").append(t.team())
                    .append(", \"rating\": ").append(number(t.teamRating()))
                    .append(", \"dimensionAverages\": ").append(array(t.dimensionAverages()))
                    .append(", \"bestAccountId\": ").append(quote(t.teamBest() == null ? null : String.valueOf(t.teamBest().accountId())))
                    .append("}");
            out.append(i + 1 == teams.length ? "\n" : ",\n");
        }
        out.append("        ],\n");
        out.append("        \"mvpAccountId\": ").append(quote(result.mvp() == null ? null : String.valueOf(result.mvp().accountId()))).append("\n");
        out.append("      }\n    }");
        return out.toString();
    }

    private static String array(List<Double> values) {
        final StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            out.append(number(values.get(i)));
            if (i + 1 != values.size()) {
                out.append(", ");
            }
        }
        return out.append("]").toString();
    }

    private static String quote(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }

    private static String number(Double value) {
        if (value == null) {
            return "null";
        }
        if (value.isNaN() || value.isInfinite()) {
            throw new IllegalStateException("golden must not contain non-finite numbers");
        }
        return String.format(Locale.ROOT, "%.17g", value);
    }

    // ---- scenarios ----

    private static List<PlayerResult> typicalPlayers(Random random, int shift) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int team = 1; team <= 2; team++) {
            for (int seat = 0; seat < 7; seat++) {
                final int index = team * 7 + seat;
                final PlayerResult p = new PlayerResult();
                p.accountId = 1_000_000L + index;
                p.nickname = "P" + index;
                p.clan = "C" + team;
                p.team = team;
                p.damageDealt = (team == 1 ? TEAM_1_DAMAGE : TEAM_2_DAMAGE)[seat + 1 + (shift % 2)];
                p.damageAssisted = 100 + seat * 90 + random.nextInt(120);
                p.damageBlocked = seat * 130 + random.nextInt(200);
                p.damageReceived = 500 + (6 - seat) * 240;
                p.kills = seat % 3;
                p.nShots = 6 + seat + random.nextInt(6);
                p.nHitsDealt = Math.min(p.nShots, 3 + seat / 2);
                p.nPenetrationsDealt = Math.max(0, p.nHitsDealt - 1);
                p.survived = seat == 6;
                p.settlementLifeTimeSec = seat == 6 ? 300 : 40 + seat * 25;
                players.add(p);
            }
        }
        return players;
    }

    private static List<PlayerResult> zeroPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 2_000_000L + index;
            p.nickname = "Z" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            players.add(p);
        }
        return players;
    }

    private static List<PlayerResult> singleShotPlayers(boolean survivors) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 3_000_000L + index;
            p.nickname = "S" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            p.nShots = 1;
            p.nHitsDealt = 1;
            p.nPenetrationsDealt = 1;
            p.damageDealt = 400;
            p.damageAssisted = 0;
            p.damageBlocked = 0;
            p.damageReceived = 0;
            p.kills = 0;
            p.survived = survivors || index % 2 == 0;
            p.settlementLifeTimeSec = p.survived ? 300 : 120;
            players.add(p);
        }
        return players;
    }

    private static List<PlayerResult> cappedPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 4_000_000L + index;
            p.nickname = "H" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            p.damageDealt = 20_000;
            p.damageAssisted = 9_000;
            p.damageBlocked = 8_000;
            p.damageReceived = 1;
            p.kills = 7;
            p.nShots = 20;
            p.nHitsDealt = 20;
            p.nPenetrationsDealt = 20;
            p.survived = true;
            p.settlementLifeTimeSec = 300;
            players.add(p);
        }
        return players;
    }

    private static List<PlayerResult> identicalPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 5_000_000L + index;
            p.nickname = "T" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            p.damageDealt = 2_000;
            p.damageAssisted = 300;
            p.damageBlocked = 400;
            p.damageReceived = 1_800;
            p.kills = 1;
            p.nShots = 8;
            p.nHitsDealt = 6;
            p.nPenetrationsDealt = 4;
            p.survived = false;
            p.settlementLifeTimeSec = 150 + index; // distinct deaths: no trades, deterministic order
            players.add(p);
        }
        return players;
    }

    private static List<PlayerResult> tradeWindowPlayers(double offset) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 6_000_000L + index;
            p.nickname = "W" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            p.damageDealt = 1_500;
            p.damageAssisted = 200;
            p.damageBlocked = 100;
            p.damageReceived = 1_600;
            p.kills = index % 2;
            p.nShots = 5;
            p.nHitsDealt = 4;
            p.nPenetrationsDealt = 3;
            p.survived = false;
            // Team 1 seat 0 dies at 100s; enemy seat 6 dies at 100 + offset seconds.
            if (p.team == 1 && index == 0) {
                p.settlementLifeTimeSec = 100;
            } else if (p.team == 2 && index == 13) {
                p.settlementLifeTimeSec = (int) Math.round(100 + offset);
            } else {
                p.settlementLifeTimeSec = 200 + index;
            }
            players.add(p);
        }
        return players;
    }

    private static List<PlayerResult> blockedHeavyPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 7_000_000L + index;
            p.nickname = "B" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            p.damageDealt = 200 + index * 10;
            p.damageAssisted = 50;
            p.damageBlocked = 4_000 - index * 100;
            p.damageReceived = 0;
            p.kills = 0;
            p.nShots = 4;
            p.nHitsDealt = 2;
            p.nPenetrationsDealt = 1;
            p.survived = true;
            p.settlementLifeTimeSec = 295;
            players.add(p);
        }
        return players;
    }

    private static List<PlayerResult> sparseShootingPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 8_000_000L + index;
            p.nickname = "R" + index;
            p.clan = "";
            p.team = index < 7 ? 1 : 2;
            p.damageDealt = index % 4 == 0 ? 0 : 1_800;
            p.damageAssisted = 0;
            p.damageBlocked = 0;
            p.damageReceived = 900;
            p.kills = 0;
            p.nShots = index % 3; // includes zero-shot players
            p.nHitsDealt = Math.max(0, p.nShots - 1);
            p.nPenetrationsDealt = Math.max(0, p.nShots - 2);
            p.survived = index % 5 == 0;
            p.settlementLifeTimeSec = p.survived ? 300 : 90 + index;
            players.add(p);
        }
        return players;
    }

    private static String aggregateInputRow(Battle battle) {
        final StringBuilder out = new StringBuilder();
        out.append("    {\"arenaId\": \"").append(battle.arenaId).append("\"")
                .append(", \"winnerTeam\": ").append(battle.winnerTeam)
                .append(", \"startTime\": ").append(battle.startTime == null ? 0 : battle.startTime)
                .append(", \"durationSec\": ").append(number(battle.durationS))
                .append(", \"players\": [");
        for (int i = 0; i < battle.players.size(); i++) {
            out.append(playerJson(battle.players.get(i)));
            if (i + 1 != battle.players.size()) {
                out.append(", ");
            }
        }
        return out.append("]}").toString();
    }

    private static String playerJson(PlayerResult p) {
        return "{\"accountId\": \"" + p.accountId + "\""
                + ", \"team\": " + p.team
                + ", \"nickname\": " + quote(p.nickname)
                + ", \"clan\": " + quote(p.clan)
                + ", \"vehicleId\": \"" + p.tankId + "\""
                + ", \"damageDealt\": " + p.damageDealt
                + ", \"damageAssisted\": " + p.damageAssisted
                + ", \"damageBlocked\": " + p.damageBlocked
                + ", \"damageReceived\": " + p.damageReceived
                + ", \"kills\": " + p.kills
                + ", \"shots\": " + p.nShots
                + ", \"hitsDealt\": " + p.nHitsDealt
                + ", \"penetrationsDealt\": " + p.nPenetrationsDealt
                + ", \"enemiesDamaged\": " + p.nEnemiesDamaged
                + ", \"victoryPointsEarned\": " + p.victoryPointsEarned
                + ", \"survived\": " + p.survived
                + ", \"lifeTimeSec\": " + number((double) p.settlementLifeTimeSec)
                + "}";
    }

    private static String aggregateRow(com.wotb.core.model.Agg a) {
        final StringBuilder out = new StringBuilder();
        out.append("    {\"accountId\": \"").append(a.accountId).append("\"")
                .append(", \"nickname\": \"").append(a.nickname).append("\"")
                .append(", \"clan\": \"").append(a.clan).append("\"")
                .append(", \"team\": ").append(a.team)
                .append(", \"battles\": ").append(a.battles)
                .append(", \"wins\": ").append(a.wins)
                .append(", \"survived\": ").append(a.survived)
                .append(", \"kills\": ").append(a.kills)
                .append(", \"damage\": ").append(a.damage)
                .append(", \"assisted\": ").append(a.assisted)
                .append(", \"received\": ").append(a.received)
                .append(", \"blocked\": ").append(a.blocked)
                .append(", \"earned\": ").append(a.earned)
                .append(", \"shots\": ").append(a.shots)
                .append(", \"hits\": ").append(a.hits)
                .append(", \"pens\": ").append(a.pens)
                .append(", \"enemiesDamaged\": ").append(a.enemiesDamaged)
                .append(", \"survivalSum\": ").append(number(a.survivalSum))
                .append(", \"survivalKnownBattles\": ").append(a.survivalKnownBattles)
                .append(", \"winRate\": ").append(number(a.winRate()))
                .append(", \"survivalRate\": ").append(number(a.survivalRate()))
                .append(", \"damageAvg\": ").append(number(a.avg(a.damage)))
                .append(", \"assistedAvg\": ").append(number(a.avg(a.assisted)))
                .append(", \"receivedAvg\": ").append(number(a.avg(a.received)))
                .append(", \"blockedAvg\": ").append(number(a.avg(a.blocked)))
                .append(", \"killsAvg\": ").append(number(a.avg(a.kills)))
                .append(", \"earnedAvg\": ").append(number(a.avg(a.earned)))
                .append(", \"survivalAvg\": ").append(number(a.survivalAvg()))
                .append(", \"hitRate\": ").append(number(a.hitRate()))
                .append(", \"penRate\": ").append(number(a.penRate()))
                .append(", \"tanksStr\": \"").append(a.tanksStr().replace("\"", "\\\"")).append("\"")
                .append("}");
        return out.toString();
    }

    /**
     * Two battles sharing accounts with different start times, winners and (partially) renamed
     * players, so the "most recent battle wins the nickname/team" rule is exercised.
     */
    private static List<Battle> aggregateBattles(Random random) {
        final List<PlayerResult> first = typicalPlayers(random, 0);
        final List<PlayerResult> second = typicalPlayers(random, 1);
        for (int i = 0; i < first.size(); i++) {
            second.get(i).nickname = "R" + i;
            second.get(i).clan = "C9";
            second.get(i).survived = i % 3 == 0;
            second.get(i).settlementLifeTimeSec = second.get(i).survived ? 300 : 20 + i;
        }
        // The first battle has no usable duration -> its survivors contribute no survival seconds.
        final Battle battle1 = new Battle();
        battle1.arenaId = "8000000000000001";
        battle1.winnerTeam = 1;
        battle1.startTime = 1_700_000_000L;
        battle1.durationS = null;
        battle1.players = first;

        final Battle battle2 = new Battle();
        battle2.arenaId = "8000000000000002";
        battle2.winnerTeam = 2;
        battle2.startTime = 1_700_000_500L;
        battle2.durationS = 301.5;
        battle2.players = second;

        return List.of(battle1, battle2);
    }

    private static int randomWinner(Random random) {
        return 1 + random.nextInt(2);
    }

    private static List<PlayerResult> randomPlayers(Random random) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int index = 0; index < 14; index++) {
            final PlayerResult p = new PlayerResult();
            p.accountId = 9_000_000L + index + random.nextInt(1000);
            p.nickname = "X" + index;
            p.clan = random.nextBoolean() ? "ALPHA" : "BETA";
            p.team = index < 7 ? 1 : 2;
            p.damageDealt = random.nextInt(5_000);
            p.damageAssisted = random.nextInt(1_500);
            p.damageBlocked = random.nextInt(2_500);
            p.damageReceived = random.nextInt(3_500);
            p.kills = random.nextInt(4);
            p.nShots = random.nextInt(15);
            p.nHitsDealt = p.nShots == 0 ? 0 : random.nextInt(p.nShots + 1);
            p.nPenetrationsDealt = p.nHitsDealt == 0 ? 0 : random.nextInt(p.nHitsDealt + 1);
            p.survived = random.nextInt(4) == 0;
            p.settlementLifeTimeSec = p.survived ? 300 : 10 + random.nextInt(280);
            players.add(p);
        }
        return players;
    }
}

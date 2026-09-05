package com.wotb.web.replay.mapper;

import com.wotb.core.league.PlayerVehicleUsage;
import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.league.PlayerLeagueSummary;
import com.wotb.core.league.TeamLeagueSummary;
import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.web.replay.dto.AggRow;
import com.wotb.web.replay.dto.BattleDto;
import com.wotb.web.replay.dto.LeagueVehicleUsageDto;
import com.wotb.web.replay.dto.PreviewResponse;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReplayMapperTest {

    @Test
    void battleDtoCarriesAuthoritativeSourceIdSeparatelyFromDisplayName() {
        final Battle battle = new Battle();
        battle.players = List.of();
        final BattleDto dto = Mapper.toBattle(battle, "r10", "folder_display.wotbreplay",
                Tankopedia.load(), null, false);

        assertEquals("r10", dto.sourceId());
        assertEquals("folder_display.wotbreplay", dto.sourceName());
    }

    @Test
    void leagueSummaryRatingKeepsFullPrecisionForApiSorting() {
        final Battle battle = new Battle();
        battle.arenaId = "precision-01";
        battle.players = List.of();
        final PlayerLeagueSummary player = new PlayerLeagueSummary(
                5001L, "Precision", "ALPHA", 15, 418.93125, 400.2416666666667,
                List.of(10.0, 20.0, 30.0, 40.0, 5.0, 6.0, 7.0),
                0, 0, 0, 0, 0, List.of());
        final TeamLeagueSummary team = new TeamLeagueSummary(
                "clan:ALPHA", "ALPHA", "CLAN_MAJORITY", 34,
                598.5285714285715, 602.1617647058823,
                List.of(102.65, 21.0, 31.0, 41.0, 6.0, 7.0, 8.0),
                0, List.of("precision-01:1"));
        final PreviewResponse response = Mapper.toPreviewResponse(
                List.of(battle), List.of(), List.of(), List.of(), Tankopedia.load(),
                new LeagueRatingBatch(List.of(), List.of(player), List.of(team), List.of()));

        assertEquals(418.93125, response.league().playerSummaries().getFirst().rating(), 0.0);
        assertEquals(598.5285714285715, response.league().teamSummaries().getFirst().rating(), 0.0);
    }

    @Test
    void exposesLanguageNeutralSurvivalValues() {
        final PlayerResult survivor = player(1L, true);
        final PlayerResult destroyed = player(2L, false);
        survivor.tankId = 4481L;
        destroyed.tankId = 24321L;
        final Battle battle = new Battle();
        battle.players = List.of(survivor, destroyed);

        final BattleDto dto = Mapper.toBattle(battle, "sample.wotbreplay", Tankopedia.load());

        final Set<Object> values = dto.players().stream()
                .map(row -> row.cells().get("survived_label"))
                .collect(Collectors.toSet());
        assertEquals(Set.of("SURVIVED", "DESTROYED"), values);

        final Map<Long, Map<String, Object>> cellsByAccount = dto.players().stream()
                .collect(Collectors.toMap(
                        row -> ((Number) row.cells().get("account_id")).longValue(),
                        row -> row.cells()));
        assertEquals("HEAVY_TANK", cellsByAccount.get(1L).get("tank_type"));
        assertEquals("EUROPE", cellsByAccount.get(1L).get("tank_nation"));
        assertEquals("LIGHT_TANK", cellsByAccount.get(2L).get("tank_type"));
        assertEquals("USSR", cellsByAccount.get(2L).get("tank_nation"));
    }

    @Test
    void battleCellsIncludeContributionKastImpactAfterPopulate() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        final List<PlayerResult> players = new java.util.ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = player(i + 1L, true);
            p.team = i < 7 ? 1 : 2;
            p.nickname = "p" + (i + 1);
            p.tankId = 4481L;
            p.damageDealt = 2600 - i * 100;
            p.kills = 2;
            players.add(p);
        }
        battle.players = players;
        PerformanceMetricsCalculator.populateBattle(battle);

        final BattleDto dto = Mapper.toBattle(battle, "sample.wotbreplay", Tankopedia.load());

        final Map<String, Object> firstCells = dto.players().stream()
                .filter(row -> ((Number) row.cells().get("account_id")).longValue() == 1L)
                .findFirst().orElseThrow().cells();
        assertTrue(firstCells.containsKey("contribution"));
        assertTrue(firstCells.containsKey("kast"));
        assertTrue(firstCells.containsKey("impact"));
        assertNotNull(firstCells.get("impact"), "HP 已知场 impact 应有值");
        assertNotNull(firstCells.get("contribution"), "HP 已知场 contribution 应有值");
        // 与跨场聚合（单场）同一事实源：impact/contribution/kast 数值一致
        final PerformanceMetricsCalculator.Row aggregate = PerformanceMetricsCalculator.compute(List.of(battle)).stream()
                .filter(r -> r.accountId == 1L)
                .findFirst().orElseThrow();
        assertEquals(aggregate.impactValue, ((Number) firstCells.get("impact")).doubleValue(), 0.01);
        assertEquals(aggregate.contribution, ((Number) firstCells.get("contribution")).doubleValue(), 0.01);
        assertEquals(aggregate.kast, ((Number) firstCells.get("kast")).doubleValue(), 0.01);
    }

    @Test
    void aggregateCellsMergeCrossBattleMetricsByAccountId() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        final List<PlayerResult> players = new java.util.ArrayList<>();
        for (int i = 0; i < 14; i++) {
            final PlayerResult p = player(i + 1L, true);
            p.team = i < 7 ? 1 : 2;
            p.nickname = "p" + (i + 1);
            p.tankId = 4481L;
            p.damageDealt = 2600 - i * 100;
            players.add(p);
        }
        battle.players = players;
        final Map<Long, Agg> agg = new java.util.HashMap<>();
        for (final PlayerResult p : players) {
            final Agg a = new Agg();
            a.accountId = p.accountId;
            a.nickname = p.nickname;
            a.team = p.team;
            a.battles = 1;
            a.damage = p.damageDealt;
            agg.put(a.accountId, a);
        }
        final Map<Long, PerformanceMetricsCalculator.Row> perfById = new java.util.HashMap<>();
        for (final PerformanceMetricsCalculator.Row r : PerformanceMetricsCalculator.compute(List.of(battle))) {
            perfById.put(r.accountId, r);
        }

        final List<AggRow> rows = Mapper.toAggregate(agg, perfById);

        final AggRow first = rows.getFirst();
        assertTrue(first.cells().containsKey("contribution"));
        assertTrue(first.cells().containsKey("kast"));
        assertTrue(first.cells().containsKey("impact"));
        assertTrue(first.cells().containsKey("multi_damage_rate"));
        assertTrue(first.cells().containsKey("traded_deaths"));
        assertNotNull(first.cells().get("impact"));
        assertNotNull(first.cells().get("contribution"));
    }

    @Test
    void aggregateCellsNullWhenHpUnknown() {
        final Battle battle = new Battle();
        battle.winnerTeam = 1;
        final PlayerResult p = player(1L, true);
        p.team = 1;
        p.nickname = "p1";
        p.tankId = -1; // HP UNKNOWN
        battle.players = List.of(p);
        final Map<Long, Agg> agg = new java.util.HashMap<>();
        final Agg a = new Agg();
        a.accountId = 1L;
        a.nickname = "p1";
        a.team = 1;
        a.battles = 1;
        agg.put(1L, a);
        final Map<Long, PerformanceMetricsCalculator.Row> perfById = new java.util.HashMap<>();
        for (final PerformanceMetricsCalculator.Row r : PerformanceMetricsCalculator.compute(List.of(battle))) {
            perfById.put(r.accountId, r);
        }

        final List<AggRow> rows = Mapper.toAggregate(agg, perfById);

        // HP 全 UNKNOWN → contribution/kast/多伤率 unavailable（null），impact 仍有值
        final Map<String, Object> cells = rows.getFirst().cells();
        assertEquals(null, cells.get("contribution"));
        assertEquals(null, cells.get("kast"));
        assertEquals(null, cells.get("multi_damage_rate"));
        assertNotNull(cells.get("impact"));
    }

    @Test
    void columnsNeverExposePotentialDamageInAnyScope() {
        // Potential Damage 已从 canonical schema 全局移除：Standard 与 League 的
        // 单场/汇总列 universe 都不得再出现 potential_damage 系列（schema absence regression）。
        final java.util.Set<String> leaguePlayerKeys = Mapper.leaguePlayerColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        final java.util.Set<String> leagueAggKeys = Mapper.leagueAggregateColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        final java.util.Set<String> standardPlayerKeys = Mapper.playerColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        final java.util.Set<String> standardAggKeys = Mapper.aggregateColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        for (final java.util.Set<String> keys : java.util.List.of(
                leaguePlayerKeys, leagueAggKeys, standardPlayerKeys, standardAggKeys)) {
            assertTrue(keys.stream().noneMatch(k -> k.startsWith("potential_damage")),
                    "任何列 universe 不得暴露 potential_damage 系列: " + keys);
        }
        assertTrue(standardPlayerKeys.contains("damage_dealt"), "标准 Replay 基础事实必须保留");
        assertTrue(standardAggKeys.contains("damage"), "标准 Replay 汇总基础事实必须保留");
    }

    @Test
    void battleRateCellsNullWhenDenominatorZero() {
        // hit_rate/pen_rate：denominator==0 → null（API null，UI "--"，禁止 0/0 伪装 0%）
        final PlayerResult p = player(1L, true);
        p.tankId = 4481L;
        p.nShots = 0;
        p.nHitsDealt = 0;
        p.nPenetrationsDealt = 0;
        final Battle battle = new Battle();
        battle.players = List.of(p);
        final BattleDto dto = Mapper.toBattle(battle, "sample.wotbreplay", Tankopedia.load());
        final Map<String, Object> cells = dto.players().getFirst().cells();
        assertEquals(null, cells.get("hit_rate"));
        assertEquals(null, cells.get("pen_rate"));

        final PlayerResult hit = player(2L, true);
        hit.tankId = 4481L;
        hit.nShots = 10;
        hit.nHitsDealt = 5;
        hit.nPenetrationsDealt = 4;
        final Battle b2 = new Battle();
        b2.players = List.of(hit);
        final Map<String, Object> c2 = Mapper.toBattle(b2, "sample.wotbreplay", Tankopedia.load())
                .players().getFirst().cells();
        assertEquals(50.0, ((Number) c2.get("hit_rate")).doubleValue(), 1e-9);
        assertEquals(80.0, ((Number) c2.get("pen_rate")).doubleValue(), 1e-9);
    }

    // ---- 最常使用坦克选择（Mapper.selectMostUsedVehicle）----

    @Test
    void selectsMostUsedVehicleByCountThenNameThenTankId() {
        // 三辆坦克使用次数相同（3 场），按官方名忽略大小写字母表升序 → E 100（E < I < M）。
        final List<PlayerVehicleUsage> usage = List.of(
                new PlayerVehicleUsage(1, 3),  // Maus
                new PlayerVehicleUsage(2, 3),  // IS-7
                new PlayerVehicleUsage(3, 3)); // E 100
        final java.util.Map<Long, String> names = java.util.Map.of(1L, "Maus", 2L, "IS-7", 3L, "E 100");
        final LeagueVehicleUsageDto dto = Mapper.selectMostUsedVehicle(usage, names::get);
        assertEquals(3, dto.tankId(), "名称字母表第一辆（E 100）");
        assertEquals("E 100", dto.tankName());
        assertEquals(3, dto.battles());
    }

    @Test
    void selectsByBattlesCountDescendingFirst() {
        // 4 场 > 3 场：优先场次最多的坦克，不看名称。
        final List<PlayerVehicleUsage> usage = List.of(
                new PlayerVehicleUsage(1, 3),
                new PlayerVehicleUsage(2, 4));
        final java.util.Map<Long, String> names = java.util.Map.of(1L, "Maus", 2L, "IS-7");
        final LeagueVehicleUsageDto dto = Mapper.selectMostUsedVehicle(usage, names::get);
        assertEquals(2, dto.tankId(), "场次最多获胜");
        assertEquals(4, dto.battles());
    }

    @Test
    void selectsByTankNameIgnoringCase() {
        // 名称仅大小写不同（忽略大小写视为相等）→ 按 tankId 升序稳定选择。
        final List<PlayerVehicleUsage> usage = List.of(
                new PlayerVehicleUsage(10, 2),
                new PlayerVehicleUsage(20, 2));
        final java.util.Map<Long, String> names = java.util.Map.of(10L, "Alpha", 20L, "alpha");
        final LeagueVehicleUsageDto dto = Mapper.selectMostUsedVehicle(usage, names::get);
        assertEquals(10, dto.tankId(), "忽略大小写相等 → tankId 升序");
    }

    @Test
    void selectsByTankIdAscendingWhenNamesIdentical() {
        final List<PlayerVehicleUsage> usage = List.of(
                new PlayerVehicleUsage(5, 2),
                new PlayerVehicleUsage(7, 2));
        final java.util.Map<Long, String> names = java.util.Map.of(5L, "IS-7", 7L, "IS-7");
        final LeagueVehicleUsageDto dto = Mapper.selectMostUsedVehicle(usage, names::get);
        assertEquals(5, dto.tankId(), "名称完全相同 → tankId 升序");
    }

    @Test
    void returnsNullWhenVehicleNameUnavailable() {
        // 最常使用坦克的官方名无法解析 → 返回 null（不得伪造坦克、不回退下一辆）。
        final List<PlayerVehicleUsage> usage = List.of(new PlayerVehicleUsage(1, 5));
        final java.util.function.Function<Long, String> nameOf = id -> id == 1L ? null : "Other";
        assertEquals(null, Mapper.selectMostUsedVehicle(usage, nameOf));
    }

    @Test
    void returnsNullWhenNoVehicleUsage() {
        assertEquals(null, Mapper.selectMostUsedVehicle(List.of(), id -> "X"));
        assertEquals(null, Mapper.selectMostUsedVehicle(null, id -> "X"));
    }

    @Test
    void realTankopediaUnknownIdYieldsNullDto() {
        // 未知 tankId → Tankopedia.info 返回 "#<id>" 占位名 → 不视为可靠官方名 → DTO null（不伪造）。
        final Tankopedia tp = Tankopedia.load();
        final List<PlayerVehicleUsage> usage = List.of(new PlayerVehicleUsage(99999999L, 3));
        assertEquals(null, Mapper.selectMostUsedVehicle(usage, id -> Mapper.vehicleName(id, tp)));
    }

    @Test
    void unknownNameTiePrefersKnownCandidate() {
        // 并列最多：未知（占位名）与已知官方名 → 剔除占位名后选择已知名候选。
        final List<PlayerVehicleUsage> usage = List.of(
                new PlayerVehicleUsage(99999999L, 3),
                new PlayerVehicleUsage(1, 3));
        final java.util.Map<Long, String> names = java.util.Map.of(99999999L, "#99999999", 1L, "Maus");
        final LeagueVehicleUsageDto dto = Mapper.selectMostUsedVehicle(usage, names::get);
        assertNotNull(dto, "剔除占位名后应选择已知名候选");
        assertEquals(1, dto.tankId(), "选择已知官方名候选");
        assertEquals("Maus", dto.tankName());
        assertEquals(3, dto.battles());
    }

    @Test
    void uniqueMaxUnknownNameReturnsNullAndNoFallback() {
        // 唯一最多候选名称未知（占位名）→ null，不退回使用次数较少的坦克。
        final List<PlayerVehicleUsage> usage = List.of(
                new PlayerVehicleUsage(99999999L, 5),
                new PlayerVehicleUsage(1, 2));
        final java.util.Map<Long, String> names = java.util.Map.of(99999999L, "#99999999", 1L, "Maus");
        assertEquals(null, Mapper.selectMostUsedVehicle(usage, names::get),
                "最大次数候选无可靠名称时不退回低次数候选");
    }

    private static PlayerResult player(final long accountId, final boolean survived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.survived = survived;
        return player;
    }
}

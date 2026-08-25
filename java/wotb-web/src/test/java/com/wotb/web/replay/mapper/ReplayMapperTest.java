package com.wotb.web.replay.mapper;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Agg;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.stats.PerformanceMetricsCalculator;
import com.wotb.web.replay.dto.AggRow;
import com.wotb.web.replay.dto.BattleDto;
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
    void exposesLanguageNeutralSurvivalValues() {
        final PlayerResult survivor = player(1L, true);
        final PlayerResult destroyed = player(2L, false);
        survivor.tankId = 4481L;
        survivor.potentialDamageDetailed = true;
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
        assertEquals("PARSED", cellsByAccount.get(1L).get("potential_damage_detail"));
        assertEquals("LIGHT_TANK", cellsByAccount.get(2L).get("tank_type"));
        assertEquals("USSR", cellsByAccount.get(2L).get("tank_nation"));
        assertEquals("UNPARSED", cellsByAccount.get(2L).get("potential_damage_detail"));
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
    void leagueColumnsExcludePotentialDamageButStandardReplayKeepsIt() {
        // Potential Damage 不是 League Rating / League Analysis 指标：从 League column universe
        // 过滤（potential_damage / supplement / detail / avg / supplement_avg）；
        // 标准 Replay column universe 保留（普通回放有既有消费者，不无边界删除）。
        final java.util.Set<String> leaguePlayerKeys = Mapper.leaguePlayerColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        assertTrue(leaguePlayerKeys.stream().noneMatch(k -> k.startsWith("potential_damage")),
                "League 单场列不得暴露 potential_damage 系列: " + leaguePlayerKeys);

        final java.util.Set<String> leagueAggKeys = Mapper.leagueAggregateColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        assertTrue(leagueAggKeys.stream().noneMatch(k -> k.startsWith("potential_damage")),
                "League 汇总列不得暴露 potential_damage 系列: " + leagueAggKeys);

        final java.util.Set<String> standardPlayerKeys = Mapper.playerColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        assertTrue(standardPlayerKeys.contains("potential_damage"),
                "标准 Replay 单场列必须保留 potential_damage（既有消费者）");
        final java.util.Set<String> standardAggKeys = Mapper.aggregateColumns().stream()
                .map(com.wotb.web.replay.dto.ColumnDef::key)
                .collect(java.util.stream.Collectors.toSet());
        assertTrue(standardAggKeys.contains("potential_damage"),
                "标准 Replay 汇总列必须保留 potential_damage");
        assertTrue(standardAggKeys.contains("potential_damage_avg"));
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

    private static PlayerResult player(final long accountId, final boolean survived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.survived = survived;
        return player;
    }
}
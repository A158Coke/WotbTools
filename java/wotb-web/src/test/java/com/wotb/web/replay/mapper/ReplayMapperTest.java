package com.wotb.web.replay.mapper;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.replay.dto.BattleDto;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;

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

    private static PlayerResult player(final long accountId, final boolean survived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.survived = survived;
        return player;
    }
}

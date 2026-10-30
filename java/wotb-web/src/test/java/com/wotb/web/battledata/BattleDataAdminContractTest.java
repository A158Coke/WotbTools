package com.wotb.web.battledata;

import com.wotb.web.battledata.dto.BattleDataAdminDtos;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class BattleDataAdminContractTest {
    @Test
    void serializedPagePreservesIdentifiersAndNullableCursor() {
        final var mapper = JsonMapper.builder().findAndAddModules().build();
        final var battle = new BattleDataAdminDtos.Battle("9223372036854775807", "18446744073709551615", 1, 1,
                42, "rift", "11.18", 0, "NORTH", "SOUTH", Instant.parse("2026-10-29T00:00:00Z"));
        final var json = mapper.readTree(mapper.writeValueAsString(new BattleDataAdminDtos.Page(List.of(battle), null)));
        assertThat(json.get("items").get(0).get("id").asString()).isEqualTo("9223372036854775807");
        assertThat(json.get("items").get(0).get("arenaId").asString()).isEqualTo("18446744073709551615");
        assertThat(json.get("nextCursor").isNull()).isTrue();
    }
}

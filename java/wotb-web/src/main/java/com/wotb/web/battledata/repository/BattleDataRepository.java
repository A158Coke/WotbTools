package com.wotb.web.battledata.repository;

import com.wotb.web.battledata.dto.BattleDataRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;

/** 唯一约束是 arena 去重的最终仲裁者；调用方必须提供事务。 */
@Repository
public class BattleDataRepository {
    private final JdbcTemplate jdbc;

    public BattleDataRepository(final JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean insert(final BattleDataRequest request) {
        final var team1 = request.teams().stream().filter(team -> team.team() == 1).findFirst().orElseThrow();
        final var team2 = request.teams().stream().filter(team -> team.team() == 2).findFirst().orElseThrow();
        final var ids = jdbc.query("""
                INSERT INTO battle_data_battle
                  (arena_id, schema_version, arena_bonus_type, map_id, map_key, client_version,
                   winner_team, team1_spawn, team2_spawn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (arena_id) DO NOTHING RETURNING id
                """, (rows, index) -> rows.getLong(1), request.arenaId(), request.schemaVersion(),
                request.arenaBonusType(), request.mapId(), request.mapKey(), request.clientVersion(),
                request.winnerTeam(), team1.spawn(), team2.spawn());
        if (ids.isEmpty()) {
            return false;
        }
        final var slots = new ArrayList<Object[]>();
        for (final var team : request.teams()) {
            for (int slot = 0; slot < team.vehicles().size(); slot++) {
                slots.add(new Object[]{ids.getFirst(), team.team(), slot, team.vehicles().get(slot)});
            }
        }
        jdbc.batchUpdate("INSERT INTO battle_data_vehicle (battle_id, team, slot, vehicle_id) VALUES (?, ?, ?, ?)", slots);
        return true;
    }
}

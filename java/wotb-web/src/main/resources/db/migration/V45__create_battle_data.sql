CREATE TABLE battle_data_battle (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    arena_id varchar(20) NOT NULL UNIQUE,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    arena_bonus_type integer NOT NULL CHECK (arena_bonus_type IN (1, 7)),
    map_id integer NOT NULL CHECK (map_id > 0),
    map_key varchar(128) NOT NULL,
    client_version varchar(64) NOT NULL,
    winner_team integer NOT NULL CHECK (winner_team IN (0, 1, 2)),
    team1_spawn varchar(5) NOT NULL CHECK (team1_spawn IN ('NORTH', 'SOUTH', 'WEST', 'EAST')),
    team2_spawn varchar(5) NOT NULL CHECK (team2_spawn IN ('NORTH', 'SOUTH', 'WEST', 'EAST')),
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((team1_spawn = 'NORTH' AND team2_spawn = 'SOUTH')
        OR (team1_spawn = 'SOUTH' AND team2_spawn = 'NORTH')
        OR (team1_spawn = 'WEST' AND team2_spawn = 'EAST')
        OR (team1_spawn = 'EAST' AND team2_spawn = 'WEST'))
);

CREATE TABLE battle_data_vehicle (
    battle_id bigint NOT NULL REFERENCES battle_data_battle(id) ON DELETE CASCADE,
    team integer NOT NULL CHECK (team IN (1, 2)),
    slot integer NOT NULL CHECK (slot BETWEEN 0 AND 6),
    vehicle_id integer NOT NULL CHECK (vehicle_id > 0),
    PRIMARY KEY (battle_id, team, slot)
);

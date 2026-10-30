package com.wotb.web.battledata.repository;

import com.wotb.web.battledata.dto.BattleDataAdminDtos;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Read-only queries over the canonical collector tables. */
@Repository
public class BattleDataAdminRepository {
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;
    public BattleDataAdminRepository(final JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.named = new NamedParameterJdbcTemplate(jdbc);
    }
    public record Cursor(Instant time, long id) { }
    public record Totals(long total, long last24, long last7, long last30, Instant latest, long maps, long versions) { }

    private static Instant instant(final Timestamp timestamp) { return timestamp == null ? null : timestamp.toInstant(); }
    private static final String COLS = "id, arena_id, schema_version, arena_bonus_type, map_id, map_key, client_version, winner_team, team1_spawn, team2_spawn, received_at";
    private static BattleDataAdminDtos.Battle battle(final java.sql.ResultSet r) throws java.sql.SQLException {
        return new BattleDataAdminDtos.Battle(Long.toString(r.getLong("id")), r.getString("arena_id"), r.getInt("schema_version"),
                r.getInt("arena_bonus_type"), r.getInt("map_id"), r.getString("map_key"), r.getString("client_version"),
                r.getInt("winner_team"), r.getString("team1_spawn"), r.getString("team2_spawn"), instant(r.getTimestamp("received_at")));
    }
    public Totals totals(final Instant asOf) {
        return jdbc.queryForObject("""
                SELECT count(*) AS total, count(*) FILTER (WHERE received_at >= ?) AS last24,
                  count(*) FILTER (WHERE received_at >= ?) AS last7,
                  count(*) FILTER (WHERE received_at >= ?) AS last30,
                  max(received_at) AS latest, count(DISTINCT map_key) AS maps,
                  count(DISTINCT client_version) AS versions
                FROM battle_data_battle WHERE received_at < ?
                """, (r, n) -> new Totals(r.getLong("total"), r.getLong("last24"), r.getLong("last7"), r.getLong("last30"),
                instant(r.getTimestamp("latest")), r.getLong("maps"), r.getLong("versions")),
                Timestamp.from(asOf.minusSeconds(86400)), Timestamp.from(asOf.minusSeconds(604800)),
                Timestamp.from(asOf.minusSeconds(2592000)), Timestamp.from(asOf));
    }
    private static MapSqlParameterSource interval(final Instant from, final Instant to) {
        final var p = new MapSqlParameterSource();
        if (from != null) p.addValue("from", Timestamp.from(from));
        if (to != null) p.addValue("to", Timestamp.from(to));
        return p;
    }
    private static String intervalSql(final Instant from, final Instant to) {
        return " WHERE TRUE" + (from == null ? "" : " AND received_at >= :from") + (to == null ? "" : " AND received_at < :to");
    }
    public long windowCount(final Instant from, final Instant to) {
        return named.queryForObject("SELECT count(*) FROM battle_data_battle" + intervalSql(from, to), interval(from, to), Long.class);
    }
    private static String numericColumn(final String field) {
        return switch (field) {
            case "arena_bonus_type" -> "arena_bonus_type";
            case "winner_team" -> "winner_team";
            case "schema_version" -> "schema_version";
            default -> throw new IllegalArgumentException("unsupported numeric field: " + field);
        };
    }
    private static String namedColumn(final String field) {
        return switch (field) {
            case "map_key" -> "map_key";
            case "client_version" -> "client_version";
            default -> throw new IllegalArgumentException("unsupported named field: " + field);
        };
    }
    public List<BattleDataAdminDtos.NumericCount> numeric(final String field, final Instant from, final Instant to) {
        final var column = numericColumn(field);
        return named.query("SELECT " + column + ", count(*) AS n FROM battle_data_battle" + intervalSql(from, to)
                + " GROUP BY " + column + " ORDER BY " + column, interval(from, to),
                (r, n) -> new BattleDataAdminDtos.NumericCount(r.getInt(1), r.getLong(2)));
    }
    public List<BattleDataAdminDtos.NamedCount> namedCounts(final String field, final Instant from, final Instant to) {
        final var column = namedColumn(field);
        return named.query("SELECT " + column + ", count(*) AS n, max(received_at) FROM battle_data_battle" + intervalSql(from, to)
                + " GROUP BY " + column + " ORDER BY n DESC, " + column, interval(from, to),
                (r, n) -> new BattleDataAdminDtos.NamedCount(r.getString(1), r.getLong(2), instant(r.getTimestamp(3))));
    }
    public List<BattleDataAdminDtos.DailyCount> daily(final Instant from, final Instant to) {
        return named.query("SELECT (received_at AT TIME ZONE 'UTC')::date AS day, count(*) FROM battle_data_battle"
                + intervalSql(from, to) + " GROUP BY day ORDER BY day", interval(from, to),
                (r, n) -> new BattleDataAdminDtos.DailyCount(r.getObject(1, LocalDate.class), r.getLong(2)));
    }
    /** One scan: each battle yields one observation per side; the map+side grouping set is the combined row. */
    public List<BattleDataAdminDtos.SpawnStat> spawnStats(final Instant from, final Instant to) {
        return named.query("SELECT map_key, arena_bonus_type, observed.side, count(*) AS battles,"
                + " count(*) FILTER (WHERE winner_team = observed.team) AS wins,"
                + " count(*) FILTER (WHERE winner_team = 0) AS draws,"
                + " count(*) FILTER (WHERE winner_team = 3 - observed.team) AS losses"
                + " FROM battle_data_battle"
                + " CROSS JOIN LATERAL (VALUES (1, team1_spawn), (2, team2_spawn)) AS observed(team, side)"
                + intervalSql(from, to)
                + " GROUP BY GROUPING SETS ((map_key, observed.side), (map_key, observed.side, arena_bonus_type))"
                + " ORDER BY map_key, observed.side, arena_bonus_type NULLS FIRST", interval(from, to),
                (r, n) -> new BattleDataAdminDtos.SpawnStat(r.getString(1), r.getObject(2, Integer.class), r.getString(3),
                        r.getLong(4), r.getLong(5), r.getLong(6), r.getLong(7)));
    }
    public List<BattleDataAdminDtos.Battle> list(final BattleDataAdminDtos.Filter f, final Cursor cursor, final int limit) {
        final var p = interval(f.from(), f.to()).addValue("limit", limit);
        final var sql = new StringBuilder("SELECT ").append(COLS).append(" FROM battle_data_battle").append(intervalSql(f.from(), f.to()));
        if (f.arenaId() != null) { sql.append(" AND arena_id = :arena"); p.addValue("arena", f.arenaId()); }
        if (f.mapKey() != null) { sql.append(" AND map_key = :map"); p.addValue("map", f.mapKey()); }
        if (f.arenaBonusType() != null) { sql.append(" AND arena_bonus_type = :mode"); p.addValue("mode", f.arenaBonusType()); }
        if (f.clientVersion() != null) { sql.append(" AND client_version = :version"); p.addValue("version", f.clientVersion()); }
        if (f.winnerTeam() != null) { sql.append(" AND winner_team = :winner"); p.addValue("winner", f.winnerTeam()); }
        if (cursor != null) { sql.append(" AND (received_at, id) < (:cursorTime, :cursorId)"); p.addValue("cursorTime", Timestamp.from(cursor.time())); p.addValue("cursorId", cursor.id()); }
        sql.append(" ORDER BY received_at DESC, id DESC LIMIT :limit");
        return named.query(sql.toString(), p, (r, n) -> battle(r));
    }
    public List<BattleDataAdminDtos.Battle> find(final long id) {
        return jdbc.query("SELECT " + COLS + " FROM battle_data_battle WHERE id = ?", (r, n) -> battle(r), id);
    }
    public List<BattleDataAdminDtos.Vehicle> vehicles(final long id) {
        return jdbc.query("SELECT team, slot, vehicle_id FROM battle_data_vehicle WHERE battle_id = ? ORDER BY team, slot",
                (r, n) -> new BattleDataAdminDtos.Vehicle(r.getInt(1), r.getInt(2), r.getInt(3)), id);
    }
}

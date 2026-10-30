package com.wotb.web.battledata.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** Transport shapes for the admin-only persisted observation API. */
public final class BattleDataAdminDtos {
    private BattleDataAdminDtos() { }

    public record Battle(String id, String arenaId, int schemaVersion, int arenaBonusType, int mapId,
            String mapKey, String clientVersion, int winnerTeam, String team1Spawn, String team2Spawn,
            Instant receivedAt) { }
    public record Filter(Instant from, Instant to, String arenaId, String mapKey, Integer arenaBonusType,
            String clientVersion, Integer winnerTeam) { }
    public record Vehicle(int team, int slot, int vehicleId) { }
    public record Detail(Battle battle, List<Vehicle> vehicles) { }
    public record Page(List<Battle> items, String nextCursor) { }
    public record NumericCount(int key, long count) { }
    public record DailyCount(LocalDate key, long count) { }
    public record NamedCount(String key, long count, Instant latestReceivedAt) { }
    public record Summary(Instant asOf, long totalBattles, long last24Hours, long last7Days, long last30Days,
            long windowBattles, Instant latestReceivedAt, long distinctMaps, long distinctClientVersions,
            List<NumericCount> modes, List<NumericCount> winnerTeams, List<NumericCount> schemaVersions,
            List<DailyCount> daily, List<NamedCount> maps, List<NamedCount> clientVersions) { }
}

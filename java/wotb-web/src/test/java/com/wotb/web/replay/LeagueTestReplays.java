package com.wotb.web.replay;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** League Rating web 测试夹具：7v7 Battle + .wotbreplay 字节合成（与 core LeagueTestBattles 同构）。 */
public final class LeagueTestReplays {

    private LeagueTestReplays() {
    }

    public static final class PlayerSpec {
        public long accountId;
        public int team;
        public long tankId = 4481;
        public int damage = 1000;
        public int assist = 100;
        public int received = 800;
        public int blocked = 200;
        public int kills = 2;
        public int shots = 10;
        public int hits = 8;
        public int pens = 6;
        public int earned;
        public int seized;
        public boolean survived = true;
        public double survivalTimeSec = 300;
        public String nickname = "";
        public String clan = "";

        public PlayerSpec(final long accountId, final int team) {
            this.accountId = accountId;
            this.team = team;
            this.nickname = "P" + accountId;
        }
    }

    /** 默认合法 7v7（队1 clan=AAA，队2 clan=BBB，胜方=winner）。 */
    public static Battle sevenVsSeven(final int winner) {
        final List<PlayerSpec> specs = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            final PlayerSpec s = new PlayerSpec(1000L + i, 1);
            s.damage = 300 + i * 150;
            s.clan = "AAA";
            specs.add(s);
        }
        for (int i = 1; i <= 7; i++) {
            final PlayerSpec s = new PlayerSpec(2000L + i, 2);
            s.damage = 200 + i * 120;
            s.clan = "BBB";
            specs.add(s);
        }
        return battle(winner, specs);
    }

    public static Battle battle(final Integer winnerTeam, final List<PlayerSpec> specs) {
        final Battle battle = new Battle();
        battle.arenaId = "arena-1";
        battle.winnerTeam = winnerTeam;
        battle.arenaBonusType = 2;
        battle.mapName = "italy";
        battle.durationS = 300.0;
        battle.rosterComplete = true;
        // League 专属结算证据（synthetic 构造：结算由同一 players 列表驱动，视为覆盖且队伍一致）
        battle.settlementAccountsCoveredByRoster = true;
        battle.settlementRosterTeamConsistent = true;
        battle.players = new ArrayList<>();
        for (final PlayerSpec s : specs) {
            final PlayerResult p = new PlayerResult();
            p.accountId = s.accountId;
            p.team = s.team;
            p.tankId = s.tankId;
            p.damageDealt = s.damage;
            p.damageAssisted = s.assist;
            p.damageReceived = s.received;
            p.damageBlocked = s.blocked;
            p.kills = s.kills;
            p.nShots = s.shots;
            p.nHitsDealt = s.hits;
            p.nPenetrationsDealt = s.pens;
            p.victoryPointsEarned = s.earned;
            p.victoryPointsSeized = s.seized;
            p.survived = s.survived;
            p.survivalTimeSec = s.survivalTimeSec;
            // PR147: settlement lifeTime is the only authority (field24); the compatibility
            // survivalTimeSec projection is never the parsed value.
            p.settlementLifeTimeSec = s.survivalTimeSec;
            p.deathTimeMillis = !s.survived && s.survivalTimeSec > 0
                    ? Math.round(s.survivalTimeSec * 1000.0) : 0L;
            p.nickname = s.nickname;
            p.clan = s.clan;
            battle.players.add(p);
        }
        return battle;
    }

    /** 编码成 .wotbreplay zip 字节（meta + pickle + protobuf）。 */
    public static byte[] replayBytes(final Battle battle, final int arenaBonusType) throws IOException {
        return replayBytes(battle, arenaBonusType, List.of());
    }

    /**
     * 编码成 .wotbreplay zip 字节，名册 #201 额外包含 {@code extraRosterAccounts}
     * （只写 #201，不写 #301——真实训练赛名册可含 non-combatant，probe shape：
     * 20260725_1535 训练房 #201=15 / #301=14，extra=观战者账号，ActualCombatantSet==#301）。
     */
    public static byte[] replayBytes(final Battle battle, final int arenaBonusType,
                                     final List<Long> extraRosterAccounts) throws IOException {
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        final String meta = "{\"version\":\"1.0\",\"mapName\":\"italy\",\"battleDuration\":300,"
                + "\"battleStartTime\":1683152279,\"arenaBonusType\":" + arenaBonusType + "}";
        entries.put("meta.json", meta.getBytes(StandardCharsets.UTF_8));
        // Keep a valid stream header for the synthetic archive. The settlement parser consumes its
        // business facts from battle_results.dat; the header version remains metadata only.
        entries.put("data.wotreplay", dataWotreplayHeader("11.19.0_china"));
        entries.put("battle_results.dat", pickle(battle.arenaId,
                rootProtobuf(battle, extraRosterAccounts)));
        final ByteArrayOutputStream zip = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(zip)) {
            for (final Map.Entry<String, byte[]> e : entries.entrySet()) {
                z.putNextEntry(new ZipEntry(e.getKey()));
                z.write(e.getValue());
                z.closeEntry();
            }
        }
        return zip.toByteArray();
    }

    /**
     * data.wotreplay 头部（仅版本信息；不含 packet stream——ReplayParser 只读 header 的 clientVersion）。
     * 格式：magic(4B LE) + unknown(8B) + hashLen(1B)+hash + versionLen(1B)+version + padding(1B).
     */
    static byte[] dataWotreplayHeader(final String clientVersion) {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        // magic = 0x12345678 (little-endian)
        out.write(0x78);
        out.write(0x56);
        out.write(0x34);
        out.write(0x12);
        out.writeBytes(new byte[8]); // unknown header bytes
        out.write(0); // hashLen = 0
        final byte[] v = clientVersion.getBytes(StandardCharsets.UTF_8);
        out.write(v.length);
        out.writeBytes(v);
        out.write(0); // padding
        return out.toByteArray();
    }

    static byte[] rootProtobuf(final Battle battle) throws IOException {
        return rootProtobuf(battle, List.of());
    }

    static byte[] rootProtobuf(final Battle battle, final List<Long> extraRosterAccounts) throws IOException {
        final ByteArrayOutputStream root = new ByteArrayOutputStream();
        if (battle.winnerTeam != null) {
            writeField(root, 3, battle.winnerTeam);
        }
        // #201 名册额外 non-combatant 条目（账号 + 队伍，不写 #301）
        for (final long extra : extraRosterAccounts) {
            final ByteArrayOutputStream info = new ByteArrayOutputStream();
            writeStringField(info, 1, "extra-" + extra);
            writeField(info, 3, 2);
            final ByteArrayOutputStream rosterEntry = new ByteArrayOutputStream();
            writeField(rosterEntry, 1, extra);
            writeBytesField(rosterEntry, 2, info.toByteArray());
            writeBytesField(root, 201, rosterEntry.toByteArray());
        }
        final Map<Long, PlayerResult> byAccount = new LinkedHashMap<>();
        for (final PlayerResult p : battle.players) {
            byAccount.put(p.accountId, p);
        }
        for (final PlayerResult p : byAccount.values()) {
            final ByteArrayOutputStream info = new ByteArrayOutputStream();
            writeStringField(info, 1, p.nickname);
            writeStringField(info, 5, p.clan);
            final ByteArrayOutputStream rosterEntry = new ByteArrayOutputStream();
            writeField(rosterEntry, 1, p.accountId);
            writeBytesField(rosterEntry, 2, info.toByteArray());
            writeBytesField(root, 201, rosterEntry.toByteArray());
        }
        for (final PlayerResult p : byAccount.values()) {
            final ByteArrayOutputStream info = new ByteArrayOutputStream();
            writeField(info, 101, p.accountId);
            writeField(info, 102, p.team);
            writeField(info, 103, p.tankId);
            writeField(info, 4, p.nShots);
            writeField(info, 5, p.nHitsDealt);
            writeField(info, 7, p.nPenetrationsDealt);
            writeField(info, 8, p.damageDealt);
            writeField(info, 9, p.damageAssisted);
            writeField(info, 11, p.damageReceived);
            writeField(info, 18, p.kills);
            writeField(info, 117, p.damageBlocked);
            writeField(info, 32, p.victoryPointsEarned);
            writeField(info, 33, p.victoryPointsSeized);
            // PR147 production contract: #105 deathReason + #24 lifeTime (seconds), never #104
            // deathTimeMillis; #25 killerID (result/entity-id namespace) only when known.
            writeField(info, 105, p.survived ? -1 : 0);
            if (p.settlementLifeTimeSec > 0) {
                writeField(info, 24, (long) Math.round(p.settlementLifeTimeSec));
            }
            if (!p.survived && p.settlementKillerResultEntityId != null) {
                writeField(info, 25, p.settlementKillerResultEntityId);
            }
            final ByteArrayOutputStream resultEntry = new ByteArrayOutputStream();
            writeBytesField(resultEntry, 2, info.toByteArray());
            writeBytesField(root, 301, resultEntry.toByteArray());
        }
        return root.toByteArray();
    }

    static byte[] pickle(final String arenaId, final byte[] protobuf) throws IOException {
        final long id = Long.parseLong(arenaId);
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x80);
        out.write(0x04);
        out.write('(');
        out.write(0x8a);
        out.write(8);
        for (int b = 0; b < 8; b++) {
            out.write((int) ((id >>> (8 * b)) & 0xFF));
        }
        out.write('B');
        writeIntLE(out, protobuf.length);
        out.write(protobuf);
        out.write('t');
        out.write('.');
        return out.toByteArray();
    }

    static void writeField(final ByteArrayOutputStream out, final int field, final long value) throws IOException {
        writeVarint(out, (field << 3));
        writeVarint(out, value);
    }

    static void writeBytesField(final ByteArrayOutputStream out, final int field, final byte[] value) throws IOException {
        writeVarint(out, (field << 3) | 2);
        writeVarint(out, value.length);
        out.write(value);
    }

    static void writeStringField(final ByteArrayOutputStream out, final int field, final String value) throws IOException {
        writeBytesField(out, field, value.getBytes(StandardCharsets.UTF_8));
    }

    private static void writeVarint(final ByteArrayOutputStream out, final long value) throws IOException {
        long v = value;
        while ((v & ~0x7FL) != 0) {
            out.write((int) ((v & 0x7F) | 0x80));
            v >>>= 7;
        }
        out.write((int) v);
    }

    private static void writeIntLE(final ByteArrayOutputStream out, final int value) throws IOException {
        out.write(value & 0xFF);
        out.write((value >>> 8) & 0xFF);
        out.write((value >>> 16) & 0xFF);
        out.write((value >>> 24) & 0xFF);
    }
}

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
            p.nickname = s.nickname;
            p.clan = s.clan;
            battle.players.add(p);
        }
        return battle;
    }

    /** 编码成 .wotbreplay zip 字节（meta + pickle + protobuf）。 */
    public static byte[] replayBytes(final Battle battle, final int arenaBonusType) throws IOException {
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        final String meta = "{\"version\":\"1.0\",\"mapName\":\"italy\",\"battleDuration\":300,"
                + "\"battleStartTime\":1683152279,\"arenaBonusType\":" + arenaBonusType + "}";
        entries.put("meta.json", meta.getBytes(StandardCharsets.UTF_8));
        entries.put("battle_results.dat", pickle(battle.arenaId, rootProtobuf(battle)));
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

    static byte[] rootProtobuf(final Battle battle) throws IOException {
        final ByteArrayOutputStream root = new ByteArrayOutputStream();
        if (battle.winnerTeam != null) {
            writeField(root, 3, battle.winnerTeam);
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
            writeField(info, 105, p.survived ? -1 : 0);
            if (!p.survived) {
                writeField(info, 104, (long) (p.survivalTimeSec * 1000));
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

package com.wotb.core.league;

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

/** League Rating 测试夹具：7v7 Battle 构造 + .wotbreplay 字节合成（zip/pickle/protobuf）。 */
public final class LeagueTestBattles {

    private LeagueTestBattles() {
    }

    /** 一名玩家的可配置规格（默认值构成合法 7v7）。 */
    public static final class PlayerSpec {
        public long accountId;
        public int team;
        public long tankId = 4481;
        public int damage;
        public int assist;
        public int received;
        public int blocked;
        public int kills;
        public int shots;
        public int hits;
        public int pens;
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

        public PlayerSpec damage(final int v) { this.damage = v; return this; }
        public PlayerSpec assist(final int v) { this.assist = v; return this; }
        public PlayerSpec received(final int v) { this.received = v; return this; }
        public PlayerSpec blocked(final int v) { this.blocked = v; return this; }
        public PlayerSpec kills(final int v) { this.kills = v; return this; }
        public PlayerSpec shots(final int v) { this.shots = v; return this; }
        public PlayerSpec hits(final int v) { this.hits = v; return this; }
        public PlayerSpec pens(final int v) { this.pens = v; return this; }
        public PlayerSpec points(final int earned, final int seized) { this.earned = earned; this.seized = seized; return this; }
        public PlayerSpec dead(final double survivalTimeSec) {
            this.survived = false;
            this.survivalTimeSec = survivalTimeSec;
            return this;
        }
        public PlayerSpec clan(final String c) { this.clan = c; return this; }
    }

    /** 默认合法 7v7：账号 1001-1007 (队1)、2001-2007 (队2)；全部存活 300s；伤害 300-1500。 */
    public static List<PlayerSpec> defaultSevenVsSeven() {
        final List<PlayerSpec> specs = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            specs.add(new PlayerSpec(1000L + i, 1)
                    .damage(300 + i * 150).assist(100 + i).blocked(200 + i * 20)
                    .kills(i / 2).shots(8 + i).hits(4 + i / 2).pens(3 + i / 3)
                    .points(i * 10, i * 5).clan("AAA"));
        }
        for (int i = 1; i <= 7; i++) {
            specs.add(new PlayerSpec(2000L + i, 2)
                    .damage(200 + i * 120).assist(80 + i).blocked(150 + i * 15)
                    .kills(i / 3).shots(7 + i).hits(3 + i / 2).pens(2 + i / 3)
                    .points(i * 8, i * 4).clan("BBB"));
        }
        return specs;
    }

    /** 从规格构建 Battle（rosterComplete=true；winnerTeam 需指定）。 */
    public static Battle battle(final Integer winnerTeam, final List<PlayerSpec> specs) {
        final Battle battle = new Battle();
        battle.arenaId = "arena-1";
        battle.winnerTeam = winnerTeam;
        battle.arenaBonusType = LeagueRatingMode.ARENA_BONUS_TYPE_TRAINING;
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
            p.settlementLifeTimeSec = s.survivalTimeSec;
            p.deathTimeMillis = !s.survived && s.survivalTimeSec > 0
                    ? Math.round(s.survivalTimeSec * 1000.0) : 0L;
            p.nickname = s.nickname;
            p.clan = s.clan;
            p.raw = new LinkedHashMap<>();
            battle.players.add(p);
        }
        return battle;
    }

    // ---- .wotbreplay 字节合成（LeagueReplaysTest 用） ----

    /** 把 battle 编码成 .wotbreplay zip 字节（meta + pickle(arenaId, protobuf)）。 */
    public static byte[] replayBytes(final Battle battle, final int arenaBonusType) throws IOException {
        return replayBytes(battle, arenaBonusType, List.of());
    }

    /**
     * 编码 .wotbreplay 字节，名册 #201 额外包含 {@code extraRosterAccounts}
     * （只写 #201 不写 #301——真实训练赛名册可含 non-combatant，probe shape：
     * 20260725_1535 训练房 #201=15 / #301=14，ActualCombatantSet == #301）。
     */
    public static byte[] replayBytes(final Battle battle, final int arenaBonusType,
                                     final List<Long> extraRosterAccounts) throws IOException {
        final Map<String, byte[]> entries = new LinkedHashMap<>();
        final String meta = "{\"version\":\"1.0\",\"mapName\":\"italy\",\"battleDuration\":300,"
                + "\"battleStartTime\":1683152279,\"arenaBonusType\":" + arenaBonusType + "}";
        entries.put("meta.json", meta.getBytes(StandardCharsets.UTF_8));
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

    /** battle_results protobuf 根消息：#3 winner + #201 名册 + #301 战绩。 */
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
            // PR147 production contract: #105 = deathReason (-1 = survivor sentinel); #24 = lifeTime
            // (seconds; dead = settlement death seconds, survivor = whole battle duration). Never write
            // the legacy #104 deathTimeMillis. #25 killerID (result/entity-id namespace) only when known.
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

    /** 最小 pickle：PROTO 4 + MARK + LONG1(arenaId) + BINBYTES(protobuf) + TUPLE + STOP。 */
    static byte[] pickle(final String arenaId, final byte[] protobuf) throws IOException {
        final long id = Long.parseLong(arenaId);
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x80);
        out.write(0x04);
        out.write('(');
        out.write(0x8a); // LONG1
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

    // ---- protobuf 编码 ----

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

package com.wotb.web.tournament;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Executes the reviewed seed against real PostgreSQL, including administrator-owned data. */
@Testcontainers(disabledWithoutDocker = true)
class BroadcastSeedMigrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    private static final JsonMapper JSON = new JsonMapper();
    private static final String SEED = "db/migration/V40__seed_verified_broadcast_matches.sql";
    private JdbcTemplate jdbc;

    @BeforeEach void legacyDatabase() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()));
        final Flyway legacy = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword())
                .cleanDisabled(false).target("39").load();
        legacy.clean(); legacy.migrate();
        assertCounts(0,0,0,0);
    }
    @Test void v42AddsNullableInstantWithoutChangingExistingReplayDatesOrContent() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("41").load().migrate();
        final var original = jdbc.queryForList("select id,title,url,match_date,day_number,group_number,teams,perspective from tournament_broadcast_replay order by id");
        final Flyway current = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("42").load();
        current.migrate(); current.validate();
        assertEquals("42",current.info().current().getVersion().toString());
        assertEquals(original,jdbc.queryForList("select id,title,url,match_date,day_number,group_number,teams,perspective from tournament_broadcast_replay order by id"));
        assertEquals(3,jdbc.queryForObject("select count(*) from tournament_broadcast_replay where match_starts_at is null",Integer.class));
    }
    @Test void freshUpgradeImportsExactlyTheReviewedIndividualMatches() throws Exception {
        migrate(); assertCounts(1,1,1,3);
        final String source = Files.readString(Path.of("..","..","docs","research","broadcast-seed-2025-2026","seed-ready.json"),StandardCharsets.UTF_8).replace("\r\n","\n");
        final String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)));
        assertTrue(seedSql().contains("Source SHA-256 (UTF-8, LF): " + hash));
        final var entries = JSON.readTree(source).get("entries");
        final var saved = jdbc.queryForList("select replay.*,season.server,season.year,season.name_zh,season.name_en,season.name_ru,season.start_date,category.type as category_type,node.root_key,node.round_number,node.format "
                + "from tournament_broadcast_replay replay join tournament_broadcast_node node on node.id=replay.node_id "
                + "join tournament_broadcast_category category on category.id=node.category_id "
                + "join tournament_broadcast_season season on season.id=category.season_id order by replay.id");
        assertEquals(entries.size(),saved.size());
        for (int index = 0; index < saved.size(); index++) {
            final var expected = entries.get(index); final var replay = expected.get("replay"); final var row = saved.get(index);
            assertEquals(expected.get("server").asText(),row.get("server"));
            assertEquals(expected.get("year").asInt(),row.get("year"));
            assertEquals(expected.get("season").get("nameZh").asText(),row.get("name_zh"));
            assertEquals(expected.get("season").get("nameEn").asText(),row.get("name_en"));
            assertNull(row.get("name_ru")); assertNull(row.get("start_date"));
            assertEquals(expected.get("categoryType").asText(),row.get("category_type"));
            assertEquals(0,row.get("root_key")); assertNull(row.get("round_number")); assertNull(row.get("format"));
            assertEquals(replay.get("title").asText(),row.get("title")); assertEquals(replay.get("url").asText(),row.get("url"));
            assertEquals(replay.get("matchDate").asText(),row.get("match_date").toString());
            assertEquals(replay.get("dayNumber").asInt(),row.get("day_number"));
            assertEquals(replay.get("groupNumber").asInt(),row.get("group_number"));
            assertEquals(replay.get("bracket").asText(),row.get("bracket"));
            assertEquals(replay.get("perspective").asText(),row.get("perspective"));
            assertEquals(replay.get("teams"),JSON.readTree(row.get("teams").toString())); assertNull(row.get("cover_id"));
        }
        assertEquals(1L,jdbc.queryForObject("select version from tournament_broadcast_season",Long.class));
    }
    @Test void manualRetriesNeitherDuplicateRowsNorOverwriteLaterAdministratorEdits() throws Exception {
        migrate();
        jdbc.update("update tournament_broadcast_season set name_zh='管理员中文',name_en='Administrator English',name_ru='Администратор',version=9");
        jdbc.update("update tournament_broadcast_replay set title='Administrator title' where url like '%p=1'");
        final var seasonsBefore = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final var replaysBefore = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        jdbc.execute(seedSql()); jdbc.execute(seedSql());
        assertCounts(1,1,1,3);
        assertEquals(seasonsBefore,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
        assertEquals(replaysBefore,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
    }
    @Test void existingTrackedBilibiliPartIsPreservedWhileOnlyMissingPartsAreAdded() throws Exception {
        final long season = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name_zh,name_en,name_ru,created_at,version) "
                + "values ('CN',2025,'管理员自定义赛事','Administrator English','Администратор',now(),7) returning id",Long.class);
        final long category = jdbc.queryForObject("insert into tournament_broadcast_category(season_id,type) values (?,'SEMI_FINALS') returning id",Long.class,season);
        final long root = jdbc.queryForObject("insert into tournament_broadcast_node(category_id,root_key) values (?,0) returning id",Long.class,category);
        final String tracked = "https://www.bilibili.com/video/BV18j2CBWEMo/?spm_id_from=333.337.search-card.all.click&p=2&vd_source=test";
        final long existing = jdbc.queryForObject("insert into tournament_broadcast_replay(node_id,title,url,match_date,day_number,group_number,bracket,teams,perspective,created_at) "
                + "values (?,'Administrator title',?,'2025-12-07',3,1,'DEFAULT','[\"Own1\",\"Own2\"]','POV',now()) returning id",Long.class,root,tracked);
        final var before = jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",existing);
        try (final var administrator = DriverManager.getConnection(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());
             final var seed = DriverManager.getConnection(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());
             final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            administrator.setAutoCommit(false);
            try (final var statement = administrator.prepareStatement("select id from tournament_broadcast_season where id=? for update")) {
                statement.setLong(1,season); statement.executeQuery().close();
            }
            final int seedPid;
            try (final var statement = seed.createStatement(); final var result = statement.executeQuery("select pg_backend_pid()")) {
                assertTrue(result.next()); seedPid = result.getInt(1);
            }
            final String sql = seedSql();
            final var migration = executor.submit(() -> {
                try (final var statement = seed.createStatement()) { statement.setQueryTimeout(10); statement.execute(sql); }
                return null;
            });
            // Observe the real lock wait rather than relying on thread scheduling or a fixed sleep.
            await().atMost(Duration.ofSeconds(10)).until(() -> jdbc.queryForObject(
                    "select exists(select 1 from pg_locks where pid=? and relation='tournament_broadcast_season'::regclass and mode='ExclusiveLock' and not granted)",Boolean.class,seedPid));
            assertCounts(1,1,1,1); // Ordinary readers stay available while the seed waits.
            try (final var statement = administrator.createStatement()) {
                statement.setQueryTimeout(10); statement.executeUpdate("update tournament_broadcast_season set version=version+1 where id="+season);
            }
            administrator.commit(); migration.get(10,TimeUnit.SECONDS);
        }
        assertCounts(1,1,1,3);
        assertEquals(before,jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",existing));
        assertEquals("管理员自定义赛事",jdbc.queryForObject("select name_zh from tournament_broadcast_season",String.class));
        assertEquals("Administrator English",jdbc.queryForObject("select name_en from tournament_broadcast_season",String.class));
        assertEquals("Администратор",jdbc.queryForObject("select name_ru from tournament_broadcast_season",String.class));
        assertEquals(9L,jdbc.queryForObject("select version from tournament_broadcast_season",Long.class));
        assertEquals(List.of("四强赛 CHRD VS -ACE-","四强赛 Ru7K1 VS KSR"),jdbc.queryForList("select title from tournament_broadcast_replay where id<>? order by id",String.class,existing));
        jdbc.execute(seedSql()); assertCounts(1,1,1,3);
        assertEquals(9L,jdbc.queryForObject("select version from tournament_broadcast_season",Long.class));
    }
    @Test void ambiguousExistingSeasonsSkipTheSeedWithoutGuessingAnOwner() {
        jdbc.update("insert into tournament_broadcast_season(server,year,name_zh,name_en,created_at,version) values ('CN',2025,'战火杯','First',now(),3),('CN',2025,'另一个赛事','Zhanhuo Cup',now(),4)");
        final var before = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        migrate(); assertCounts(2,0,0,0);
        assertEquals(before,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
    }
    @Test void partsAlreadySplitAcrossSeasonsSkipTheSeedWithoutAddingOrMovingAnything() throws Exception {
        createSeasonWithPart("CN",2025,"First administrator season",1);
        createSeasonWithPart("CN",2025,"Second administrator season",2);
        final var seasonsBefore = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final var replaysBefore = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        migrate(); jdbc.execute(seedSql());
        assertCounts(2,2,2,2);
        assertEquals(seasonsBefore,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
        assertEquals(replaysBefore,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
    }
    @ParameterizedTest
    @CsvSource({"EU,2025","CN,2026"})
    void partsInAnotherServerOrYearSkipTheSeed(final String server, final int year) throws Exception {
        createSeasonWithPart(server,year,"Administrator season",1);
        final var seasonsBefore = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final var replaysBefore = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        migrate(); jdbc.execute(seedSql());
        assertCounts(1,1,1,1);
        assertEquals(seasonsBefore,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
        assertEquals(replaysBefore,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
    }
    @Test void officialCupNameCorrectionPreservesReplayFactsAndIsIdempotent() throws Exception {
        migrate();
        jdbc.update("update tournament_broadcast_season set name_ru='Кубок администратора'");
        final long oldVersion = jdbc.queryForObject("select version from tournament_broadcast_season",Long.class);
        final var replays = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("41").load().migrate();
        assertEquals("Blitz Professional Cup (BPC)",jdbc.queryForObject("select name_en from tournament_broadcast_season",String.class));
        assertEquals("战火杯",jdbc.queryForObject("select name_zh from tournament_broadcast_season",String.class));
        assertEquals("Кубок администратора",jdbc.queryForObject("select name_ru from tournament_broadcast_season",String.class));
        assertEquals(oldVersion+1,jdbc.queryForObject("select version from tournament_broadcast_season",Long.class));
        assertEquals(replays,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
        final var corrected = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final String sql = new ClassPathResource("db/migration/V41__correct_blitz_professional_cup_name.sql").getContentAsString(StandardCharsets.UTF_8);
        jdbc.execute(sql); jdbc.execute(sql);
        assertEquals(corrected,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
    }
    @ParameterizedTest
    @CsvSource({"战火杯,Administrator name", "管理员赛事,Zhanhuo Cup"})
    void cupNameCorrectionDoesNotReplaceAdministratorNames(final String chinese, final String english) {
        migrate();
        jdbc.update("update tournament_broadcast_season set name_zh=?,name_en=?,name_ru='Свой перевод',version=9",chinese,english);
        final var before = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("41").load().migrate();
        assertEquals(before,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
    }
    @Test void cupNameCorrectionRequiresTheSeedVideoAndCorrectServerAndYear() {
        migrate();
        jdbc.update("update tournament_broadcast_season set name_en='Custom English'");
        jdbc.update("insert into tournament_broadcast_season(server,year,name_zh,name_en,created_at,version) values ('CN',2025,'战火杯','Zhanhuo Cup',now(),4)");
        createSeasonWithPart("EU",2025,"Zhanhuo Cup",1);
        createSeasonWithPart("CN",2026,"Zhanhuo Cup",1);
        jdbc.update("update tournament_broadcast_season set name_zh='战火杯'");
        final var before = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("41").load().migrate();
        assertEquals(before,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
    }
    @Test void v43FreshUpgradeMatchesReviewedStreamsAndPreservesPriorSeed() throws Exception {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("42").load().migrate();
        final var prior = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        final Flyway current = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("43").load();
        current.migrate(); current.validate();
        assertEquals("43",current.info().current().getVersion().toString());
        assertCounts(20,29,33,74);
        assertEquals(prior,jdbc.queryForList("select * from tournament_broadcast_replay where url like 'https://www.bilibili.com/%' order by id"));
        final String source = Files.readString(Path.of("..","..","docs","research","broadcast-seed-2025-2026","seed-ready-2025-2026-verified.json"),StandardCharsets.UTF_8).replace("\r\n","\n");
        final String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)));
        assertTrue(verifiedSeedSql().contains("Source SHA-256 (UTF-8, LF): " + hash));
        final var entries = JSON.readTree(source).get("entries"); assertEquals(71,entries.size());
        for (final var entry : entries) {
            final var replay = entry.get("replay");
            final var row = jdbc.queryForMap("select replay.*,season.server,season.year,season.name_zh,season.name_en,season.name_ru,season.start_date,category.type as category_type,node.round_number,node.format "
                    + "from tournament_broadcast_replay replay join tournament_broadcast_node node on node.id=replay.node_id "
                    + "join tournament_broadcast_category category on category.id=node.category_id join tournament_broadcast_season season on season.id=category.season_id where replay.url=?",replay.get("url").asText());
            assertEquals(entry.get("server").asText(),row.get("server")); assertEquals(entry.get("year").asInt(),row.get("year"));
            assertEquals(entry.get("season").get("nameZh").asText(),row.get("name_zh")); assertEquals(entry.get("season").get("nameEn").asText(),row.get("name_en"));
            if (entry.get("season").get("nameRu").isNull()) { assertNull(row.get("name_ru")); }
            else { assertEquals(entry.get("season").get("nameRu").asText(),row.get("name_ru")); }
            if (entry.get("season").get("startDate").isNull()) { assertNull(row.get("start_date")); }
            else { assertEquals(entry.get("season").get("startDate").asText(),row.get("start_date").toString()); }
            assertEquals(entry.get("categoryType").asText(),row.get("category_type"));
            if (entry.get("node").get("format").isNull()) { assertNull(row.get("format")); }
            else { assertEquals(entry.get("node").get("format").asText(),row.get("format")); }
            if (entry.get("node").get("roundNumber").isNull()) { assertNull(row.get("round_number")); }
            else { assertEquals(entry.get("node").get("roundNumber").asInt(),row.get("round_number")); }
            assertEquals(replay.get("title").asText(),row.get("title")); assertEquals(replay.get("matchDate").asText(),row.get("match_date").toString());
            // The source timestamp starts the whole stream, not this selected battle.
            assertTrue(replay.get("startsAt").isNull()); assertNull(row.get("match_starts_at"));
            assertEquals(replay.get("dayNumber").asInt(),row.get("day_number"));
            if (replay.get("groupNumber").isNull()) { assertNull(row.get("group_number")); } else { assertEquals(replay.get("groupNumber").asInt(),row.get("group_number")); }
            assertEquals(replay.get("matchDate").asText(),java.time.OffsetDateTime.parse(entry.get("streamStartedAt").asText())
                    .atZoneSameInstant(java.time.ZoneId.of(entry.get("dateTimeZone").asText())).toLocalDate().toString());
            if (replay.get("bracket").isNull()) { assertNull(row.get("bracket")); } else { assertEquals(replay.get("bracket").asText(),row.get("bracket")); }
            assertEquals(replay.get("teams"),JSON.readTree(row.get("teams").toString())); assertEquals(replay.get("perspective").asText(),row.get("perspective"));
        }
        // Official New Horizons DE spans March 15–16; stream-title "Day 3" is not the stage day.
        for (final String video : List.of("VWT0AE2RmWc","GU9PXRxLG2I","2Te4Q2hwn7g","1rPFxY60wXs")) {
            final var corrected = jdbc.queryForMap("select replay.match_date,replay.day_number,season.year,season.name_en,category.type "
                    + "from tournament_broadcast_replay replay join tournament_broadcast_node node on node.id=replay.node_id "
                    + "join tournament_broadcast_category category on category.id=node.category_id join tournament_broadcast_season season on season.id=category.season_id where replay.url=?",
                    "https://www.youtube.com/watch?v="+video);
            assertEquals("2025-03-16",corrected.get("match_date").toString()); assertEquals(2,corrected.get("day_number"));
            assertEquals(2025,corrected.get("year")); assertEquals("Blitz Masters: New Horizons",corrected.get("name_en"));
            assertEquals("SEMI_FINALS",corrected.get("type"));
        }
        final var challengers = jdbc.queryForMap("select replay.node_id,replay.match_date,replay.day_number,season.id as season_id,season.server,season.year,season.name_en "
                + "from tournament_broadcast_replay replay join tournament_broadcast_node node on node.id=replay.node_id "
                + "join tournament_broadcast_category category on category.id=node.category_id join tournament_broadcast_season season on season.id=category.season_id "
                + "where replay.url='https://www.youtube.com/watch?v=OyMQG6OR27o'");
        final var professionals = jdbc.queryForMap("select replay.node_id,category.season_id from tournament_broadcast_replay replay "
                + "join tournament_broadcast_node node on node.id=replay.node_id join tournament_broadcast_category category on category.id=node.category_id "
                + "where replay.url='https://www.youtube.com/watch?v=guIa_J5h9bI'");
        assertEquals("EU",challengers.get("server")); assertEquals(2025,challengers.get("year"));
        assertEquals("Blitz Diamond Cup — Challengers",challengers.get("name_en"));
        assertEquals("2025-09-05",challengers.get("match_date").toString()); assertEquals(1,challengers.get("day_number"));
        assertNotEquals(professionals.get("season_id"),challengers.get("season_id"));
        assertNotEquals(professionals.get("node_id"),challengers.get("node_id"));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_broadcast_replay where match_starts_at is not null",Integer.class));
        jdbc.update("update tournament_broadcast_season set name_zh='Own zh',name_en='Own en',name_ru='Own ru',start_date='2026-01-01',version=9 where server='EU'");
        jdbc.update("update tournament_broadcast_replay set title='Own title',teams='[\"Own1\",\"Own2\"]'::jsonb,match_starts_at='2026-01-01T08:00:00Z',match_date='2026-01-01' where url like 'https://www.youtube.com/%'");
        assertEquals(71,jdbc.queryForObject("select count(*) from tournament_broadcast_replay where match_starts_at is not null",Integer.class));
        final var seasons = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final var replays = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        jdbc.execute(verifiedSeedSql()); jdbc.execute(verifiedSeedSql());
        assertCounts(20,29,33,74); assertEquals(seasons,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
        assertEquals(replays,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
    }
    @ParameterizedTest
    @CsvSource({"https://www.youtube.com/watch?feature=share&v=FXGodwWu1cw&t=30", "https://youtu.be/FXGodwWu1cw?si=test", "https://www.youtube.com/live/FXGodwWu1cw?feature=share"})
    void v43ReusesCustomOwnerAcrossYoutubeUrlFormsWithoutOverwriting(final String url) throws Exception {
        prepareVerifiedSeed();
        final long owner = createSeasonWithYoutube("EU",2026,"Custom event",url);
        final var before = jdbc.queryForMap("select * from tournament_broadcast_replay");
        final var seasonBefore = jdbc.queryForMap("select name_zh,name_en,name_ru,start_date from tournament_broadcast_season where id=?",owner);
        jdbc.execute(verifiedSeedSql());
        // The administrator's existing video stays in its Top 4 node; no empty PYS #1 node is created.
        assertCounts(19,28,31,71);
        assertEquals(before,jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",before.get("id")));
        assertEquals(seasonBefore,jdbc.queryForMap("select name_zh,name_en,name_ru,start_date from tournament_broadcast_season where id=?",owner));
        assertEquals(6L,jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,owner));
        assertEquals(8,jdbc.queryForObject("select count(*) from tournament_broadcast_replay replay join tournament_broadcast_node node on node.id=replay.node_id join tournament_broadcast_category category on category.id=node.category_id where category.season_id=?",Integer.class,owner));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_broadcast_node node join tournament_broadcast_category category on category.id=node.category_id where category.season_id=? and category.type='POINTS' and node.round_number=1",Integer.class,owner));
        jdbc.execute(verifiedSeedSql()); assertCounts(19,28,31,71);
        assertEquals(6L,jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,owner));
    }
    @Test void v43SplitSourceOwnershipSkipsWholeEventAndStillImportsOtherEvents() throws Exception {
        prepareVerifiedSeed();
        final long first = createSeasonWithYoutube("EU",2026,"First owner","https://youtu.be/FXGodwWu1cw");
        final long second = createSeasonWithYoutube("EU",2026,"Second owner","https://youtube.com/live/ZcwvTGyUP9M");
        final var before = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        jdbc.execute(verifiedSeedSql());
        assertEquals(65,jdbc.queryForObject("select count(*) from tournament_broadcast_replay",Integer.class));
        assertEquals(before,jdbc.queryForList("select * from tournament_broadcast_replay where id in (?,?) order by id",before.get(0).get("id"),before.get(1).get("id")));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_broadcast_replay where url like '%_u3nHqOfX5s%'",Integer.class));
        assertEquals(List.of(5L,5L),jdbc.queryForList("select version from tournament_broadcast_season where id in (?,?) order by id",Long.class,first,second));
    }
    @ParameterizedTest
    @CsvSource({"NA,2026", "EU,2025"})
    void v43SourceInWrongRegionOrYearSkipsWholeEvent(final String server, final int year) throws Exception {
        prepareVerifiedSeed(); createSeasonWithYoutube(server,year,"Wrong owner","https://www.youtube.com/watch?v=FXGodwWu1cw");
        final var before = jdbc.queryForMap("select * from tournament_broadcast_replay"); jdbc.execute(verifiedSeedSql());
        assertEquals(64,jdbc.queryForObject("select count(*) from tournament_broadcast_replay",Integer.class));
        assertEquals(before,jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",before.get("id")));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_broadcast_season where server='EU' and name_en='Spring Games'",Integer.class));
    }
    @Test void v43AmbiguousDefaultNamesSkipOnlyThatEvent() throws Exception {
        prepareVerifiedSeed();
        jdbc.update("insert into tournament_broadcast_season(server,year,name_zh,name_en,created_at,version) values ('EU',2026,'Spring Games','First',now(),3),('EU',2026,'Second','Spring Games',now(),4)");
        final var before = jdbc.queryForList("select * from tournament_broadcast_season order by id"); jdbc.execute(verifiedSeedSql());
        assertEquals(63,jdbc.queryForObject("select count(*) from tournament_broadcast_replay",Integer.class));
        assertEquals(before,jdbc.queryForList("select * from tournament_broadcast_season where id in (?,?) order by id",before.get(0).get("id"),before.get(1).get("id")));
    }
    @ParameterizedTest
    @CsvSource({"https://example.org/watch?v=FXGodwWu1cw", "https://youtube.com.evil.invalid/watch?v=FXGodwWu1cw", "https://youtube.com@evil.invalid/watch?v=FXGodwWu1cw", "https://www.youtube.com/watch?redirect=https://example.org/?v=FXGodwWu1cw"})
    void v43UnrelatedUrlsDoNotClaimYoutubeVideoOwnership(final String url) throws Exception {
        prepareVerifiedSeed(); createSeasonWithYoutube("NA",2025,"Unrelated",url); jdbc.execute(verifiedSeedSql());
        assertEquals(72,jdbc.queryForObject("select count(*) from tournament_broadcast_replay",Integer.class));
        assertEquals(3,jdbc.queryForObject("select count(*) from tournament_broadcast_season where server='EU' and year=2026",Integer.class));
    }
    @Test void v43ConflictingKnockoutRootPreservesAdministratorFactsAndSkipsOnlyRoundRobinStream() throws Exception {
        prepareVerifiedSeed();
        final long owner = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name_zh,name_en,name_ru,start_date,created_at,version) "
                + "values ('NA',2026,'Own zh','Spring Games','Own ru','2026-01-01',now(),5) returning id",Long.class);
        final long category = jdbc.queryForObject("insert into tournament_broadcast_category(season_id,type) values (?,'QUARTER_FINALS') returning id",Long.class,owner);
        final long root = jdbc.queryForObject("insert into tournament_broadcast_node(category_id,root_key,format) values (?,0,'KNOCKOUT') returning id",Long.class,category);
        final long replay = jdbc.queryForObject("insert into tournament_broadcast_replay(node_id,title,url,match_date,match_starts_at,day_number,group_number,bracket,teams,perspective,created_at) "
                + "values (?,'Own knockout','https://example.org/own-knockout','2026-03-18','2026-03-19T01:00:00Z',1,2,'WINNERS','[\"Own1\",\"Own2\"]','POV',now()) returning id",Long.class,root);
        final var rootBefore = jdbc.queryForMap("select * from tournament_broadcast_node where id=?",root);
        final var replayBefore = jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",replay);
        final var seasonBefore = jdbc.queryForMap("select name_zh,name_en,name_ru,start_date from tournament_broadcast_season where id=?",owner);
        jdbc.execute(verifiedSeedSql());
        assertCounts(19,28,32,71);
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_broadcast_replay where url='https://www.youtube.com/watch?v=sYURrUAi-oE'",Integer.class));
        assertEquals(70,jdbc.queryForObject("select count(*) from tournament_broadcast_replay where url like 'https://www.youtube.com/%'",Integer.class));
        assertEquals(rootBefore,jdbc.queryForMap("select * from tournament_broadcast_node where id=?",root));
        assertEquals(replayBefore,jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",replay));
        assertEquals(seasonBefore,jdbc.queryForMap("select name_zh,name_en,name_ru,start_date from tournament_broadcast_season where id=?",owner));
        assertEquals(6L,jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,owner));
        jdbc.execute(verifiedSeedSql());
        assertCounts(19,28,32,71);
        assertEquals(6L,jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,owner));
    }
    @Test void v44FreshDatabaseLocalizesAllNamesAndTitlesWithoutRewritingFactsOrAlreadyLocalizedVersions() throws Exception {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("43").load().migrate();
        final var versions = jdbc.queryForList("select id,server,version from tournament_broadcast_season order by id");
        final var facts = jdbc.queryForList("select to_jsonb(replay)-'title' as facts from tournament_broadcast_replay replay order by id");
        final var seasonFacts = jdbc.queryForList("select to_jsonb(season)-ARRAY['name_zh','name_en','name_ru','version'] as facts from tournament_broadcast_season season order by id");
        final Flyway current = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).load();
        current.migrate(); current.validate(); assertEquals("46",current.info().current().getVersion().toString());
        assertCounts(20,29,33,74); assertLocalizedDefaults();
        assertEquals(facts,jdbc.queryForList("select to_jsonb(replay)-'title' as facts from tournament_broadcast_replay replay order by id"));
        assertEquals(seasonFacts,jdbc.queryForList("select to_jsonb(season)-ARRAY['name_zh','name_en','name_ru','version'] as facts from tournament_broadcast_season season order by id"));
        for (final var row : versions) {
            assertEquals(((Number)row.get("version")).longValue()+("CN".equals(row.get("server"))?1:0),jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,row.get("id")));
        }
        final String source = localizationSource();
        assertTrue(localizationSql().contains("Source SHA-256 (UTF-8, LF): "+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8)))));
        final var seasons = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final var replays = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        jdbc.execute(localizationSql()); jdbc.execute(localizationSql());
        assertEquals(seasons,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
        assertEquals(replays,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
    }
    @Test void v44UpgradesAllOldDefaultsAndIncrementsEachSeasonOnlyOnce() throws Exception {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("43").load().migrate();
        for (final JsonNode item : localizationEntries()) {
            jdbc.update("update tournament_broadcast_replay set title=? where url=?",item.get("oldReplay").get("title").asText(),item.get("oldReplay").get("url").asText());
            jdbc.update("update tournament_broadcast_season set name_zh=?,name_en=?,name_ru=?,version=20 where id in (select category.season_id from tournament_broadcast_category category join tournament_broadcast_node node on node.category_id=category.id join tournament_broadcast_replay replay on replay.node_id=node.id where replay.url=?)",
                    textOrNull(item.get("oldSeason").get("nameZh")),textOrNull(item.get("oldSeason").get("nameEn")),textOrNull(item.get("oldSeason").get("nameRu")),item.get("oldReplay").get("url").asText());
        }
        final var facts = jdbc.queryForList("select to_jsonb(replay)-'title' as facts from tournament_broadcast_replay replay order by id");
        jdbc.execute(localizationSql()); assertLocalizedDefaults();
        assertEquals(20,jdbc.queryForObject("select count(*) from tournament_broadcast_season where version=21",Integer.class));
        assertEquals(facts,jdbc.queryForList("select to_jsonb(replay)-'title' as facts from tournament_broadcast_replay replay order by id"));
        jdbc.execute(localizationSql());
        assertEquals(20,jdbc.queryForObject("select count(*) from tournament_broadcast_season where version=21",Integer.class));
    }
    @Test void v44ProtectsAnyEditedNameTupleAndTitleButStillUpdatesIndependentDefaultText() throws Exception {
        prepareVerifiedSeed(); final JsonNode item = localizationEntries().get(0);
        final long allCustom = createLocalizationFixture(item,item.get("oldReplay").get("url").asText(),"EU",2026);
        jdbc.update("update tournament_broadcast_season set name_ru='Own Russian' where id=(select category.season_id from tournament_broadcast_category category join tournament_broadcast_node node on node.category_id=category.id join tournament_broadcast_replay replay on replay.node_id=node.id where replay.id=?)",allCustom);
        jdbc.update("update tournament_broadcast_replay set title='Own title' where id=?",allCustom);
        final long titleOnly = createLocalizationFixture(item,"https://youtu.be/FXGodwWu1cw","EU",2026);
        jdbc.update("update tournament_broadcast_season set name_zh='Own Chinese' where id=(select category.season_id from tournament_broadcast_category category join tournament_broadcast_node node on node.category_id=category.id join tournament_broadcast_replay replay on replay.node_id=node.id where replay.id=?)",titleOnly);
        final long namesOnly = createLocalizationFixture(item,"https://youtube.com/live/FXGodwWu1cw","EU",2026);
        jdbc.update("update tournament_broadcast_replay set title='Own title' where id=?",namesOnly);
        final var namesBefore = jdbc.queryForList("select name_zh,name_en,name_ru from tournament_broadcast_season where name_ru='Own Russian' or name_zh='Own Chinese' order by id");
        jdbc.execute(localizationSql());
        assertEquals(namesBefore,jdbc.queryForList("select name_zh,name_en,name_ru from tournament_broadcast_season where name_ru='Own Russian' or name_zh='Own Chinese' order by id"));
        assertEquals("Own title",jdbc.queryForObject("select title from tournament_broadcast_replay where id=?",String.class,allCustom));
        assertEquals(item.get("newTitle").asText(),jdbc.queryForObject("select title from tournament_broadcast_replay where id=?",String.class,titleOnly));
        assertEquals("Own title",jdbc.queryForObject("select title from tournament_broadcast_replay where id=?",String.class,namesOnly));
        assertEquals(List.of(5L,6L,6L),jdbc.queryForList("select version from tournament_broadcast_season order by id",Long.class));
    }
    @Test void v44DoesNotRelabelAnyChangedBattleFactOrNodeAndPreservesAdministratorTimesAndCovers() throws Exception {
        prepareVerifiedSeed(); final JsonNode points = localizationEntries().get(0);
        final List<String> changes = List.of("match_date=match_date+1","match_starts_at='2026-03-05T20:00:00Z'","day_number=day_number+1","group_number=1","bracket='DEFAULT'","teams='[\"Other1\",\"Other2\"]'::jsonb","perspective='POV'");
        for (final String change : changes) {
            final long id = createLocalizationFixture(points,points.get("oldReplay").get("url").asText(),"EU",2026);
            jdbc.update("update tournament_broadcast_replay set "+change+" where id=?",id);
        }
        final long category = createLocalizationFixture(points,points.get("oldReplay").get("url").asText(),"EU",2026);
        jdbc.update("update tournament_broadcast_category set type='SEMI_FINALS' where id=(select node.category_id from tournament_broadcast_node node join tournament_broadcast_replay replay on replay.node_id=node.id where replay.id=?)",category);
        final long round = createLocalizationFixture(points,points.get("oldReplay").get("url").asText(),"EU",2026);
        jdbc.update("update tournament_broadcast_node set round_number=2,root_key=2 where id=(select node_id from tournament_broadcast_replay where id=?)",round);
        final JsonNode rr = java.util.stream.StreamSupport.stream(localizationEntries().spliterator(),false)
                .filter(item -> "ROUND_ROBIN".equals(textOrNull(item.get("node").get("format")))).findFirst().orElseThrow();
        final long format = createLocalizationFixture(rr,rr.get("oldReplay").get("url").asText(),rr.get("server").asText(),rr.get("year").asInt());
        jdbc.update("update tournament_broadcast_node set format='KNOCKOUT' where id=(select node_id from tournament_broadcast_replay where id=?)",format);
        jdbc.update("update tournament_broadcast_season set name_zh='Admin',name_en='Admin',name_ru='Admin'");
        final var seasons = jdbc.queryForList("select * from tournament_broadcast_season order by id");
        final var replays = jdbc.queryForList("select * from tournament_broadcast_replay order by id");
        jdbc.execute(localizationSql());
        assertEquals(seasons,jdbc.queryForList("select * from tournament_broadcast_season order by id"));
        assertEquals(replays,jdbc.queryForList("select * from tournament_broadcast_replay order by id"));
        // A custom cover does not alter title facts and must survive a valid text-only correction.
        final long covered = createLocalizationFixture(points,points.get("oldReplay").get("url").asText(),"EU",2026);
        jdbc.update("insert into tournament_broadcast_cover(id,object_key,status,content_type,size,hash,created_at) values ('11111111-1111-4111-8111-111111111111','local-test-cover','READY','image/png',1,?,now())","a".repeat(64));
        jdbc.update("update tournament_broadcast_replay set cover_id='11111111-1111-4111-8111-111111111111' where id=?",covered);
        jdbc.execute(localizationSql());
        assertEquals(points.get("newTitle").asText(),jdbc.queryForObject("select title from tournament_broadcast_replay where id=?",String.class,covered));
        assertEquals("11111111-1111-4111-8111-111111111111",jdbc.queryForObject("select cover_id from tournament_broadcast_replay where id=?",String.class,covered));
    }
    @Test void v44RecognizesOnlyBoundedVideoHostsAndRealQueryParametersInTheCorrectServerAndYear() throws Exception {
        prepareVerifiedSeed(); final JsonNode yt = localizationEntries().get(0);
        final JsonNode bili = java.util.stream.StreamSupport.stream(localizationEntries().spliterator(),false)
                .filter(item -> item.get("sourceKey").asText().equals("bilibili:BV18j2CBWEMo:1")).findFirst().orElseThrow();
        final java.util.Map<Long,JsonNode> accepted = new java.util.LinkedHashMap<>();
        for (final String url : List.of("https://www.youtube.com/watch?feature=share&v=FXGodwWu1cw&t=30","https://youtu.be/FXGodwWu1cw?si=x","https://m.youtube.com/live/FXGodwWu1cw#x")) {
            accepted.put(createLocalizationFixture(yt,url,"EU",2026),yt);
        }
        for (final String url : List.of("https://www.bilibili.com/video/BV18j2CBWEMo/","https://bilibili.com/video/BV18j2CBWEMo/?tracking=x&p=001#p=2","https://m.bilibili.com/video/BV18j2CBWEMo?p=1")) {
            accepted.put(createLocalizationFixture(bili,url,"CN",2025),bili);
        }
        final java.util.List<Long> rejected = new java.util.ArrayList<>();
        for (final String url : List.of("https://example.org/watch?v=FXGodwWu1cw","https://youtube.com.evil.invalid/watch?v=FXGodwWu1cw","https://youtube.com@evil.invalid/watch?v=FXGodwWu1cw","https://www.youtube.com/watch?redirect=https://example.org/?v=FXGodwWu1cw","https://www.youtube.com/watch?x=1#v=FXGodwWu1cw","https://www.youtube.com/watch?v=FXGodwWu1cwx")) {
            rejected.add(createLocalizationFixture(yt,url,"EU",2026));
        }
        for (final String url : List.of("https://bilibili.com.evil.invalid/video/BV18j2CBWEMo?p=1","https://example.org/video/BV18j2CBWEMo?p=1","https://bilibili.com/video/BV18j2CBWEMo?p=invalid","https://bilibili.com/video/BV18j2CBWEMo?p","https://bilibili.com/video/BV18j2CBWEMo?p=4","https://bilibili.com/video/bv18j2cbwemo?p=1","https://bilibili.com/video/BV18j2CBWEMox?p=1")) {
            rejected.add(createLocalizationFixture(bili,url,"CN",2025));
        }
        rejected.add(createLocalizationFixture(yt,yt.get("oldReplay").get("url").asText(),"NA",2026));
        rejected.add(createLocalizationFixture(yt,yt.get("oldReplay").get("url").asText(),"EU",2025));
        rejected.add(createLocalizationFixture(bili,bili.get("oldReplay").get("url").asText(),"EU",2025));
        rejected.add(createLocalizationFixture(bili,bili.get("oldReplay").get("url").asText(),"CN",2026));
        final java.util.Map<Long,java.util.Map<String,Object>> untouched = new java.util.LinkedHashMap<>();
        for (final long id : rejected) { untouched.put(id,jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",id)); }
        jdbc.execute(localizationSql());
        for (final var entry : accepted.entrySet()) {
            assertEquals(entry.getValue().get("newTitle").asText(),jdbc.queryForObject("select title from tournament_broadcast_replay where id=?",String.class,entry.getKey()));
        }
        for (final long id : rejected) { assertEquals(untouched.get(id),jdbc.queryForMap("select * from tournament_broadcast_replay where id=?",id)); }
        assertEquals(accepted.size(),jdbc.queryForObject("select count(*) from tournament_broadcast_season where version=6",Integer.class));
        assertEquals(rejected.size(),jdbc.queryForObject("select count(*) from tournament_broadcast_season where version=5",Integer.class));
    }
    @Test void v43ReusesEmptyOriginalRussianSeasonAndV44LocalizesItWithoutOverwritingItsDate() throws Exception {
        prepareVerifiedSeed();
        final JsonNode item = java.util.stream.StreamSupport.stream(localizationEntries().spliterator(),false)
                .filter(value -> "LESTA".equals(value.get("server").asText())).findFirst().orElseThrow();
        final JsonNode old = item.get("oldSeason");
        final long owner = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name_zh,name_en,name_ru,start_date,created_at,version) values ('LESTA',?,?,?,?,'2026-01-01',now(),5) returning id",Long.class,item.get("year").asInt(),textOrNull(old.get("nameZh")),textOrNull(old.get("nameEn")),textOrNull(old.get("nameRu")));
        jdbc.execute(verifiedSeedSql()); assertEquals(19,jdbc.queryForObject("select count(*) from tournament_broadcast_season",Integer.class));
        final long actualOwner = jdbc.queryForObject("select category.season_id from tournament_broadcast_category category join tournament_broadcast_node node on node.category_id=category.id join tournament_broadcast_replay replay on replay.node_id=node.id where replay.url=?",Long.class,item.get("oldReplay").get("url").asText());
        assertEquals(owner,actualOwner); assertEquals(6L,jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,owner));
        jdbc.execute(localizationSql());
        assertEquals(item.get("newSeason").get("nameZh").asText(),jdbc.queryForObject("select name_zh from tournament_broadcast_season where id=?",String.class,owner));
        assertEquals("2026-01-01",jdbc.queryForObject("select start_date::text from tournament_broadcast_season where id=?",String.class,owner));
        assertEquals(7L,jdbc.queryForObject("select version from tournament_broadcast_season where id=?",Long.class,owner));
    }
    private long createLocalizationFixture(final JsonNode item, final String url, final String server, final int year) {
        final JsonNode names = item.get("oldSeason"); final JsonNode replay = item.get("oldReplay");
        final long season = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name_zh,name_en,name_ru,start_date,created_at,version) values (?,?,?,?,?,?::date,now(),5) returning id",Long.class,server,year,textOrNull(names.get("nameZh")),textOrNull(names.get("nameEn")),textOrNull(names.get("nameRu")),textOrNull(names.get("startDate")));
        final long category = jdbc.queryForObject("insert into tournament_broadcast_category(season_id,type) values (?,?) returning id",Long.class,season,item.get("categoryType").asText());
        final Integer round = item.get("node").get("roundNumber").isNull()?null:item.get("node").get("roundNumber").asInt();
        final long node = jdbc.queryForObject("insert into tournament_broadcast_node(category_id,root_key,round_number,format) values (?,?,?,?) returning id",Long.class,category,round==null?0:round,round,textOrNull(item.get("node").get("format")));
        return jdbc.queryForObject("insert into tournament_broadcast_replay(node_id,title,url,match_date,match_starts_at,day_number,group_number,bracket,teams,perspective,created_at) values (?,?,?,?::date,?::timestamptz,?,?,?,?::jsonb,?,now()) returning id",Long.class,node,replay.get("title").asText(),url,replay.get("matchDate").asText(),textOrNull(replay.get("startsAt")),replay.get("dayNumber").asInt(),replay.get("groupNumber").isNull()?null:replay.get("groupNumber").asInt(),textOrNull(replay.get("bracket")),replay.get("teams").toString(),replay.get("perspective").asText());
    }
    private void assertLocalizedDefaults() throws Exception {
        final JsonNode entries = localizationEntries(); assertEquals(74,entries.size());
        for (final JsonNode item : entries) {
            final var row = jdbc.queryForMap("select replay.title,season.name_zh,season.name_en,season.name_ru from tournament_broadcast_replay replay join tournament_broadcast_node node on node.id=replay.node_id join tournament_broadcast_category category on category.id=node.category_id join tournament_broadcast_season season on season.id=category.season_id where replay.url=?",item.get("oldReplay").get("url").asText());
            assertEquals(item.get("newTitle").asText(),row.get("title"));
            assertEquals(item.get("newSeason").get("nameZh").asText(),row.get("name_zh")); assertEquals(item.get("newSeason").get("nameEn").asText(),row.get("name_en")); assertEquals(item.get("newSeason").get("nameRu").asText(),row.get("name_ru"));
        }
    }
    private static String textOrNull(final JsonNode value) { return value==null||value.isNull()?null:value.asText(); }
    private static String localizationSource() throws Exception { return Files.readString(Path.of("..","..","docs","research","broadcast-seed-2025-2026","seed-localization-2025-2026.json"),StandardCharsets.UTF_8).replace("\r\n","\n"); }
    private static JsonNode localizationEntries() throws Exception { return JSON.readTree(localizationSource()).get("entries"); }
    private static String localizationSql() throws Exception { return new ClassPathResource("db/migration/V44__localize_reviewed_broadcast_defaults.sql").getContentAsString(StandardCharsets.UTF_8); }
    private void prepareVerifiedSeed() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("42").load().migrate();
        jdbc.update("delete from tournament_broadcast_replay"); jdbc.update("delete from tournament_broadcast_node");
        jdbc.update("delete from tournament_broadcast_category"); jdbc.update("delete from tournament_broadcast_cover"); jdbc.update("delete from tournament_broadcast_season");
    }
    private long createSeasonWithYoutube(final String server, final int year, final String name, final String url) {
        final long season = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name_zh,name_en,name_ru,start_date,created_at,version) values (?,?,'Own zh',?,'Own ru','2026-01-01',now(),5) returning id",Long.class,server,year,name);
        final long category = jdbc.queryForObject("insert into tournament_broadcast_category(season_id,type) values (?,'SEMI_FINALS') returning id",Long.class,season);
        final long node = jdbc.queryForObject("insert into tournament_broadcast_node(category_id,root_key) values (?,0) returning id",Long.class,category);
        jdbc.update("insert into tournament_broadcast_replay(node_id,title,url,match_date,match_starts_at,day_number,group_number,bracket,teams,perspective,created_at) values (?,'Own title',?,'2026-01-02','2026-01-02T10:00:00Z',1,null,'DEFAULT','[\"Own1\",\"Own2\"]','POV',now())",node,url);
        return season;
    }
    private static String verifiedSeedSql() throws Exception {
        return new ClassPathResource("db/migration/V43__seed_verified_2025_2026_broadcasts.sql").getContentAsString(StandardCharsets.UTF_8);
    }
    private void createSeasonWithPart(final String server, final int year, final String name, final int part) {
        final long season = jdbc.queryForObject("insert into tournament_broadcast_season(server,year,name_zh,name_en,created_at,version) "
                + "values (?,?,'管理员自定义赛事',?,now(),5) returning id",Long.class,server,year,name);
        final long category = jdbc.queryForObject("insert into tournament_broadcast_category(season_id,type) values (?,'SEMI_FINALS') returning id",Long.class,season);
        final long root = jdbc.queryForObject("insert into tournament_broadcast_node(category_id,root_key) values (?,0) returning id",Long.class,category);
        jdbc.update("insert into tournament_broadcast_replay(node_id,title,url,match_date,day_number,group_number,bracket,teams,perspective,created_at) "
                + "values (?,'Administrator title',?,'2025-12-07',3,1,'DEFAULT','[\"Own1\",\"Own2\"]','OBSERVER',now())",
                root,"https://www.bilibili.com/video/BV18j2CBWEMo/?p="+part);
    }
    private static void migrate() {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("40").load().migrate();
    }
    private static String seedSql() throws Exception { return new ClassPathResource(SEED).getContentAsString(StandardCharsets.UTF_8); }
    private void assertCounts(final int seasons, final int categories, final int nodes, final int replays) {
        assertEquals(seasons,jdbc.queryForObject("select count(*) from tournament_broadcast_season",Integer.class));
        assertEquals(categories,jdbc.queryForObject("select count(*) from tournament_broadcast_category",Integer.class));
        assertEquals(nodes,jdbc.queryForObject("select count(*) from tournament_broadcast_node",Integer.class));
        assertEquals(replays,jdbc.queryForObject("select count(*) from tournament_broadcast_replay",Integer.class));
    }
}

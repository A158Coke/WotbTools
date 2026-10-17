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

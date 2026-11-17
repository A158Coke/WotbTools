package com.wotb.web.tournament;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
import java.util.HexFormat;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
/** Executes reviewed broadcast localization against real PostgreSQL and protects administrator-owned data. */
@Testcontainers(disabledWithoutDocker = true)
class BroadcastLocalizationMigrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    private static final JsonMapper JSON = new JsonMapper();
    private JdbcTemplate jdbc;

    @BeforeEach void legacyDatabase() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()));
        final Flyway legacy = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword())
                .cleanDisabled(false).target("39").load();
        legacy.clean(); legacy.migrate();
        assertCounts(0,0,0,0);
    }

    @Test void v44FreshDatabaseLocalizesAllNamesAndTitlesWithoutRewritingFactsOrAlreadyLocalizedVersions() throws Exception {
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).target("43").load().migrate();
        final var versions = jdbc.queryForList("select id,server,version from tournament_broadcast_season order by id");
        final var facts = jdbc.queryForList("select to_jsonb(replay)-'title' as facts from tournament_broadcast_replay replay order by id");
        final var seasonFacts = jdbc.queryForList("select to_jsonb(season)-ARRAY['name_zh','name_en','name_ru','version'] as facts from tournament_broadcast_season season order by id");
        final Flyway current = Flyway.configure().dataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()).load();
        current.migrate(); current.validate(); assertEquals("49",current.info().current().getVersion().toString());
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

    private static String verifiedSeedSql() throws Exception {
        return new ClassPathResource("db/migration/V43__seed_verified_2025_2026_broadcasts.sql").getContentAsString(StandardCharsets.UTF_8);
    }

    private void assertCounts(final int seasons, final int categories, final int nodes, final int replays) {
        assertEquals(seasons,jdbc.queryForObject("select count(*) from tournament_broadcast_season",Integer.class));
        assertEquals(categories,jdbc.queryForObject("select count(*) from tournament_broadcast_category",Integer.class));
        assertEquals(nodes,jdbc.queryForObject("select count(*) from tournament_broadcast_node",Integer.class));
        assertEquals(replays,jdbc.queryForObject("select count(*) from tournament_broadcast_replay",Integer.class));
    }
}

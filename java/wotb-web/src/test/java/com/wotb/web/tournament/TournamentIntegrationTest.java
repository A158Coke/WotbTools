package com.wotb.web.tournament;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.converter.TournamentCsvConverter;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentEventRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.tournament.service.TournamentService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.BeforeAll;
import tools.jackson.databind.json.JsonMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.nio.file.attribute.FileTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNull;

/** Real PostgreSQL: migration/JSONB/context plus locking/publication and source-scoped evidence lifecycle. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class TournamentIntegrationTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Path EVIDENCE_ROOT;
    static {
        try { EVIDENCE_ROOT = Files.createTempDirectory("wotb-tournament-it-"); }
        catch(final java.io.IOException e) { throw new ExceptionInInitializerError(e); }
    }
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    @DynamicPropertySource static void properties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",POSTGRES::getJdbcUrl); registry.add("spring.datasource.username",POSTGRES::getUsername); registry.add("spring.datasource.password",POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto",()->"validate"); registry.add("spring.flyway.enabled",()->"true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",()->"http://test-issuer");
        registry.add("keycloak.admin.server-url",()->"http://test-keycloak"); registry.add("keycloak.admin.realm",()->"test"); registry.add("keycloak.admin.client-id",()->"test"); registry.add("keycloak.admin.client-secret",()->"test");
        registry.add("wotb.tournament.evidence-dir",()->EVIDENCE_ROOT.toString()); registry.add("wotb.tournament.min-free-bytes",()->"0");
        registry.add("wotb.tournament.recognition-signing-key",()->"integration-only-32-byte-signing-secret");
    }
    @Autowired TournamentService service;
    @Autowired TournamentEventRepository events;
    @Autowired TournamentRuleRepository rules;
    @Autowired TournamentDayRepository days;
    @Autowired TournamentClanRepository clans;
    @Autowired TournamentEvidenceRepository evidence;
    @Autowired TournamentAuditRepository audits;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactionManager;
    private static TournamentDtos.DefaultRules migrationDefault;
    @BeforeAll static void captureMigrationDefault(@Autowired final TournamentService service) {
        migrationDefault = service.defaultRules();
    }
    private long id;
    @BeforeEach void setup() {
        jdbc.update("update tournament_default_rules set version=0, active=false, source_event_id=null, source_label='', updated_at=null, rounds='[]'::jsonb where id=1");
        audits.deleteAll(); evidence.deleteAll(); days.deleteAll(); clans.deleteAll(); rules.deleteAll(); events.deleteAll();
        final TournamentDtos.Config config=service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","FIRE_CUP",5,2,List.of("Day 1","Day 2"))); id=config.event().id();
        service.saveRules("admin",id,1,new TournamentDtos.RuleRequest(0,0,ruleDays(100)));
        service.expectedGroups(id,1,1,new TournamentDtos.ExpectedGroupsRequest(1,0,1));
    }
    @Test void migrationAndHibernateValidateActualJsonbMappingsAndUniqueEventIdentity() {
        assertEquals("44",jdbc.queryForObject("select version from flyway_schema_history where success order by installed_rank desc limit 1",String.class));
        assertEquals("array",jdbc.queryForObject("select jsonb_typeof(days) from tournament_rule where event_id=? and round_number=1",String.class,id));
        assertEquals(5,service.config(id).rounds().size());
        final ApiException error=assertThrows(ApiException.class,()->service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","FIRE_CUP",5,2,List.of("Day 1","Day 2"))));
        assertEquals(ApiErrorCode.TOURNAMENT_ALREADY_EXISTS,error.errorCode());
        service.create("admin",new TournamentDtos.CreateRequest(2026,"EU","FIRE_CUP",4,3,List.of("Day 1","Day 2","Day 3")));
        assertEquals(2,events.count());
    }
    @Test void csvActualFixtureImportsAllTwoHundredClansAndSecondDayReplacesWithoutAddingDayOneTwice() throws Exception {
        final var original = csvFixture(); final long initialVersion = service.config(id).event().version();
        final long auditCount = audits.count(); final long clanCount = clans.count(); final long dayCount = days.count();
        final var preview = service.previewCsv(id, initialVersion, original);
        assertEquals(200, preview.clanCount()); assertEquals(1800, preview.missingCellCount());
        assertEquals(clanCount, clans.count()); assertEquals(dayCount, days.count()); assertEquals(auditCount, audits.count());
        assertFalse(service.dataSource(id).csvImported());
        final var result = service.importCsv("csv-admin", id, initialVersion, original, preview.sourceSha256(), true, "csv-day-one");
        assertEquals(preview.standings().rows(), result.standings().rows()); assertEquals(preview.changes(), result.changes());
        assertEquals(result.standings(), service.publicStandings(id));
        assertEquals(206408, result.standings().rows().stream().mapToLong(TournamentDtos.StandingRow::totalPoints).sum());
        assertEquals(List.of(1, 50, 99, 125), result.standings().rows().stream().map(TournamentDtos.StandingRow::rank).distinct().toList());
        assertEquals(1, result.standings().days().stream().filter(TournamentDtos.StandingDay::published).count());
        assertEquals(200, jdbc.queryForObject("select count(*) from tournament_clan where event_id=? and historical_published", Integer.class, id));
        assertTrue(service.dataSource(id).csvImported()); assertEquals("_EK_", service.dataSource(id).attribution().name());
        assertEquals("https://b23.tv/rqx5iYX", service.dataSource(id).attribution().url());
        final var retried = service.importCsv("csv-admin", id, initialVersion, original, preview.sourceSha256(), true, "csv-day-one");
        assertEquals(result, retried); assertEquals(auditCount + 1, audits.count());
        final var second = csvDayTwo(original); final var secondPreview = service.previewCsv(id, result.eventVersion(), second);
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, assertThrows(ApiException.class,
                () -> service.importCsv("csv-admin", id, initialVersion, second, secondPreview.sourceSha256(), true, "csv-day-one")).errorCode());
        assertEquals(200, secondPreview.changes().addedScores()); assertEquals(200, secondPreview.changes().changedClans());
        final var updated = service.importCsv("csv-admin", id, result.eventVersion(), second, secondPreview.sourceSha256(), true, "csv-day-two");
        assertEquals(207808, updated.standings().rows().stream().mapToLong(TournamentDtos.StandingRow::totalPoints).sum());
        assertEquals(1600, updated.missingCellCount());
        assertEquals(206408, updated.standings().rows().stream().mapToLong(row -> row.rounds().getFirst().days().getFirst().points()).sum());
        final var snapshot = service.publicStandings(id);
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, assertThrows(ApiException.class,
                () -> service.importCsv("csv-admin", id, initialVersion, original, preview.sourceSha256(), true, "csv-day-one")).errorCode());
        assertEquals(snapshot, service.publicStandings(id));
    }
    @Test void canonicalTournamentCsvFixturesRoundTripThroughPreviewImportAndPublicStandings() throws Exception {
        final var fourEvent = service.create("admin", new TournamentDtos.CreateRequest(2026, "EU", "SUMMER", 4, 2, List.of("Day 1", "Day 2"))).event();
        final var fiveEvent = service.create("admin", new TournamentDtos.CreateRequest(2026, "NA", "SUMMER", 5, 3, List.of("Day 1", "Day 2", "Day 3"))).event();
        final var cases = List.of(
                new Object[] {fourEvent, "4x2.csv", "canonical-4x2"},
                new Object[] {fiveEvent, "5x3.csv", "canonical-5x3"});
        for (final Object[] testCase : cases) {
            final var event = (TournamentDtos.Event) testCase[0];
            final String filename = (String) testCase[1];
            final String idempotencyKey = (String) testCase[2];
            final byte[] bytes = Files.readAllBytes(Path.of("../../common/fixtures/tournament/csv", filename));
            final var file = new MockMultipartFile("file", filename, "text/csv", bytes);
            final var version = service.config(event.id()).event().version();
            final var preview = service.previewCsv(event.id(), version, file);
            final var imported = service.importCsv("csv-admin", event.id(), version, file, preview.sourceSha256(), true, idempotencyKey);
            final var actual = service.publicStandings(event.id());
            assertEquals(imported.standings().rows(), actual.rows());
            assertEquals(3, actual.rows().size());
            if (filename.equals("4x2.csv")) {
                assertCanonicalFacts(actual, "-KSR-", java.util.Arrays.asList(100L, null, 0L, 50L, null, 25L, 10L, 15L), 200);
                assertCanonicalFacts(actual, "雪,豹*", java.util.Arrays.asList(0L, 0L, null, 0L, 0L, null, 0L, 0L), 0);
                assertCanonicalFacts(actual, "=SUM(A1:A2)", java.util.Arrays.asList(1L, null, null, null, null, null, null, 1L), 2);
            } else {
                assertCanonicalFacts(actual, "ALPHA*", java.util.Arrays.asList(100L, null, 0L, 50L, null, 25L, 10L, 15L, null, 20L, 0L, 30L, null, 40L, 10L), 300);
                assertCanonicalFacts(actual, "雪,豹*", java.util.Arrays.asList(0L, 100L, null, 0L, 100L, null, 0L, 100L, null, 0L, 100L, null, 0L, 100L, null), 500);
                assertCanonicalFacts(actual, "=CMD+1", java.util.Arrays.asList(1L, null, null, null, null, null, null, null, null, null, null, null, null, null, null), 1);
            }
        }
    }
    @Test void canonicalCsvRoundTripPreservesUnderlyingScoresAcrossActiveClearOverlays() throws Exception {
        final var initialCsv = csv(csvText("A,900,,,,,,,,,,900\n"));
        var version = service.config(id).event().version();
        var preview = service.previewCsv(id, version, initialCsv);
        service.importCsv("admin", id, version, initialCsv, preview.sourceSha256(), true, "initial-900");
        service.clearPoints("admin", id, new TournamentDtos.ClearRequest(service.config(id).event().version(), 1, 1, "A", "sanction", false));
        assertCanonicalCsvPreservesClearAndRestore(id, "historical-csv", 900);

        final long groupEvent = service.create("admin", new TournamentDtos.CreateRequest(2026, "EU", "FIRE_CUP", 5, 2, List.of("Day 1", "Day 2"))).event().id();
        final var config = service.config(groupEvent);
        service.saveRules("admin", groupEvent, 1, new TournamentDtos.RuleRequest(config.event().version(), config.rounds().getFirst().rulesVersion(), ruleDays(900)));
        save(groupEvent, 1, 1, List.of(group(groupEvent, 1, 1, 1, 0, "A", "B", "C")), List.of("A", "B", "C"));
        publish(groupEvent, 1, 1, "publish-900-group");
        service.clearPoints("admin", groupEvent, new TournamentDtos.ClearRequest(service.config(groupEvent).event().version(), 1, 1, "A", "sanction", false));
        assertCanonicalCsvPreservesClearAndRestore(groupEvent, "published-groups", 900);
    }
    private void assertCanonicalCsvPreservesClearAndRestore(final long eventId, final String key, final long score) throws Exception {
        final TournamentDtos.DayView adminDay = JSON.treeToValue(JSON.valueToTree(service.day(eventId, 1, 1, true)), TournamentDtos.DayView.class);
        assertEquals(0L, point(adminDay.standings(), "A"));
        assertEquals(score, point(adminDay.canonicalStandings(), "A"));
        final var canonicalFile = canonicalCsv(adminDay.canonicalStandings());
        final var preview = service.previewCsv(eventId, adminDay.eventVersion(), canonicalFile);
        service.importCsv("admin", eventId, preview.eventVersion(), canonicalFile, preview.sourceSha256(), true, "round-trip-" + key);
        assertEquals(0L, point(service.publicStandings(eventId), "A"), "clear overlay remains active after import");
        assertTrue(days.findByEventIdAndRoundNumberAndDayNumber(eventId, 1, 1).orElseThrow().clearedClans.contains("A"));
        service.clearPoints("admin", eventId, new TournamentDtos.ClearRequest(service.config(eventId).event().version(), 1, 1, "A", "restore", true));
        assertEquals(score, point(service.publicStandings(eventId), "A"), "restoring the clear reveals the original score");
    }
    private long point(final TournamentDtos.Standings standings, final String tag) {
        return standings.rows().stream().filter(row -> row.clanTag().equals(tag)).findFirst().orElseThrow()
                .rounds().getFirst().days().getFirst().points();
    }
    private MockMultipartFile canonicalCsv(final TournamentDtos.Standings standings) throws Exception {
        final List<String> headers = new ArrayList<>(List.of("军团标签"));
        for (int round = 1; round <= standings.event().roundCount(); round++) {
            for (int day = 1; day <= standings.event().daysPerRound(); day++) { headers.add("R" + round + "D" + day); }
        }
        headers.add("总积分");
        final StringWriter output = new StringWriter();
        final CSVFormat format = CSVFormat.RFC4180.builder().setRecordSeparator("\r\n").get();
        try (final CSVPrinter printer = new CSVPrinter(output, format)) {
            printer.printRecord(headers);
            for (final var row : standings.rows()) {
                final List<Object> cells = new ArrayList<>(); cells.add(row.clanTag());
                for (int round = 1; round <= standings.event().roundCount(); round++) {
                    final int roundNumber = round;
                    final var roundPoints = row.rounds().stream().filter(value -> value.roundNumber() == roundNumber).findFirst().orElseThrow();
                    for (int day = 1; day <= standings.event().daysPerRound(); day++) {
                        final int dayNumber = day;
                        final var dayPoints = roundPoints.days().stream().filter(value -> value.dayNumber() == dayNumber).findFirst().orElseThrow();
                        cells.add(dayPoints.points() == null ? "" : dayPoints.points());
                    }
                }
                cells.add(row.totalPoints()); printer.printRecord(cells);
            }
        }
        final byte[] bytes = output.toString().getBytes(StandardCharsets.UTF_8);
        final var decoded = new com.wotb.web.util.csv.CsvDecoder().decode(bytes);
        assertEquals(standings.rows().size(), TournamentCsvConverter.convert(decoded, standings.event().roundCount(), standings.event().daysPerRound()).size());
        return new MockMultipartFile("file", "canonical.csv", "text/csv", bytes);
    }
    private static void assertCanonicalFacts(final TournamentDtos.Standings standings, final String clanTag,
                                             final List<Long> expectedPoints, final long expectedTotal) {
        final TournamentDtos.StandingRow row = standings.rows().stream().filter(value -> value.clanTag().equals(clanTag)).findFirst().orElseThrow();
        final List<Long> actualPoints = row.rounds().stream().flatMap(round -> round.days().stream()).map(TournamentDtos.DayPoints::points).toList();
        assertEquals(expectedPoints, actualPoints);
        assertEquals(expectedTotal, row.totalPoints());
    }
    @Test void csvReplacementRemovesOmittedClansAndOldGroupsWhilePreservingExplicitClears() throws Exception {
        final var batch = group(id, 1, 1, 1, 0, "A", "B", "C");
        save(id, 1, 1, List.of(batch), List.of("A", "B", "C")); publish(id, 1, 1, "screenshots");
        service.clearPoints("admin", id, new TournamentDtos.ClearRequest(service.config(id).event().version(), 1, 1, "A", "sanction", false));
        final var file = csv(csvText("A,999,10,,,,,,,,,1009\nB,,5,,,,,,,,,5\n"));
        final var preview = service.previewCsv(id, service.config(id).event().version(), file);
        assertEquals(1, preview.changes().removedClans()); assertEquals(1, preview.changes().preservedClears());
        final var imported = service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "replacement");
        assertEquals(preview.standings().rows(), imported.standings().rows());
        final var board = service.publicStandings(id);
        assertEquals(2, board.rows().size()); assertEquals(10, summerRow(board, "A").totalPoints());
        assertNull(summerRow(board, "B").rounds().getFirst().days().getFirst().points());
        assertTrue(days.findByEventIdAndRoundNumberAndDayNumber(id, 1, 1).orElseThrow().publishedGroups == null);
        final var omitCleared = csv(csvText("B,0,,,,,,,,,,0\n"));
        final var omitPreview = service.previewCsv(id, imported.eventVersion(), omitCleared);
        service.importCsv("admin", id, omitPreview.eventVersion(), omitCleared, omitPreview.sourceSha256(), true, "omit-cleared");
        assertEquals(List.of("B"), service.publicStandings(id).rows().stream().map(TournamentDtos.StandingRow::clanTag).toList());
        assertTrue(days.findByEventIdAndRoundNumberAndDayNumber(id, 1, 1).orElseThrow().clearedClans.contains("A"));
        assertTrue(service.dataSource(id).csvImported());
    }
    @Test void csvSanctionKeepsBlankAndZeroDistinctAndStillAppliesWhenScoresReturn() throws Exception {
        final var initial = csv(csvText("A,100,,,,,,,,,,100\nB,50,,,,,,,,,,50\n"));
        final var first = service.previewCsv(id, service.config(id).event().version(), initial);
        service.importCsv("admin", id, first.eventVersion(), initial, first.sourceSha256(), true, "initial");
        service.clearPoints("admin", id, new TournamentDtos.ClearRequest(service.config(id).event().version(), 1, 1, "A", "sanction", false));
        final var blank = csv(csvText("A,,,,,,,,,,,0\nB,50,,,,,,,,,,50\n"));
        final var blankPreview = service.previewCsv(id, service.config(id).event().version(), blank);
        assertNull(summerRow(blankPreview.standings(), "A").rounds().getFirst().days().getFirst().points());
        assertEquals(1, blankPreview.changes().removedScores()); assertEquals(0, blankPreview.changes().changedScores());
        final var replaced = service.importCsv("admin", id, blankPreview.eventVersion(), blank, blankPreview.sourceSha256(), true, "blank");
        assertEquals(blankPreview.changes(), replaced.changes()); assertEquals(blankPreview.standings().rows(), service.publicStandings(id).rows());
        assertNull(summerRow(service.publicStandings(id), "A").rounds().getFirst().days().getFirst().points());
        final var noScores = csv(csvText("A,,,,,,,,,,,0\nB,,,,,,,,,,,0\n"));
        final var emptyPreview = service.previewCsv(id, replaced.eventVersion(), noScores);
        final var empty = service.importCsv("admin", id, emptyPreview.eventVersion(), noScores, emptyPreview.sourceSha256(), true, "empty");
        assertFalse(empty.standings().days().getFirst().published());
        assertNull(summerRow(service.publicStandings(id), "A").rounds().getFirst().days().getFirst().points());
        assertTrue(days.findByEventIdAndRoundNumberAndDayNumber(id, 1, 1).orElseThrow().clearedClans.contains("A"));
        final var scored = csv(csvText("A,900,,,,,,,,,,900\nB,0,,,,,,,,,,0\n"));
        final var scorePreview = service.previewCsv(id, empty.eventVersion(), scored);
        assertEquals(2, scorePreview.changes().addedScores()); assertEquals(1, scorePreview.changes().preservedClears());
        service.importCsv("admin", id, scorePreview.eventVersion(), scored, scorePreview.sourceSha256(), true, "scored");
        assertEquals(0L, summerRow(service.publicStandings(id), "A").rounds().getFirst().days().getFirst().points());
        assertEquals(0L, summerRow(service.publicStandings(id), "B").rounds().getFirst().days().getFirst().points());
        service.clearPoints("admin", id, new TournamentDtos.ClearRequest(service.config(id).event().version(), 1, 1, "A", "restore", true));
        assertEquals(900, summerRow(service.publicStandings(id), "A").totalPoints());
    }
    @Test void csvReplacementAuditRetainsOldScreenshotEvidenceThroughAnActualExpiredOrphanSweep() throws Exception {
        final var orphan = group(id, 1, 1, 1, 99, "A", "B", "C");
        final var original = group(id, 1, 1, 1, 0, "A", "B", "C");
        save(id, 1, 1, List.of(original), List.of("A", "B", "C")); publish(id, 1, 1, "screenshot");
        // Isolate the CSV replacement's reference, including snapshots without a legacy publication audit.
        jdbc.update("delete from tournament_audit where event_id=? and action='DAY_PUBLISHED'", id);
        final var file = csvFixture(); final var preview = service.previewCsv(id, service.config(id).event().version(), file);
        service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "replace-screenshot");
        final var imported = audits.findCsvImport(id, "replace-screenshot").orElseThrow();
        final var oldDay = (Map<?, ?>) ((List<?>) imported.beforeState.get("publishedDays")).getFirst();
        assertEquals(1, ((Number) oldDay.get("roundNumber")).intValue()); assertEquals(1, ((Number) oldDay.get("dayNumber")).intValue());
        final var oldGroup = (Map<?, ?>) ((List<?>) oldDay.get("groups")).getFirst();
        assertEquals(original.evidenceId(), oldGroup.get("evidenceId"));
        // CSV row/standing payloads are not evidence sources, even if they contain a matching field.
        jdbc.update("update tournament_audit set before_state=jsonb_set(before_state,'{standings,evidenceId}',to_jsonb(cast(? as text))), after_state=jsonb_set(after_state,'{evidenceId}',to_jsonb(cast(? as text))) where id=?",
                orphan.evidenceId(), orphan.evidenceId(), imported.id);
        assertEquals(List.of(original.evidenceId()), audits.findEvidenceIdsByEventId(id));
        final Instant expired = Instant.now().minusSeconds(90000);
        for (final var attachment : evidence.findByEventId(id)) {
            attachment.createdAt = expired; evidence.saveAndFlush(attachment);
            Files.setLastModifiedTime(EVIDENCE_ROOT.resolve(Long.toString(id)).resolve(attachment.imageHash + ".image"), FileTime.from(expired));
        }
        final Path originalFile = EVIDENCE_ROOT.resolve(Long.toString(id)).resolve(original.imageHash() + ".image");
        final Path orphanFile = EVIDENCE_ROOT.resolve(Long.toString(id)).resolve(orphan.imageHash() + ".image");
        service.cleanupOrphans();
        assertTrue(evidence.existsById(original.evidenceId())); assertTrue(Files.isRegularFile(originalFile));
        assertTrue(service.download(id, original.evidenceId()).bytes().length > 0);
        assertFalse(evidence.existsById(orphan.evidenceId())); assertFalse(Files.exists(orphanFile));
        service.deleteEvent(id, new TournamentDtos.DeleteRequest(service.config(id).event().version(), true));
        assertFalse(Files.exists(originalFile));
    }
    @Test void auditEvidenceProjectionKeepsLegacyBeforeAndAfterReferencesAndFiltersNonStringIds() {
        final TournamentAudit legacy = new TournamentAudit(); legacy.eventId = id; legacy.action = "LEGACY_EVIDENCE";
        legacy.actor = "admin"; legacy.createdAt = Instant.now();
        legacy.beforeState = Map.of("nested", List.of(Map.of("evidenceId", "before"), Map.of("evidenceId", 42),
                java.util.Collections.singletonMap("evidenceId", null)));
        legacy.afterState = Map.of("evidenceId", "after", "duplicate", Map.of("evidenceId", "before"));
        audits.saveAndFlush(legacy);
        final long other = service.create("admin", new TournamentDtos.CreateRequest(2026, "EU", "FIRE_CUP", 5, 2, List.of("Day 1", "Day 2"))).event().id();
        final TournamentAudit foreign = new TournamentAudit(); foreign.eventId = other; foreign.action = "LEGACY_EVIDENCE";
        foreign.actor = "admin"; foreign.createdAt = Instant.now(); foreign.beforeState = Map.of("evidenceId", "foreign"); foreign.afterState = Map.of();
        audits.saveAndFlush(foreign);
        final List<String> references = audits.findEvidenceIdsByEventId(id);
        assertEquals(2, references.size()); assertEquals(Set.of("before", "after"), Set.copyOf(references));
        assertEquals(List.of("foreign"), audits.findEvidenceIdsByEventId(other));
    }
    @Test void csvRollbackAndPreviewHashVersionAndWorkspaceGuardsProtectPreviousData() throws Exception {
        final var file = csvFixture(); final var preview = service.previewCsv(id, service.config(id).event().version(), file);
        final var before = service.publicStandings(id); final long count = audits.count();
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, assertThrows(ApiException.class,
                () -> service.importCsv("admin", id, preview.eventVersion(), file, "a".repeat(64), true, "wrong-hash")).errorCode());
        jdbc.execute("alter table tournament_audit add constraint test_reject_csv check (action <> 'CSV_IMPORTED') not valid");
        try { assertThrows(org.springframework.dao.DataAccessException.class,
                () -> service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "rollback")); }
        finally { jdbc.execute("alter table tournament_audit drop constraint test_reject_csv"); }
        assertEquals(before, service.publicStandings(id)); assertEquals(count, audits.count()); assertFalse(service.dataSource(id).csvImported());
        final var request = group(id, 1, 1, 1, 0, "A", "B", "C"); save(id, 1, 1, List.of(request), List.of("A", "B", "C"));
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, assertThrows(ApiException.class,
                () -> service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "old-preview")).errorCode());
        assertEquals(ApiErrorCode.TOURNAMENT_CSV_WORKSPACE_BUSY, assertThrows(ApiException.class,
                () -> service.previewCsv(id, service.config(id).event().version(), file)).errorCode());
        assertFalse(service.dataSource(id).csvImported());
    }
    @Test void csvCompetingImportsSerializeAndTheLosingVersionCannotOverwriteWinner() throws Exception {
        final var file = csvFixture(); final var preview = service.previewCsv(id, service.config(id).event().version(), file);
        final var start = new CountDownLatch(1);
        try (final var executor = Executors.newFixedThreadPool(2)) {
            final Callable<Boolean> first = () -> { start.await(); try { service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "first"); return true; } catch (final ApiException conflict) { assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, conflict.errorCode()); return false; } };
            final Callable<Boolean> second = () -> { start.await(); try { service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "second"); return true; } catch (final ApiException conflict) { assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, conflict.errorCode()); return false; } };
            final var left = executor.submit(first); final var right = executor.submit(second); start.countDown();
            assertTrue(left.get(20, TimeUnit.SECONDS) ^ right.get(20, TimeUnit.SECONDS));
        }
        assertEquals(1, service.auditList(id).stream().filter(row -> row.action().equals("CSV_IMPORTED")).count());
        assertEquals(200, service.publicStandings(id).rows().size()); assertTrue(service.dataSource(id).csvImported());
    }
    @Test void csvPreservesPreparedEmptyDaysUntilItActuallyReplacesTheirPublishedScores() throws Exception {
        final var future = service.day(id, 1, 2);
        service.expectedGroups(id, 1, 2, new TournamentDtos.ExpectedGroupsRequest(future.eventVersion(), future.version(), 17));
        final var original = csvFixture(); final var preview = service.previewCsv(id, service.config(id).event().version(), original);
        final var imported = service.importCsv("admin", id, preview.eventVersion(), original, preview.sourceSha256(), true, "day-one");
        assertNull(service.day(id, 1, 1).expectedGroupCount());
        assertEquals(17, service.day(id, 1, 2).expectedGroupCount()); assertFalse(service.day(id, 1, 2).published());
        final var second = csvDayTwo(original); final var nextPreview = service.previewCsv(id, imported.eventVersion(), second);
        final var updated = service.importCsv("admin", id, nextPreview.eventVersion(), second, nextPreview.sourceSha256(), true, "day-two");
        assertNull(service.day(id, 1, 2).expectedGroupCount()); assertTrue(service.day(id, 1, 2).published());
        final var removeDayTwo = service.previewCsv(id, updated.eventVersion(), original);
        service.importCsv("admin", id, removeDayTwo.eventVersion(), original, removeDayTwo.sourceSha256(), true, "remove-day-two");
        assertNull(service.day(id, 1, 2).expectedGroupCount()); assertFalse(service.day(id, 1, 2).published());
    }
    @Test void auditMetadataOmitsCsvPayloadsWhileTheFullDatabaseRecordsRemainReadable() throws Exception {
        final var file = csvFixture(); final var preview = service.previewCsv(id, service.config(id).event().version(), file);
        service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "audit-csv");
        final var full = audits.findCsvImport(id, "audit-csv").orElseThrow();
        assertEquals(200, ((List<?>) full.afterState.get("rows")).size());
        assertTrue(full.beforeState.containsKey("standings")); assertTrue(full.afterState.containsKey("standings"));
        final var list = service.auditList(id); final var latest = list.getFirst();
        assertEquals(full.id, latest.id()); assertEquals("CSV_IMPORTED", latest.action()); assertEquals("admin", latest.actor());
        assertTrue(latest.before().isEmpty()); assertTrue(latest.after().isEmpty());
        assertTrue(list.stream().allMatch(row -> row.before().isEmpty() && row.after().isEmpty()));
        assertEquals(200, ((List<?>) audits.findCsvImport(id, "audit-csv").orElseThrow().afterState.get("rows")).size());
    }
    @Test void csvAttributionSurvivesLaterScreenshotCorrectionAndIsRemovedWithTheEvent() throws Exception {
        final var file = csv(csvText("A,999,,,,,,,,,,999\nB,88,,,,,,,,,,88\nC,77,,,,,,,,,,77\n"));
        final var preview = service.previewCsv(id, service.config(id).event().version(), file);
        service.importCsv("admin", id, preview.eventVersion(), file, preview.sourceSha256(), true, "csv");
        final var oldDay = service.day(id, 1, 1);
        service.correction("admin", id, 1, 1, new TournamentDtos.CorrectionRequest(oldDay.eventVersion(), oldDay.version(), 1, "replace with screenshot"));
        assertTrue(service.dataSource(id).csvImported());
        final var screenshot = group(id, 1, 1, 1, 0, "A", "B", "C");
        save(id, 1, 1, List.of(screenshot), List.of()); publish(id, 1, 1, "screenshot-correction");
        assertNull(days.findByEventIdAndRoundNumberAndDayNumber(id, 1, 1).orElseThrow().publishedHistoricalPoints);
        assertTrue(service.dataSource(id).csvImported()); assertEquals("_EK_", service.dataSource(id).attribution().name());
        final long version = service.config(id).event().version(); service.deleteEvent(id, new TournamentDtos.DeleteRequest(version, true));
        assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND, assertThrows(ApiException.class, () -> service.dataSource(id)).errorCode());
        assertTrue(audits.findAll().stream().noneMatch(audit -> Long.valueOf(id).equals(audit.eventId)));
    }
    private MockMultipartFile csvFixture() throws Exception {
        return new MockMultipartFile("file", "2026战火杯积分榜.csv", "text/csv", new ClassPathResource("tournament/2026-fire-cup-standings.csv").getContentAsByteArray());
    }
    private MockMultipartFile csv(final String text) { return new MockMultipartFile("file", "standings.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8)); }
    private String csvText(final String rows) { return "军团标签,R1D1,R1D2,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2,R5D1,R5D2,总积分\n" + rows; }
    private MockMultipartFile csvDayTwo(final MockMultipartFile original) throws Exception {
        final StringWriter output = new StringWriter();
        try (final CSVParser parser = CSVFormat.RFC4180.builder().setHeader().setSkipHeaderRecord(true).get()
                .parse(new StringReader(new String(original.getBytes(), StandardCharsets.UTF_8).substring(1)));
             final CSVPrinter printer = new CSVPrinter(output, CSVFormat.RFC4180.builder().setHeader(parser.getHeaderNames().toArray(String[]::new)).get())) {
            for (final var row : parser) {
                final List<String> values = new ArrayList<>(row.toList());
                values.set(parser.getHeaderNames().indexOf("R1D2"), "7");
                values.set(parser.getHeaderNames().indexOf("总积分"), Long.toString(Long.parseLong(row.get("总积分")) + 7));
                printer.printRecord(values);
            }
        }
        return csv(output.toString());
    }
    @Test void persistedDraftAndPublishedSnapshotsRemainSeparated() throws Exception {
        final TournamentDtos.IncomingGroup group=group(id,1,1,1,0,"A","B","C");
        save(id,1,1,List.of(group),List.of("A","B","C"));
        assertTrue(service.publicStandings(id).rows().isEmpty());
        assertEquals(3,service.day(id,1,1).standings().rows().size());
        publish(id,1,1,"first");
        assertEquals(100,service.publicStandings(id).rows().getFirst().totalPoints());
        assertEquals("array",jdbc.queryForObject("select jsonb_typeof(published_groups) from tournament_day where event_id=?",String.class,id));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_day where event_id=? and draft_groups is not null",Integer.class,id));
    }
    @Test void concurrentSharedDraftWritesRejectStaleVersion() throws Exception {
        final TournamentDtos.IncomingGroup group=group(id,1,1,1,0,"A","B","C");
        final TournamentDtos.DayView day=service.day(id,1,1);
        final TournamentDtos.DraftRequest request=new TournamentDtos.DraftRequest(day.eventVersion(),day.version(),day.rulesVersion(),List.of(group),List.of("A","B","C"));
        final List<Boolean> results=race(()->tryWrite(()->service.saveDraft(id,1,1,request)),()->tryWrite(()->service.saveDraft(id,1,1,request)));
        assertEquals(1,results.stream().filter(Boolean::booleanValue).count());
        assertEquals(1,service.day(id,1,1).groups().size()); assertTrue(service.publicStandings(id).rows().isEmpty());
    }
    @Test void concurrentIdenticalPublicationIsIdempotentAndDoesNotDoubleCount() throws Exception {
        save(id,1,1,List.of(group(id,1,1,1,0,"A","B","C")),List.of("A","B","C"));
        final TournamentDtos.DayView day=service.day(id,1,1);
        final TournamentDtos.FinalizeRequest request=new TournamentDtos.FinalizeRequest(day.eventVersion(),day.version(),day.rulesVersion(),"same-publication");
        race(()->service.finalizeDay("admin-1",id,1,1,request),()->service.finalizeDay("admin-2",id,1,1,request));
        assertEquals(1,service.auditList(id).stream().filter(row->row.action().equals("DAY_PUBLISHED")).count());
        assertEquals(100,service.publicStandings(id).rows().getFirst().totalPoints());
    }
    @Test void ruleEditAndPublicationSerializeOnEventLock() throws Exception {
        save(id,1,1,List.of(group(id,1,1,1,0,"A","B","C")),List.of("A","B","C"));
        final TournamentDtos.DayView day=service.day(id,1,1);
        final List<Boolean> result=race(()->tryWrite(()->service.finalizeDay("admin",id,1,1,new TournamentDtos.FinalizeRequest(day.eventVersion(),day.version(),day.rulesVersion(),"publish"))),
                ()->tryWrite(()->service.saveRules("admin",id,1,new TournamentDtos.RuleRequest(day.eventVersion(),day.rulesVersion(),ruleDays(200)))));
        assertEquals(1,result.stream().filter(Boolean::booleanValue).count());
        if(service.day(id,1,1).published()) {
            assertEquals(100,service.publicStandings(id).rows().getFirst().totalPoints()); assertTrue(service.config(id).rounds().getFirst().locked());
        } else { assertEquals(200,service.day(id,1,1).standings().rows().getFirst().totalPoints()); }
    }
    @Test void correctionsPreservePublishedSnapshotAndPersistentSanctionUntilExplicitRestore() throws Exception {
        save(id,1,1,List.of(group(id,1,1,1,0,"A","B","C")),List.of("A","B","C")); publish(id,1,1,"first");
        service.clearPoints("admin",id,new TournamentDtos.ClearRequest(service.config(id).event().version(),1,1,"A","violation",false));
        final TournamentDtos.DayView before=service.day(id,1,1);
        service.correction("admin",id,1,1,new TournamentDtos.CorrectionRequest(before.eventVersion(),before.version(),1,"correct screenshot"));
        assertEquals(3,service.publicStandings(id).rows().size());
        save(id,1,1,List.of(group(id,1,1,1,1,"A","C","B")),List.of());
        assertEquals(50,service.publicStandings(id).rows().stream().filter(row->row.clanTag().equals("B")).findFirst().orElseThrow().totalPoints());
        publish(id,1,1,"second");
        assertEquals(0,service.publicStandings(id).rows().stream().filter(row->row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertEquals(2,evidence.findByEventId(id).size()); // Published before/after audit retains evidence.
        service.clearPoints("admin",id,new TournamentDtos.ClearRequest(service.config(id).event().version(),1,1,"A","appeal",true));
        assertEquals(100,service.publicStandings(id).rows().getFirst().totalPoints());
    }
    @Test void deletingOneEventCannotDeleteSameHashImageFromAnotherEvent() throws Exception {
        final TournamentDtos.IncomingGroup first=group(id,1,1,1,0,"A","B","C"); save(id,1,1,List.of(first),List.of("A","B","C"));
        final long other=service.create("admin",new TournamentDtos.CreateRequest(2026,"EU","SUMMER",4,2,List.of("Day 1","Day 2"))).event().id();
        service.saveRules("admin",other,1,new TournamentDtos.RuleRequest(0,0,ruleDays(100))); service.expectedGroups(other,1,1,new TournamentDtos.ExpectedGroupsRequest(1,0,1));
        final TournamentDtos.IncomingGroup second=group(other,1,1,1,0,"A","B","C"); save(other,1,1,List.of(second),List.of("A","B","C"));
        assertEquals(first.imageHash(),second.imageHash());
        service.deleteEvent(id,new TournamentDtos.DeleteRequest(service.config(id).event().version(),true));
        assertFalse(Files.exists(EVIDENCE_ROOT.resolve(Long.toString(id))));
        assertTrue(Files.isRegularFile(EVIDENCE_ROOT.resolve(Long.toString(other)).resolve(second.imageHash()+".image")));
        assertFalse(service.download(other,second.evidenceId()).bytes().length==0);
    }
    @Test void orphanCleanupHonorsSharedHashReferencesAndDraftDeletionLifecycle() throws Exception {
        final TournamentDtos.IncomingGroup unused=group(id,1,1,1,0,"A","B","C");
        final var old=evidence.findById(unused.evidenceId()).orElseThrow();
        old.createdAt=java.time.Instant.now().minusSeconds(90000); evidence.saveAndFlush(old);
        final TournamentDtos.IncomingGroup linked=group(id,1,1,1,0,"A","B","C");
        save(id,1,1,List.of(linked),List.of("A","B","C"));
        final Path file=EVIDENCE_ROOT.resolve(Long.toString(id)).resolve(linked.imageHash()+".image");
        Files.setLastModifiedTime(file,java.nio.file.attribute.FileTime.from(java.time.Instant.now().minusSeconds(90000)));
        service.cleanupOrphans();
        assertFalse(evidence.existsById(unused.evidenceId())); assertTrue(evidence.existsById(linked.evidenceId())); assertTrue(Files.exists(file));
        final TournamentDtos.DayView view=service.day(id,1,1);
        service.deleteDraft(id,1,1,new TournamentDtos.Versions(view.eventVersion(),view.version()));
        assertTrue(evidence.findByEventId(id).isEmpty()); service.cleanupOrphans(); assertFalse(Files.exists(file));
        assertTrue(service.publicStandings(id).rows().isEmpty());
    }
    @Test void sanctionedRoundClearsAllConfiguredDaysAndRetainsOtherRound() throws Exception {
        save(id,1,1,List.of(group(id,1,1,1,0,"A","B","C")),List.of("A","B","C")); publish(id,1,1,"day-1");
        service.expectedGroups(id,1,2,new TournamentDtos.ExpectedGroupsRequest(service.config(id).event().version(),0,1));
        save(id,1,2,List.of(group(id,1,2,1,1,"A","B","C")),List.of()); publish(id,1,2,"day-2");
        service.saveRules("admin",id,2,new TournamentDtos.RuleRequest(service.config(id).event().version(),0,ruleDays(500)));
        service.expectedGroups(id,2,1,new TournamentDtos.ExpectedGroupsRequest(service.config(id).event().version(),0,1));
        save(id,2,1,List.of(group(id,2,1,1,2,"A","B","C")),List.of()); publish(id,2,1,"round-2");
        service.clearPoints("admin",id,new TournamentDtos.ClearRequest(service.config(id).event().version(),1,null,"A","round violation",false));
        final TournamentDtos.StandingRow row=service.publicStandings(id).rows().getFirst(); assertEquals("A",row.clanTag()); assertEquals(500,row.totalPoints()); assertEquals(0,row.rounds().getFirst().totalPoints());
    }
    @Test void historicalImportPersistsDirectScoresAndZeroRosterWithoutInferredRules() {
        final long eventId=historicalEvent();
        final List<TournamentDtos.HistoricalRow> source=List.of(historicalRow("[REQM]",100,null),historicalRow("-KSR-",null,100),historicalRow("零分",0,0),historicalRow("缺席"));
        final TournamentDtos.HistoricalPreviewRequest previewRequest=new TournamentDtos.HistoricalPreviewRequest(0,"source.png","a".repeat(64),source);
        assertEquals(4,service.previewHistorical(eventId,previewRequest).clanCount()); assertTrue(service.publicStandings(eventId).rows().isEmpty());
        final TournamentDtos.HistoricalPreview result=service.importHistorical("admin",eventId,historicalRequest(eventId,source,"import"));
        assertEquals(4,result.standings().rows().size()); assertEquals(36,result.missingCellCount()); assertEquals(1,result.eventVersion());
        assertEquals(List.of(1,1,3,3),service.publicStandings(eventId).rows().stream().map(TournamentDtos.StandingRow::rank).toList());
        assertEquals("object",jdbc.queryForObject("select jsonb_typeof(published_historical_points) from tournament_day where event_id=? and day_number=1",String.class,eventId));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_day where event_id=? and published_groups is not null",Integer.class,eventId));
        assertEquals(4,jdbc.queryForObject("select count(*) from tournament_clan where event_id=? and historical_published",Integer.class,eventId));
        assertEquals("a".repeat(64),jdbc.queryForObject("select after_state->>'sourceSha256' from tournament_audit where event_id=? and action='HISTORICAL_IMPORTED'",String.class,eventId));
        assertNull(service.publicStandings(eventId).rows().stream().filter(row->row.clanTag().equals("缺席")).findFirst().orElseThrow().rounds().getFirst().days().getFirst().points());
        assertFalse(service.day(eventId,2,1).published()); assertTrue(service.historicalState(eventId,1,1).historical());
        service.deleteEvent(eventId,new TournamentDtos.DeleteRequest(1,true));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_clan where event_id=?",Integer.class,eventId));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_day where event_id=?",Integer.class,eventId));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_audit where event_id=?",Integer.class,eventId));
        assertEquals(1,events.count());
    }
    @Test void invalidHistoricalLastRowRollsBackWholeImportAndPreservesTarget() {
        final long eventId=historicalEvent(); final TournamentDtos.HistoricalRow valid=historicalRow("A",100);
        final List<TournamentDtos.HistoricalRow> source=List.of(valid,new TournamentDtos.HistoricalRow("B",valid.points(),101));
        final ApiException error=assertThrows(ApiException.class,()->service.importHistorical("admin",eventId,historicalRequest(eventId,source,"import")));
        assertEquals(ApiErrorCode.INVALID_ARGUMENT,error.errorCode()); assertEquals(0,service.config(eventId).event().version());
        assertTrue(clans.findByEventIdOrderByClanTag(eventId).isEmpty()); assertTrue(days.findByEventIdOrderByRoundNumberAscDayNumberAsc(eventId).isEmpty());
        assertTrue(service.publicStandings(eventId).rows().isEmpty()); assertEquals(1,service.auditList(eventId).size());
    }
    @Test void rosterOnlyHistoricalCommitIsVisibleAsLockedStateAfterReload() {
        final long eventId=historicalEvent();
        service.importHistorical("admin",eventId,historicalRequest(eventId,List.of(historicalRow("缺席")),"roster-only"));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_day where event_id=?",Integer.class,eventId));
        final TournamentDtos.HistoricalState state=service.historicalState(eventId,1,1);
        assertTrue(state.imported()); assertFalse(state.canImport()); assertFalse(state.historical());
        assertEquals("EMPTY",service.day(eventId,1,1).status()); assertFalse(service.day(eventId,1,1).published());
        assertEquals(1,service.publicStandings(eventId).rows().size());
    }
    @Test void failedHistoricalAuditRollsBackAlreadyInsertedScoresAndRoster() {
        final long eventId=historicalEvent();
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->service.importHistorical("x".repeat(65),eventId,historicalRequest(eventId,List.of(historicalRow("A",100)),"import")));
        assertEquals(0,service.config(eventId).event().version()); assertNull(events.findById(eventId).orElseThrow().historicalImportKey);
        assertTrue(clans.findByEventIdOrderByClanTag(eventId).isEmpty()); assertTrue(days.findByEventIdOrderByRoundNumberAscDayNumberAsc(eventId).isEmpty());
        assertTrue(service.publicStandings(eventId).rows().isEmpty()); assertEquals(1,service.auditList(eventId).size());
    }
    @Test void simultaneousHistoricalPublicationIsIdempotentAndRejectsDifferentReplacement() throws Exception {
        final long eventId=historicalEvent(); final List<TournamentDtos.HistoricalRow> source=List.of(historicalRow("A",100));
        final TournamentDtos.HistoricalImportRequest request=historicalRequest(eventId,source,"same-import");
        race(()->service.importHistorical("admin-1",eventId,request),()->service.importHistorical("admin-2",eventId,request));
        assertEquals(1,service.auditList(eventId).stream().filter(row->row.action().equals("HISTORICAL_IMPORTED")).count());
        assertEquals(100,service.publicStandings(eventId).rows().getFirst().totalPoints()); assertEquals(1,service.config(eventId).event().version());
        assertEquals(ApiErrorCode.TOURNAMENT_LOCKED,assertThrows(ApiException.class,()->service.importHistorical("admin",eventId,historicalRequest(eventId,List.of(historicalRow("B",100)),"same-import"))).errorCode());
        assertEquals("A",service.publicStandings(eventId).rows().getFirst().clanTag());
    }
    @Test void publicStandingsRemainOneCompleteSnapshotWhenImportCommitsBetweenQueries() throws Exception {
        final long eventId=historicalEvent();
        final TournamentDtos.HistoricalImportRequest request=historicalRequest(eventId,List.of(historicalRow("A",100),historicalRow("B",null,50)),"import");
        final CountDownLatch clansLocked=new CountDownLatch(1); final CountDownLatch publish=new CountDownLatch(1);
        try(final var executor=Executors.newFixedThreadPool(2)) {
            final var writer=executor.submit(()->new TransactionTemplate(transactionManager).execute(transaction->{
                // Pause exactly after the public day query and before its roster query can finish.
                jdbc.execute("lock table tournament_clan in access exclusive mode"); clansLocked.countDown();
                try { assertTrue(publish.await(10,TimeUnit.SECONDS)); }
                catch(final InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
                return service.importHistorical("admin",eventId,request);
            }));
            try {
                assertTrue(clansLocked.await(10,TimeUnit.SECONDS));
                final var reader=executor.submit(()->service.publicStandings(eventId));
                final long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10); boolean rosterReadBlocked=false;
                while(System.nanoTime()<deadline) {
                    rosterReadBlocked=Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%tournament_clan%')",Boolean.class));
                    if(rosterReadBlocked){break;} Thread.sleep(10);
                }
                assertTrue(rosterReadBlocked,"Public standings must have read the old event/day snapshot and be waiting on the roster query");
                publish.countDown(); writer.get(20,TimeUnit.SECONDS);
                final TournamentDtos.Standings old=reader.get(20,TimeUnit.SECONDS);
                assertEquals(0,old.event().version()); assertTrue(old.rows().isEmpty(),"One response must not combine new historical clans with old day scores");
                assertTrue(old.days().stream().noneMatch(TournamentDtos.StandingDay::published));
                final TournamentDtos.Standings current=service.publicStandings(eventId);
                assertEquals(1,current.event().version()); assertEquals(List.of(100L,50L),current.rows().stream().map(TournamentDtos.StandingRow::totalPoints).toList());
                assertEquals(2,current.days().stream().filter(TournamentDtos.StandingDay::published).count());
            } finally { publish.countDown(); }
        }
    }
    @Test void historicalScoresCanBeSanctionedRestoredAndReplacedWithCompleteDayGroups() throws Exception {
        final long eventId=historicalEvent(); final List<TournamentDtos.HistoricalRow> source=List.of(historicalRow("A",999,123),historicalRow("B",50,25),historicalRow("C",25,10));
        service.importHistorical("admin",eventId,historicalRequest(eventId,source,"import"));
        assertEquals(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,assertThrows(ApiException.class,()->service.correction("admin",eventId,1,1,new TournamentDtos.CorrectionRequest(1,1,1,"fix"))).errorCode());
        service.saveRules("admin",eventId,1,new TournamentDtos.RuleRequest(1,0,ruleDays(100)));
        assertEquals(1122,service.publicStandings(eventId).rows().getFirst().totalPoints()); assertTrue(service.config(eventId).rounds().getFirst().locked());
        assertEquals(ApiErrorCode.TOURNAMENT_LOCKED,assertThrows(ApiException.class,()->service.saveRules("admin",eventId,1,new TournamentDtos.RuleRequest(2,1,ruleDays(200)))).errorCode());
        service.clearPoints("admin",eventId,new TournamentDtos.ClearRequest(2,1,1,"A","violation",false));
        final TournamentDtos.DayView published=service.day(eventId,1,1);
        service.correction("admin",eventId,1,1,new TournamentDtos.CorrectionRequest(published.eventVersion(),published.version(),1,"fix"));
        final TournamentDtos.DayView correction=service.day(eventId,1,1);
        service.deleteDraft(eventId,1,1,new TournamentDtos.Versions(correction.eventVersion(),correction.version()));
        assertTrue(service.historicalState(eventId,1,1).historical()); assertNull(service.day(eventId,1,1).expectedGroupCount());
        final TournamentDtos.DayView again=service.day(eventId,1,1);
        service.correction("admin",eventId,1,1,new TournamentDtos.CorrectionRequest(again.eventVersion(),again.version(),1,"fix again"));
        assertEquals(123,service.publicStandings(eventId).rows().getFirst().totalPoints());
        save(eventId,1,1,List.of(group(eventId,1,1,1,0,"A","C","B")),List.of());
        assertEquals(123,service.publicStandings(eventId).rows().getFirst().totalPoints()); publish(eventId,1,1,"correction");
        assertFalse(service.historicalState(eventId,1,1).historical()); assertEquals(123,service.publicStandings(eventId).rows().getFirst().totalPoints());
        assertEquals("999",jdbc.queryForObject("select before_state->'historicalPoints'->>'A' from tournament_audit where event_id=? and action='CORRECTION_PUBLISHED'",String.class,eventId));
        service.clearPoints("admin",eventId,new TournamentDtos.ClearRequest(service.config(eventId).event().version(),1,1,"A","appeal",true));
        assertEquals(223,service.publicStandings(eventId).rows().getFirst().totalPoints());
    }
    @Test void databaseRejectsTwoPublishedSourcesForOneHistoricalDay() {
        final long eventId=historicalEvent(); service.importHistorical("admin",eventId,historicalRequest(eventId,List.of(historicalRow("A",100)),"import"));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->jdbc.update("update tournament_day set published_groups='[]'::jsonb where event_id=?",eventId));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->jdbc.update("update tournament_day set published_historical_points='[]'::jsonb where event_id=?",eventId));
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->jdbc.update("update tournament_event set historical_import_hash=null where id=?",eventId));
        assertEquals(100,service.publicStandings(eventId).rows().getFirst().totalPoints());
    }
    @Test void summerSeedPublishesOnlyApprovedTop32AndPreservesFourOmissions() throws Exception {
        applySummerSeed();
        final long eventId=summerEventId();
        final TournamentDtos.Standings board=service.publicStandings(eventId);
        assertEquals(32,board.rows().size()); assertEquals(10,board.days().size());
        assertTrue(board.days().stream().allMatch(TournamentDtos.StandingDay::published));
        assertEquals(4,board.rows().stream().flatMap(row->row.rounds().stream()).flatMap(round->round.days().stream()).filter(day->day.points()==null).count());
        assertEquals(36780,summerRow(board,"KSR").totalPoints()); assertEquals(1,summerRow(board,"CHRD").rank());
        assertEquals(4,summerRow(board,"25时").rank()); assertEquals(32660,summerRow(board,"非比啾比").totalPoints());
        assertEquals(27913,summerRow(board,"送葬者*").totalPoints()); assertEquals(32,summerRow(board,"送葬者*").rank());
        assertNull(summerRow(board,"ROSA").rounds().getFirst().days().getLast().points());
        assertNull(summerRow(board,"PHNX").rounds().get(1).days().getLast().points());
        assertNull(summerRow(board,"UCR").rounds().getLast().days().getLast().points());
        assertNull(summerRow(board,"送葬者*").rounds().getFirst().days().getLast().points());
        assertEquals(List.of("小组赛","决赛圈"),board.event().dayLabels());
        assertEquals(5,service.config(eventId).rounds().size()); assertTrue(service.config(eventId).rounds().stream().noneMatch(TournamentDtos.RoundRule::complete));
        assertTrue(service.historicalState(eventId,1,1).imported()); assertFalse(service.historicalState(eventId,1,1).canImport());
        assertEquals(32,jdbc.queryForObject("select count(*) from tournament_clan where event_id=? and historical_published",Integer.class,eventId));
        assertEquals("flyway:V30",service.auditList(eventId).getLast().actor());
        assertTrue(service.publicStandings(id).rows().isEmpty());
    }
    @Test void summerSeedRerunAndApiRetryPreserveSubsequentCorrections() throws Exception {
        applySummerSeed();
        final long eventId=summerEventId();
        service.clearPoints("admin",eventId,new TournamentDtos.ClearRequest(service.config(eventId).event().version(),1,1,"KSR","review",false));
        final TournamentDtos.Standings before=service.publicStandings(eventId);
        final int auditCount=service.auditList(eventId).size();
        applySummerSeed();
        assertEquals(before,service.publicStandings(eventId)); assertEquals(auditCount,service.auditList(eventId).size());
        final var imported=audits.findAll().stream().filter(audit->Long.valueOf(eventId).equals(audit.eventId) && audit.action.equals("HISTORICAL_IMPORTED")).findFirst().orElseThrow();
        final List<TournamentDtos.HistoricalRow> source=((List<?>)imported.afterState.get("rows")).stream().map(value->{
            final Map<?,?> row=(Map<?,?>)value;
            final List<Integer> points=((List<?>)row.get("points")).stream().map(point->point==null?null:((Number)point).intValue()).toList();
            return new TournamentDtos.HistoricalRow((String)row.get("clanTag"),points,((Number)row.get("sourceTotal")).longValue());
        }).toList();
        final TournamentDtos.HistoricalPreview retry=service.importHistorical("admin",eventId,new TournamentDtos.HistoricalImportRequest(before.event().version(),
                (String)imported.afterState.get("sourceName"),(String)imported.afterState.get("sourceSha256"),source,true,"flyway-v30:2026-cn-summer-top32"));
        assertEquals(before,retry.standings()); assertEquals(auditCount,service.auditList(eventId).size());
    }
    @Test void summerSeedPreservesExistingEmptyEventConfiguration() throws Exception {
        final long eventId=service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","SUMMER",5,2,List.of("Day 1","Day 2"))).event().id();
        service.saveRules("admin",eventId,1,new TournamentDtos.RuleRequest(0,0,ruleDays(777)));
        final var before=service.config(eventId).rounds().getFirst();
        applySummerSeed();
        assertEquals(eventId,summerEventId()); assertEquals(List.of("Day 1","Day 2"),service.config(eventId).event().dayLabels());
        assertEquals(before.days(),service.config(eventId).rounds().getFirst().days());
        assertEquals(36780,summerRow(service.publicStandings(eventId),"KSR").totalPoints());
        assertEquals(1,service.auditList(eventId).stream().filter(audit->audit.action().equals("CREATE")).count());
    }
    @Test void summerSeedRejectsExistingSharedDraftWithoutPartialWrites() throws Exception {
        final long eventId=historicalEvent();
        service.saveRules("admin",eventId,1,new TournamentDtos.RuleRequest(0,0,ruleDays(100)));
        service.expectedGroups(eventId,1,1,new TournamentDtos.ExpectedGroupsRequest(1,0,1));
        save(eventId,1,1,List.of(group(eventId,1,1,1,0,"A","B","C")),List.of("A","B","C"));
        final TournamentDtos.DayView before=service.day(eventId,1,1);
        final int auditCount=service.auditList(eventId).size();
        assertThrows(org.springframework.dao.DataAccessException.class,this::applySummerSeed);
        assertEquals(before,service.day(eventId,1,1)); assertEquals(auditCount,service.auditList(eventId).size());
        assertFalse(service.historicalState(eventId,1,1).imported()); assertEquals(3,service.config(eventId).clans().size());
    }
    @Test void summerSeedRejectsExistingPublishedBatchAndDifferentDimensions() throws Exception {
        final long eventId=historicalEvent();
        service.importHistorical("admin",eventId,historicalRequest(eventId,List.of(historicalRow("A",100)),"other-import"));
        final TournamentDtos.Standings before=service.publicStandings(eventId);
        assertThrows(org.springframework.dao.DataAccessException.class,this::applySummerSeed);
        assertEquals(before,service.publicStandings(eventId));
        service.deleteEvent(eventId,new TournamentDtos.DeleteRequest(before.event().version(),true));
        final long incompatible=service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","SUMMER",4,2,List.of("Day 1","Day 2"))).event().id();
        assertThrows(org.springframework.dao.DataAccessException.class,this::applySummerSeed);
        assertEquals(4,service.config(incompatible).event().roundCount()); assertTrue(service.config(incompatible).clans().isEmpty());
    }
    @Test void summerSeedRollsBackAllRowsWhenAuditInsertFails() {
        final long clanCount=clans.count(), dayCount=days.count(), eventCount=events.count(), auditCount=audits.count();
        jdbc.execute("alter table tournament_audit add constraint test_reject_summer_seed check (actor <> 'flyway:V30') not valid");
        try {
            assertThrows(org.springframework.dao.DataAccessException.class,this::applySummerSeed);
            assertFalse(events.existsByYearAndRegionAndSeason(2026,"CN","SUMMER"));
            assertEquals(clanCount,clans.count()); assertEquals(dayCount,days.count());
            assertEquals(eventCount,events.count()); assertEquals(auditCount,audits.count());
        } finally { jdbc.execute("alter table tournament_audit drop constraint test_reject_summer_seed"); }
    }
    @Test void defaultSeedMatchesAllFortyApprovedScoresAndHasNoFifthRank() {
        assertTrue(migrationDefault.active()); assertEquals(1,migrationDefault.version());
        assertNull(migrationDefault.sourceEventId()); assertEquals("2026 FIRE_CUP",migrationDefault.sourceLabel());
        final int[][][] expected = {
            {{2305,1153,577,289},{1845,1291,903,631}}, {{2813,1756,879,440},{2253,1575,1101,771}},
            {{3767,2173,1139,667},{3013,2109,1477,1033}}, {{4937,3315,2038,1020},{3949,2765,1935,1355}},
            {{6611,4439,4155,1367},{5287,3703,2591,1815}}
        };
        assertEquals(5,migrationDefault.rounds().size());
        for (int round=0; round<5; round++) {
            final var configured=migrationDefault.rounds().get(round); assertEquals(round+1,configured.roundNumber()); assertEquals(2,configured.days().size());
            for (int day=0;day<2;day++) {
                assertEquals(day+1,configured.days().get(day).dayNumber()); assertEquals(4,configured.days().get(day).points().size());
                for (int rank=0;rank<4;rank++) {
                    assertEquals(rank+1,configured.days().get(day).points().get(rank).rank());
                    assertEquals(expected[round][day][rank],configured.days().get(day).points().get(rank).points());
                }
            }
        }
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.update("insert into tournament_default_rules (id,version,active,source_label,rounds) values (2,0,false,'','[]')"));
    }
    @Test void inheritedRulesFreezeAtomicallyAndSourceDeletionKeepsSnapshotAndGlobalAudit() throws Exception {
        enableSeed();
        final long inheritor=newEvent("EU",2), untouched=newEvent("NA",2);
        assertEquals(2305,firstPoints(inheritor));
        service.expectedGroups(inheritor,1,1,new TournamentDtos.ExpectedGroupsRequest(0,0,1,1L));
        assertEquals("FROZEN",service.ruleSource(inheritor).source()); assertEquals(1L,service.ruleSource(inheritor).defaultVersion());
        save(inheritor,1,1,List.of(group(inheritor,1,1,1,0,"A","B","C")),List.of("A","B","C"));
        publish(inheritor,1,1,"default-publication");
        final var published=service.publicStandings(inheritor); assertEquals(2305,published.rows().getFirst().totalPoints());
        service.saveRules("admin",untouched,1,new TournamentDtos.RuleRequest(0,1,ruleDays(777),1L));
        final var replacement=service.setDefaultRules("admin",new TournamentDtos.SetDefaultRulesRequest(untouched,1,1,true));
        assertEquals(2,replacement.version()); assertEquals(2305,firstPoints(inheritor)); assertEquals(100,firstPoints(id));
        final long follower=newEvent("ASIA",2); assertEquals(777,firstPoints(follower));
        service.saveRules("admin",untouched,1,new TournamentDtos.RuleRequest(1,2,ruleDays(888)));
        assertTrue(service.ruleSource(untouched).defaultOutdated()); assertEquals(777,firstPoints(follower));
        service.deleteEvent(untouched,new TournamentDtos.DeleteRequest(2,true));
        assertNull(service.defaultRules().sourceEventId()); assertEquals(777,firstPoints(follower));
        assertEquals(1,jdbc.queryForObject("select count(*) from tournament_audit where event_id is null and action='DEFAULT_RULES_SET'",Integer.class));
        service.clearDefaultRules("admin",new TournamentDtos.ClearDefaultRulesRequest(2,true));
        assertEquals(3L,service.ruleSource(follower).defaultVersion()); assertFalse(service.config(follower).rounds().getFirst().complete());
        assertEquals(2305,firstPoints(inheritor)); assertEquals(100,firstPoints(id)); assertEquals(published,service.publicStandings(inheritor));
    }
    @Test void defaultWritesAndFreezeRaceRejectStaleVersionsWithoutPartialState() throws Exception {
        enableSeed(); final long source=newEvent("EU",2), target=newEvent("NA",2);
        service.saveRules("admin",source,1,new TournamentDtos.RuleRequest(0,1,ruleDays(777),1L));
        final var request=new TournamentDtos.SetDefaultRulesRequest(source,1,1,true);
        final List<Boolean> results=race(()->tryWrite(()->service.setDefaultRules("a",request)),()->tryWrite(()->service.setDefaultRules("b",request)));
        assertEquals(1,results.stream().filter(Boolean::booleanValue).count()); assertEquals(2,service.defaultRules().version());
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,assertThrows(ApiException.class,()->service.expectedGroups(target,1,1,new TournamentDtos.ExpectedGroupsRequest(0,0,1,1L))).errorCode());
        assertEquals("INHERIT",service.ruleSource(target).source()); assertEquals(0,days.findByEventIdOrderByRoundNumberAscDayNumberAsc(target).size());
        final List<Boolean> freeze=race(()->tryWrite(()->service.expectedGroups(target,1,1,new TournamentDtos.ExpectedGroupsRequest(0,0,1,2L))),
                ()->tryWrite(()->service.clearDefaultRules("a",new TournamentDtos.ClearDefaultRulesRequest(2,true))));
        assertTrue(freeze.get(1));
        if (freeze.get(0)) { assertEquals("FROZEN",service.ruleSource(target).source()); assertEquals(777,firstPoints(target)); }
        else { assertEquals("INHERIT",service.ruleSource(target).source()); assertTrue(service.config(target).rounds().getFirst().days().isEmpty()); }
    }
    @Test void concurrentFirstDefaultAndStaleCustomSaveCannotOverwriteNewDefault() throws Exception {
        enableSeed(); final long source=newEvent("EU",2), target=newEvent("NA",2);
        service.saveRules("admin",source,1,new TournamentDtos.RuleRequest(0,1,ruleDays(777),1L));
        service.clearDefaultRules("admin",new TournamentDtos.ClearDefaultRulesRequest(1,true));
        assertEquals(2L,service.ruleSource(target).defaultVersion());
        final var request=new TournamentDtos.SetDefaultRulesRequest(source,1,2,false);
        final List<Boolean> results=race(()->tryWrite(()->service.setDefaultRules("a",request)),()->tryWrite(()->service.setDefaultRules("b",request)));
        assertEquals(1,results.stream().filter(Boolean::booleanValue).count());
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,assertThrows(ApiException.class,()->service.saveRules("a",target,1,new TournamentDtos.RuleRequest(0,2,ruleDays(999),2L))).errorCode());
        assertEquals("INHERIT",service.ruleSource(target).source()); assertEquals(777,firstPoints(target));
        final long four=service.create("admin",new TournamentDtos.CreateRequest(2025,"EU","SUMMER",4,2,List.of("Day 1","Day 2"))).event().id();
        assertEquals(4,service.config(four).rounds().size()); assertTrue(service.config(four).rounds().stream().allMatch(TournamentDtos.RoundRule::complete));
    }
    @Test void customAndMismatchRulesDoNotSilentlyFillMissingDaysAndHistoricalImportKeepsItsRules() {
        enableSeed(); final long threeDays=newEvent("EU",3), partial=newEvent("NA",2);
        assertFalse(service.config(threeDays).rounds().getFirst().complete());
        assertEquals(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,assertThrows(ApiException.class,()->service.setDefaultRules("a",new TournamentDtos.SetDefaultRulesRequest(threeDays,0,1,true))).errorCode());
        service.saveRules("a",partial,1,new TournamentDtos.RuleRequest(0,1,List.of(new TournamentDtos.RuleDay(1,List.of(new TournamentDtos.RankPoints(1,0)))),1L));
        assertEquals("CUSTOM",service.ruleSource(partial).source()); assertEquals(0,firstPoints(partial)); assertFalse(service.config(partial).rounds().getFirst().complete());
        final long history=historicalEvent(); service.importHistorical("a",history,historicalRequest(history,List.of(historicalRow("A",123)),"default-history"));
        assertEquals("FROZEN",service.ruleSource(history).source()); assertTrue(service.config(history).rounds().getFirst().days().isEmpty());
        assertEquals(123,service.publicStandings(history).rows().getFirst().totalPoints());
    }
    @Test void defaultAndFirstCustomSaveRollbackWhenAuditFails() {
        enableSeed(); final long source=newEvent("EU",2);
        jdbc.execute("alter table tournament_audit add constraint test_reject_default check (action not in ('DEFAULT_RULES_SET','RULES_UPDATED')) not valid");
        try {
            assertThrows(org.springframework.dao.DataAccessException.class,()->service.setDefaultRules("a",new TournamentDtos.SetDefaultRulesRequest(source,0,1,true)));
            assertEquals(1,service.defaultRules().version());
            assertThrows(org.springframework.dao.DataAccessException.class,()->service.saveRules("a",source,1,new TournamentDtos.RuleRequest(0,1,ruleDays(777),1L)));
            assertEquals("INHERIT",service.ruleSource(source).source()); assertEquals(0,service.config(source).event().version());
            assertEquals(0,rules.findByEventIdAndRoundNumber(source,1).orElseThrow().days.size());
        } finally { jdbc.execute("alter table tournament_audit drop constraint test_reject_default"); }
    }
    @Test void directDefaultEditingUpdatesFollowersAndPreservesFrozenRulesWithoutAnEvent() {
        enableSeed(); final long frozen=newEvent("EU",2), follower=newEvent("NA",2);
        service.expectedGroups(frozen,1,1,new TournamentDtos.ExpectedGroupsRequest(0,0,1,1L));
        final long eventCount=events.count();
        final var updated=service.saveDefaultConfiguration("admin",new TournamentDtos.DefaultConfigurationRequest(1,true,defaultRounds(777,5,2)));
        assertEquals(2,updated.version()); assertNull(updated.sourceEventId()); assertEquals("GLOBAL_DEFAULT",updated.sourceLabel());
        assertEquals(eventCount,events.count()); assertEquals(777,firstPoints(follower)); assertEquals(2305,firstPoints(frozen)); assertEquals(100,firstPoints(id));
        assertEquals(1,jdbc.queryForObject("select count(*) from tournament_audit where event_id is null and action='DEFAULT_RULES_SET'",Integer.class));
        final var before=service.defaultRules();
        assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,assertThrows(ApiException.class,()->service.saveDefaultConfiguration("admin",new TournamentDtos.DefaultConfigurationRequest(2,false,defaultRounds(888,5,2)))).errorCode());
        assertEquals(before,service.defaultRules());
    }
    @Test void directDefaultEditingValidatesCompleteUniformDimensionsAndSupportsZeroAndFifthRank() {
        final var configured=service.saveDefaultConfiguration("admin",new TournamentDtos.DefaultConfigurationRequest(0,false,defaultRounds(0,4,3)));
        assertEquals(4,configured.rounds().size()); assertEquals(3,configured.rounds().getFirst().days().size());
        assertEquals(0,configured.rounds().getFirst().days().getFirst().points().getFirst().points());
        assertEquals(5,configured.rounds().getFirst().days().getFirst().points().size());
        final var persisted=service.defaultRules();
        final var missingRanks=new java.util.ArrayList<>(configured.rounds());
        missingRanks.set(0,new TournamentDtos.DefaultRound(1,List.of(new TournamentDtos.RuleDay(1,List.of(new TournamentDtos.RankPoints(1,100))),new TournamentDtos.RuleDay(2,List.of()),new TournamentDtos.RuleDay(3,List.of()))));
        assertEquals(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,assertThrows(ApiException.class,()->service.saveDefaultConfiguration("a",new TournamentDtos.DefaultConfigurationRequest(1,true,missingRanks))).errorCode());
        final var uneven=new java.util.ArrayList<>(configured.rounds()); uneven.set(1,new TournamentDtos.DefaultRound(2,ruleDays(10)));
        assertEquals(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,assertThrows(ApiException.class,()->service.saveDefaultConfiguration("a",new TournamentDtos.DefaultConfigurationRequest(1,true,uneven))).errorCode());
        final var duplicate=new java.util.ArrayList<>(configured.rounds()); duplicate.set(1,duplicate.getFirst());
        assertEquals(ApiErrorCode.INVALID_ARGUMENT,assertThrows(ApiException.class,()->service.saveDefaultConfiguration("a",new TournamentDtos.DefaultConfigurationRequest(1,true,duplicate))).errorCode());
        assertEquals(ApiErrorCode.INVALID_ARGUMENT,assertThrows(ApiException.class,()->service.saveDefaultConfiguration("a",new TournamentDtos.DefaultConfigurationRequest(1,true,configured.rounds().subList(0,3)))).errorCode());
        assertEquals(persisted,service.defaultRules());
    }
    @Test void directDefaultConfigurationSerializesConcurrentEditors() throws Exception {
        enableSeed();
        final List<Boolean> results=race(()->tryWrite(()->service.saveDefaultConfiguration("a",new TournamentDtos.DefaultConfigurationRequest(1,true,defaultRounds(111,5,2)))),
                ()->tryWrite(()->service.saveDefaultConfiguration("b",new TournamentDtos.DefaultConfigurationRequest(1,true,defaultRounds(222,5,2)))));
        assertEquals(1,results.stream().filter(Boolean::booleanValue).count()); assertEquals(2,service.defaultRules().version());
        final int winner=service.defaultRules().rounds().getFirst().days().getFirst().points().getFirst().points();
        assertTrue(winner==111||winner==222);
        assertTrue(service.defaultRules().rounds().stream().allMatch(round->round.days().stream().allMatch(day->day.points().getFirst().points()==winner)));
    }
    private List<TournamentDtos.DefaultRound> defaultRounds(final int first, final int rounds, final int number) {
        final List<TournamentDtos.RankPoints> points=List.of(new TournamentDtos.RankPoints(1,first),new TournamentDtos.RankPoints(2,50),new TournamentDtos.RankPoints(3,25),new TournamentDtos.RankPoints(4,10),new TournamentDtos.RankPoints(5,0));
        return java.util.stream.IntStream.rangeClosed(1,rounds).mapToObj(round->new TournamentDtos.DefaultRound(round,
                java.util.stream.IntStream.rangeClosed(1,number).mapToObj(day->new TournamentDtos.RuleDay(day,points)).toList())).toList();
    }
    @Test void upgradeBackfillsOnlyActualRulesAndRepeatedMigratePreservesAdminChanges() throws Exception {
        final String database="tournament_default_upgrade";
        jdbc.execute("create database "+database);
        final String migrationUrl=POSTGRES.getJdbcUrl().replace("/wotb?", "/"+database+"?");
        final var legacy=Flyway.configure().dataSource(migrationUrl,POSTGRES.getUsername(),POSTGRES.getPassword()).target("31").load();
        legacy.migrate();
        try (final var connection=java.sql.DriverManager.getConnection(migrationUrl,POSTGRES.getUsername(),POSTGRES.getPassword());
             final var statement=connection.createStatement()) {
            statement.execute("insert into tournament_event (id,year,region,season,round_count,days_per_round,day_labels) values (9001,2025,'EU','SPRING',4,2,'[]'),(9002,2025,'EU','SUMMER',4,2,'[]'),(9003,2025,'EU','WINTER',4,2,'[]'),(9004,2025,'EU','AUTUMN',4,2,'[]')");
            statement.execute("insert into tournament_rule (event_id,round_number,days) values (9001,1,'[{\"dayNumber\":1,\"points\":[]}]'),(9002,1,'[{\"dayNumber\":1,\"points\":[{\"rank\":1,\"points\":0}]}]'),(9003,1,'[]'),(9004,1,'[]')");
            statement.execute("insert into tournament_day (event_id,round_number,day_number,expected_group_count) values (9003,1,1,1)");
            statement.execute("insert into tournament_day (event_id,round_number,day_number,published_historical_points) values (9004,1,1,'{\"A\":123}')");
            final var current=Flyway.configure().dataSource(migrationUrl,POSTGRES.getUsername(),POSTGRES.getPassword()).load(); current.migrate();
            try (final var result=statement.executeQuery("select rule_source from tournament_event where id>=9001 order by id")) {
                for (final String expected:List.of("INHERIT","CUSTOM","FROZEN","FROZEN")) { assertTrue(result.next()); assertEquals(expected,result.getString(1)); }
            }
            try (final var result=statement.executeQuery("select published_historical_points->>'A' from tournament_day where event_id=9004")) { assertTrue(result.next()); assertEquals("123",result.getString(1)); }
            statement.execute("update tournament_default_rules set version=7,active=false,rounds='[]'"); current.migrate();
            try (final var result=statement.executeQuery("select version,active from tournament_default_rules")) { assertTrue(result.next()); assertEquals(7,result.getLong(1)); assertFalse(result.getBoolean(2)); }
            try (final var result=statement.executeQuery("select count(*) from tournament_audit where actor='flyway:V32' and event_id is null")) { assertTrue(result.next()); assertEquals(1,result.getInt(1)); }
        } finally { jdbc.execute("drop database "+database); }
    }
    private long newEvent(final String region, final int number) {
        return service.create("admin",new TournamentDtos.CreateRequest(2026,region,"FIRE_CUP",5,number,
                number==2?List.of("Day 1","Day 2"):List.of("Day 1","Day 2","Day 3"))).event().id();
    }
    private int firstPoints(final long eventId) { return service.config(eventId).rounds().getFirst().days().getFirst().points().getFirst().points(); }
    private void enableSeed() {
        jdbc.update("update tournament_default_rules set version=1,active=true,source_label='2026 FIRE_CUP',rounds=?::jsonb where id=1",
                JsonMapper.builder().findAndAddModules().build().writeValueAsString(migrationDefault.rounds()));
    }
    private void applySummerSeed() throws Exception {
        jdbc.execute(new ClassPathResource("db/migration/V30__import_2026_cn_summer_top32.sql").getContentAsString(StandardCharsets.UTF_8));
    }
    private long summerEventId() {
        return events.findAllByOrderByYearDescIdDesc().stream().filter(event->event.year==2026&&event.region.equals("CN")&&event.season.equals("SUMMER")).findFirst().orElseThrow().id;
    }
    private TournamentDtos.StandingRow summerRow(final TournamentDtos.Standings board,final String tag) {
        return board.rows().stream().filter(row->row.clanTag().equals(tag)).findFirst().orElseThrow();
    }
    private long historicalEvent() { return service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","SUMMER",5,2,List.of("小组赛","决赛圈"))).event().id(); }
    private TournamentDtos.HistoricalImportRequest historicalRequest(final long eventId, final List<TournamentDtos.HistoricalRow> source, final String key) {
        return new TournamentDtos.HistoricalImportRequest(service.config(eventId).event().version(),"source.png","a".repeat(64),source,true,key);
    }
    private TournamentDtos.HistoricalRow historicalRow(final String tag, final Integer... input) {
        final java.util.ArrayList<Integer> values=new java.util.ArrayList<>(java.util.Collections.nCopies(10,null)); long total=0;
        for(int index=0;index<input.length;index++){values.set(index,input[index]); if(input[index]!=null){total+=input[index];}}
        return new TournamentDtos.HistoricalRow(tag,values,total);
    }
    private TournamentDtos.IncomingGroup group(final long eventId, final int round, final int day, final int number, final int color, final String... tags) throws Exception {
        final BufferedImage image=new BufferedImage(32,32,BufferedImage.TYPE_INT_RGB); image.setRGB(0,0,color);
        final ByteArrayOutputStream output=new ByteArrayOutputStream(); ImageIO.write(image,"png",output);
        final TournamentDtos.DayView view=service.day(eventId,round,day);
        final TournamentDtos.RecognitionPermit attachment=service.recognitionPermit("admin",eventId,round,day,view.eventVersion(),view.version(),view.rulesVersion(),new MockMultipartFile("image","group.png","image/png",output.toByteArray()));
        final java.util.ArrayList<TournamentDtos.Team> teams=new java.util.ArrayList<>(); for(int i=0;i<tags.length;i++){teams.add(new TournamentDtos.Team(tags[i],i+1));}
        return new TournamentDtos.IncomingGroup(number,attachment.evidenceId(),attachment.imageHash(),teams,"ERROR",true);
    }
    private void save(final long eventId, final int round, final int number, final List<TournamentDtos.IncomingGroup> groups, final List<String> tags) {
        final TournamentDtos.DayView day=service.day(eventId,round,number); service.saveDraft(eventId,round,number,new TournamentDtos.DraftRequest(day.eventVersion(),day.version(),day.rulesVersion(),groups,tags));
    }
    private void publish(final long eventId, final int round, final int number, final String key) {
        final TournamentDtos.DayView day=service.day(eventId,round,number); service.finalizeDay("admin",eventId,round,number,new TournamentDtos.FinalizeRequest(day.eventVersion(),day.version(),day.rulesVersion(),key));
    }
    private List<TournamentDtos.RuleDay> ruleDays(final int first) {
        final List<TournamentDtos.RankPoints> points=List.of(new TournamentDtos.RankPoints(1,first),new TournamentDtos.RankPoints(2,50),new TournamentDtos.RankPoints(3,25),new TournamentDtos.RankPoints(4,10));
        return List.of(new TournamentDtos.RuleDay(1,points),new TournamentDtos.RuleDay(2,points));
    }
    private boolean tryWrite(final Runnable action) { try{action.run();return true;}catch(final ApiException error){assertEquals(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,error.errorCode());return false;} }
    private <T> List<T> race(final Callable<T> first, final Callable<T> second) throws Exception {
        final CountDownLatch ready=new CountDownLatch(2); final CountDownLatch start=new CountDownLatch(1);
        try(final var executor=Executors.newFixedThreadPool(2)) {
            final var a=executor.submit(()->{ready.countDown();start.await();return first.call();}); final var b=executor.submit(()->{ready.countDown();start.await();return second.call();});
            assertTrue(ready.await(10,TimeUnit.SECONDS)); start.countDown(); return List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS));
        }
    }
}

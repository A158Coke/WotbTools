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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
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

/** Real PostgreSQL coverage for tournament CSV import, replacement, and audit contracts. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class TournamentCsvIntegrationTest {
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
        final var groupDay = service.day(groupEvent, 1, 1);
        service.expectedGroups(groupEvent, 1, 1, new TournamentDtos.ExpectedGroupsRequest(groupDay.eventVersion(), groupDay.version(), 1));
        save(groupEvent, 1, 1, List.of(group(groupEvent, 1, 1, 1, 0, "A", "B", "C")), List.of("A", "B", "C"));
        publish(groupEvent, 1, 1, "publish-900-group");
        service.clearPoints("admin", groupEvent, new TournamentDtos.ClearRequest(service.config(groupEvent).event().version(), 1, 1, "A", "sanction", false));
        assertCanonicalCsvPreservesClearAndRestore(groupEvent, "published-groups", 900);
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

    private static void assertCanonicalFacts(final TournamentDtos.Standings standings, final String clanTag,
                                             final List<Long> expectedPoints, final long expectedTotal) {
        final TournamentDtos.StandingRow row = standings.rows().stream().filter(value -> value.clanTag().equals(clanTag)).findFirst().orElseThrow();
        assertEquals(expectedPoints, points(standings, clanTag));
        assertEquals(expectedTotal, row.totalPoints());
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

    private MockMultipartFile csv(final String text) { return new MockMultipartFile("file", "standings.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8)); }

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

    private MockMultipartFile csvFixture() throws Exception {
        return new MockMultipartFile("file", "2026战火杯积分榜.csv", "text/csv", new ClassPathResource("tournament/2026-fire-cup-standings.csv").getContentAsByteArray());
    }

    private String csvText(final String rows) { return "军团标签,R1D1,R1D2,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2,R5D1,R5D2,总积分\n" + rows; }

    private TournamentDtos.IncomingGroup group(final long eventId, final int round, final int day, final int number, final int color, final String... tags) throws Exception {
        final BufferedImage image=new BufferedImage(32,32,BufferedImage.TYPE_INT_RGB); image.setRGB(0,0,color);
        final ByteArrayOutputStream output=new ByteArrayOutputStream(); ImageIO.write(image,"png",output);
        final TournamentDtos.DayView view=service.day(eventId,round,day);
        final TournamentDtos.RecognitionPermit attachment=service.recognitionPermit("admin",eventId,round,day,view.eventVersion(),view.version(),view.rulesVersion(),new MockMultipartFile("image","group.png","image/png",output.toByteArray()));
        final java.util.ArrayList<TournamentDtos.Team> teams=new java.util.ArrayList<>(); for(int i=0;i<tags.length;i++){teams.add(new TournamentDtos.Team(tags[i],i+1));}
        return new TournamentDtos.IncomingGroup(number,attachment.evidenceId(),attachment.imageHash(),teams,"ERROR",true);
    }

    private long point(final TournamentDtos.Standings standings, final String tag) {
        return standings.rows().stream().filter(row -> row.clanTag().equals(tag)).findFirst().orElseThrow()
                .rounds().getFirst().days().getFirst().points();
    }

    private static List<Long> points(final TournamentDtos.Standings standings, final String tag) {
        return standings.rows().stream()
                .filter(row -> row.clanTag().equals(tag))
                .findFirst()
                .orElseThrow()
                .rounds().stream()
                .flatMap(round -> round.days().stream())
                .map(TournamentDtos.DayPoints::points)
                .toList();
    }

    private void publish(final long eventId, final int round, final int number, final String key) {
        final TournamentDtos.DayView day=service.day(eventId,round,number); service.finalizeDay("admin",eventId,round,number,new TournamentDtos.FinalizeRequest(day.eventVersion(),day.version(),day.rulesVersion(),key));
    }

    private List<TournamentDtos.RuleDay> ruleDays(final int first) {
        final List<TournamentDtos.RankPoints> points=List.of(new TournamentDtos.RankPoints(1,first),new TournamentDtos.RankPoints(2,50),new TournamentDtos.RankPoints(3,25),new TournamentDtos.RankPoints(4,10));
        return List.of(new TournamentDtos.RuleDay(1,points),new TournamentDtos.RuleDay(2,points));
    }

    private void save(final long eventId, final int round, final int number, final List<TournamentDtos.IncomingGroup> groups, final List<String> tags) {
        final TournamentDtos.DayView day=service.day(eventId,round,number); service.saveDraft(eventId,round,number,new TournamentDtos.DraftRequest(day.eventVersion(),day.version(),day.rulesVersion(),groups,tags));
    }

    private TournamentDtos.StandingRow summerRow(final TournamentDtos.Standings board,final String tag) {
        return board.rows().stream().filter(row->row.clanTag().equals(tag)).findFirst().orElseThrow();
    }

}

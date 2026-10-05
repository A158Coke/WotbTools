package com.wotb.web.tournament;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentEventRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.tournament.service.TournamentService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
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
import java.util.List;
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
    private long id;
    @BeforeEach void setup() {
        audits.deleteAll(); evidence.deleteAll(); days.deleteAll(); clans.deleteAll(); rules.deleteAll(); events.deleteAll();
        final TournamentDtos.Config config=service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","FIRE_CUP",5,2,List.of("Day 1","Day 2"))); id=config.event().id();
        service.saveRules("admin",id,1,new TournamentDtos.RuleRequest(0,0,ruleDays(100)));
        service.expectedGroups(id,1,1,new TournamentDtos.ExpectedGroupsRequest(1,0,1));
    }
    @Test void migrationAndHibernateValidateActualJsonbMappingsAndUniqueEventIdentity() {
        assertEquals("29",jdbc.queryForObject("select version from flyway_schema_history where success order by installed_rank desc limit 1",String.class));
        assertEquals("array",jdbc.queryForObject("select jsonb_typeof(days) from tournament_rule where event_id=? and round_number=1",String.class,id));
        assertEquals(5,service.config(id).rounds().size());
        final ApiException error=assertThrows(ApiException.class,()->service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","FIRE_CUP",5,2,List.of("Day 1","Day 2"))));
        assertEquals(ApiErrorCode.TOURNAMENT_ALREADY_EXISTS,error.errorCode());
        service.create("admin",new TournamentDtos.CreateRequest(2026,"EU","FIRE_CUP",4,3,List.of("Day 1","Day 2","Day 3")));
        assertEquals(2,events.count());
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
        assertFalse(service.day(eventId,2,1).published()); assertTrue(service.day(eventId,1,1).historical());
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
        assertTrue(service.day(eventId,1,1).historical()); assertNull(service.day(eventId,1,1).expectedGroupCount());
        final TournamentDtos.DayView again=service.day(eventId,1,1);
        service.correction("admin",eventId,1,1,new TournamentDtos.CorrectionRequest(again.eventVersion(),again.version(),1,"fix again"));
        assertEquals(123,service.publicStandings(eventId).rows().getFirst().totalPoints());
        save(eventId,1,1,List.of(group(eventId,1,1,1,0,"A","C","B")),List.of());
        assertEquals(123,service.publicStandings(eventId).rows().getFirst().totalPoints()); publish(eventId,1,1,"correction");
        assertFalse(service.day(eventId,1,1).historical()); assertEquals(123,service.publicStandings(eventId).rows().getFirst().totalPoints());
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

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
    private long id;
    @BeforeEach void setup() {
        audits.deleteAll(); evidence.deleteAll(); days.deleteAll(); clans.deleteAll(); rules.deleteAll(); events.deleteAll();
        final TournamentDtos.Config config=service.create("admin",new TournamentDtos.CreateRequest(2026,"CN","FIRE_CUP",5,2,List.of("Day 1","Day 2"))); id=config.event().id();
        service.saveRules("admin",id,1,new TournamentDtos.RuleRequest(0,0,ruleDays(100)));
        service.expectedGroups(id,1,1,new TournamentDtos.ExpectedGroupsRequest(1,0,1));
    }
    @Test void migrationAndHibernateValidateActualJsonbMappingsAndUniqueEventIdentity() {
        assertEquals("28",jdbc.queryForObject("select version from flyway_schema_history where success order by installed_rank desc limit 1",String.class));
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

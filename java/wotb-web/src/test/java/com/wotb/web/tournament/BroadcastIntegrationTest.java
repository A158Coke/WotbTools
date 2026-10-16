package com.wotb.web.tournament;

import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.service.BroadcastCosStorage;
import com.wotb.web.tournament.service.BroadcastService;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Actual migrations, FK order, JSONB, and competing administrator transactions. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class BroadcastIntegrationTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("test-only");
    @DynamicPropertySource static void properties(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username",POSTGRES::getUsername); registry.add("spring.datasource.password",POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto",()->"validate"); registry.add("spring.flyway.enabled",()->"true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",()->"http://test-issuer");
        registry.add("keycloak.admin.server-url",()->"http://test-keycloak"); registry.add("keycloak.admin.realm",()->"test");
        registry.add("keycloak.admin.client-id",()->"test"); registry.add("keycloak.admin.client-secret",()->"test");
        registry.add("wotb.tournament.recognition-signing-key",()->"integration-only-32-byte-signing-secret");
    }
    @Autowired BroadcastService service;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean BroadcastCosStorage storage;
    private long seasonId;
    @BeforeEach void setup() {
        jdbc.update("delete from tournament_broadcast_replay"); jdbc.update("delete from tournament_broadcast_node");
        jdbc.update("delete from tournament_broadcast_category"); jdbc.update("delete from tournament_broadcast_cover");
        jdbc.update("delete from tournament_broadcast_season");
        when(storage.configured()).thenReturn(true);
        when(storage.key(anyString())).thenAnswer(invocation -> "league-broadcasts/covers/" + invocation.getArgument(0));
        seasonId = service.createSeason(new BroadcastDtos.SeasonCreate("LESTA",2026," Summer ",null)).season().id();
    }
    @Test void migrationValidatesIndependentFiveServerCatalogueAndDateOrdering() {
        assertEquals("33", jdbc.queryForObject("select version from flyway_schema_history where success order by installed_rank desc limit 1",String.class));
        assertEquals("Summer",service.season(seasonId).season().name());
        final long pointsEvents = jdbc.queryForObject("select count(*) from tournament_event",Long.class);
        final long dated = service.createSeason(new BroadcastDtos.SeasonCreate("LESTA",2026,"Dated",LocalDate.of(2026,7,1))).season().id();
        final long newer = service.createSeason(new BroadcastDtos.SeasonCreate("LESTA",2026,"Latest",LocalDate.of(2026,8,1))).season().id();
        final long undated = service.createSeason(new BroadcastDtos.SeasonCreate("LESTA",2027,"No date",null)).season().id();
        jdbc.update("update tournament_broadcast_season set created_at='2026-01-01T00:00:00Z' where id=?",seasonId);
        service.createSeason(new BroadcastDtos.SeasonCreate("CN",2026,"Dated",null));
        assertEquals(List.of(newer,dated,undated,seasonId),service.index("LESTA").seasons().stream().map(BroadcastDtos.Season::id).toList());
        assertEquals(List.of("CN","ASIA","NA","EU","LESTA"),service.index(null).servers());
        assertEquals(pointsEvents,jdbc.queryForObject("select count(*) from tournament_event",Long.class));
        assertEquals(0,service.index(null).seasons().size());
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.index("RU"));
    }
    @Test void explicitCategoriesAreReusedAndNodesEnforceFiveOneOneWithoutImplicitCreation() {
        assertTrue(service.season(seasonId).categories().isEmpty());
        final long points = category("POINTS");
        assertEquals(points,service.createCategory(seasonId,new BroadcastDtos.CategoryCreate(version(),"POINTS")).categories().getFirst().id());
        assertTrue(service.category(points).nodes().isEmpty());
        for (int round=1;round<=5;round++) { service.createNode(points,new BroadcastDtos.NodeCreate(version(),round,null)); }
        assertEquals(5,service.category(points).nodes().size());
        assertCode(ApiErrorCode.BROADCAST_NODE_CONFLICT,()->service.createNode(points,new BroadcastDtos.NodeCreate(version(),1,null)));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createNode(points,new BroadcastDtos.NodeCreate(version(),6,null)));
        final long quarters = category("QUARTER_FINALS");
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createNode(quarters,new BroadcastDtos.NodeCreate(version(),null,null)));
        final long quarterRoot = service.createNode(quarters,new BroadcastDtos.NodeCreate(version(),null,"ROUND_ROBIN")).nodes().getFirst().id();
        assertCode(ApiErrorCode.BROADCAST_NODE_CONFLICT,()->service.createNode(quarters,new BroadcastDtos.NodeCreate(version(),null,"KNOCKOUT")));
        final long semis = category("SEMI_FINALS");
        service.createNode(semis,new BroadcastDtos.NodeCreate(version(),null,null));
        assertCode(ApiErrorCode.BROADCAST_NODE_CONFLICT,()->service.createNode(semis,new BroadcastDtos.NodeCreate(version(),null,null)));
        service.deleteNode(quarterRoot,version(),true);
        assertTrue(service.category(quarters).nodes().isEmpty());
        assertEquals("KNOCKOUT",service.createNode(quarters,new BroadcastDtos.NodeCreate(version(),null,"KNOCKOUT")).nodes().getFirst().format());
    }
    @Test void replayFieldsFollowRootTypeAndSortOnlyByActualDate() {
        final long points = category("POINTS");
        final long root = service.createNode(points,new BroadcastDtos.NodeCreate(version(),5,null)).nodes().getFirst().id();
        service.createReplay(root,request("Later","2026-10-16",1,"Group 42",null,null,List.of("Followed","Two"),"KEEP"),null);
        service.createReplay(root,request("Earlier","2026-10-15",20,"Group twelve",null,null,List.of("Followed","Two","Three","Four"),"KEEP"),null);
        final List<BroadcastDtos.Replay> saved = service.category(points).nodes().getFirst().replays();
        assertEquals(List.of("Earlier","Later"),saved.stream().map(BroadcastDtos.Replay::title).toList());
        assertEquals(20,saved.getFirst().dayNumber()); assertEquals(5,service.category(points).nodes().getFirst().roundNumber());
        assertEquals("Followed",saved.getFirst().teams().getFirst()); assertEquals(4,saved.getFirst().teams().size());
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,request("Bad","2026-10-15",1,"Group",1,"DEFAULT",List.of("A","B"),"KEEP"),null));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,request("Bad","2026-10-15",1,"",null,null,List.of("A","B"),"KEEP"),null));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,request("Bad","2026-10-15",0,"Group",null,null,List.of("A","B"),"KEEP"),null));
        final BroadcastDtos.ReplaySave uppercase = new BroadcastDtos.ReplaySave(version(),"Uppercase scheme","HTTPS://example.org/video",
                LocalDate.of(2026,10,17),2,"A",null,null,List.of("A","B"),"POV","KEEP");
        assertEquals("HTTPS://example.org/video",service.createReplay(root,uppercase,null).nodes().getFirst().replays().getLast().url());
        final long semis = category("SEMI_FINALS");
        final long semiRoot = service.createNode(semis,new BroadcastDtos.NodeCreate(version(),null,null)).nodes().getFirst().id();
        service.createReplay(semiRoot,request("Final","2026-10-17",9,null,4,"LOSERS",List.of("A","B","C","D"),"KEEP"),null);
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(semiRoot,request("Bad","2026-10-17",9,null,5,"LOSERS",List.of("A","B"),"KEEP"),null));
        final long quarters = category("QUARTER_FINALS");
        final long quarterRoot = service.createNode(quarters,new BroadcastDtos.NodeCreate(version(),null,"ROUND_ROBIN")).nodes().getFirst().id();
        service.createReplay(quarterRoot,request("Round robin","2026-10-18",8,null,null,null,List.of("A","B"),"KEEP"),null);
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(quarterRoot,request("Bad","2026-10-18",8,null,1,"DEFAULT",List.of("A","B"),"KEEP"),null));
        service.deleteNode(quarterRoot,version(),true);
        final long knockoutRoot = service.createNode(quarters,new BroadcastDtos.NodeCreate(version(),null,"KNOCKOUT")).nodes().getFirst().id();
        service.createReplay(knockoutRoot,request("Knockout","2026-10-18",8,null,2,"WINNERS",List.of("A","B"),"KEEP"),null);
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(knockoutRoot,request("Bad","2026-10-18",8,"Group",null,null,List.of("A","B"),"KEEP"),null));
    }
    @Test void invalidReplayInputNeverUploadsOrCreatesPartialBusinessData() throws Exception {
        final long points = category("POINTS");
        final long root = service.createNode(points,new BroadcastDtos.NodeCreate(version(),1,null)).nodes().getFirst().id();
        final MockMultipartFile image = png();
        final BroadcastDtos.ReplaySave unsafe = new BroadcastDtos.ReplaySave(version(),"Title","javascript:alert(1)",
                LocalDate.of(2026,10,16),1,"A",null,null,List.of("A","B"),"POV","REPLACE");
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,unsafe,image));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,
                request("Title","2026-10-16",1,"A",null,null,List.of("A"," "),"KEEP"),null));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,
                request("Title","2026-10-16",1,"A",null,null,List.of("A"),"KEEP"),null));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.createReplay(root,
                request("Title","2026-10-16",1,"A",null,null,List.of("A","B"),"KEEP"),image));
        assertTrue(service.category(points).nodes().getFirst().replays().isEmpty());
        verify(storage,never()).put(anyString(),any());
    }
    @Test void deletionPreviewCannotAuthorizeChangesAddedAfterConfirmation() {
        final long points = category("POINTS");
        final long root = service.createNode(points,new BroadcastDtos.NodeCreate(version(),1,null)).nodes().getFirst().id();
        final BroadcastDtos.DeletionPreview stale = service.nodeDeletionPreview(root);
        service.createReplay(root,request("Replay","2026-10-16",1,"A",null,null,List.of("A","B"),"KEEP"),null);
        assertCode(ApiErrorCode.BROADCAST_VERSION_CONFLICT,()->service.deleteNode(root,stale.expectedVersion(),true));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.deleteSeason(seasonId,version(),false));
        final BroadcastDtos.DeletionPreview current = service.seasonDeletionPreview(seasonId);
        assertEquals(1,current.rootCount()); assertEquals(1,current.replayCount());
        service.deleteNode(root,version(),true);
        assertEquals(1,service.season(seasonId).categories().size()); assertTrue(service.category(points).nodes().isEmpty());
        service.deleteSeason(seasonId,version(),true);
        assertCode(ApiErrorCode.RESOURCE_NOT_FOUND,()->service.season(seasonId));
        assertEquals(0,jdbc.queryForObject("select count(*) from tournament_broadcast_category",Integer.class));
    }
    @Test void concurrentEditorsSerializeAndRejectTheStaleWriter() throws Exception {
        final long points = category("POINTS"); final long expected = version();
        final CountDownLatch ready = new CountDownLatch(2); final CountDownLatch start = new CountDownLatch(1);
        try (final var executor = Executors.newFixedThreadPool(2)) {
            final Callable<Boolean> write = () -> {
                ready.countDown(); assertTrue(start.await(10,TimeUnit.SECONDS));
                try { service.createNode(points,new BroadcastDtos.NodeCreate(expected,1,null)); return true; }
                catch (final ApiException error) { assertEquals(ApiErrorCode.BROADCAST_VERSION_CONFLICT,error.errorCode()); return false; }
            };
            final var first = executor.submit(write); final var second = executor.submit(write);
            assertTrue(ready.await(10,TimeUnit.SECONDS)); start.countDown();
            assertTrue(first.get(20,TimeUnit.SECONDS) ^ second.get(20,TimeUnit.SECONDS));
        }
        assertEquals(1,service.category(points).nodes().size());
    }
    @Test void failedReplacementKeepsOldReplayAndCoverAndSuccessfulRemovalRetainsCleanupMetadata() throws Exception {
        final long points = category("POINTS");
        final long root = service.createNode(points,new BroadcastDtos.NodeCreate(version(),1,null)).nodes().getFirst().id();
        final BroadcastDtos.Replay initial = service.createReplay(root,
                request("Original","2026-10-16",1,"A",null,null,List.of("A","B"),"REPLACE"),png()).nodes().getFirst().replays().getFirst();
        assertTrue(initial.coverId() != null);
        final MockMultipartFile replacement = png();
        doThrow(new ApiException(ApiErrorCode.BROADCAST_STORAGE_ERROR)).when(storage).put(anyString(),any());
        assertCode(ApiErrorCode.BROADCAST_STORAGE_ERROR,()->service.updateReplay(initial.id(),
                request("Changed","2026-10-16",1,"A",null,null,List.of("A","B"),"REPLACE"),replacement));
        final BroadcastDtos.Replay preserved = service.category(points).nodes().getFirst().replays().getFirst();
        assertEquals("Original",preserved.title()); assertEquals(initial.coverId(),preserved.coverId());
        final BroadcastDtos.Replay removed = service.updateReplay(initial.id(),
                request("Removed","2026-10-16",1,"A",null,null,List.of("A","B"),"REMOVE"),null).nodes().getFirst().replays().getFirst();
        assertNull(removed.coverId());
        assertTrue(jdbc.queryForObject("select unreferenced_at is not null from tournament_broadcast_cover where id=?",Boolean.class,initial.coverId()));
        service.deleteSeason(seasonId,version(),true);
        assertTrue(jdbc.queryForObject("select season_id is null from tournament_broadcast_cover where id=?",Boolean.class,initial.coverId()));
    }
    private long category(final String type) {
        return service.createCategory(seasonId,new BroadcastDtos.CategoryCreate(version(),type)).categories().stream()
                .filter(category -> category.type().equals(type)).findFirst().orElseThrow().id();
    }
    private long version() { return service.season(seasonId).season().version(); }
    private BroadcastDtos.ReplaySave request(final String title, final String date, final int day, final String group,
                                            final Integer number, final String bracket, final List<String> teams, final String action) {
        return new BroadcastDtos.ReplaySave(version(),title,"https://example.org/video",LocalDate.parse(date),day,group,number,bracket,teams,"POV",action);
    }
    private static void assertCode(final ApiErrorCode code, final Runnable operation) {
        assertEquals(code,assertThrows(ApiException.class,operation::run).errorCode());
    }
    private static MockMultipartFile png() throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(32,32,BufferedImage.TYPE_INT_RGB),"png",bytes);
        return new MockMultipartFile("cover","cover.png","image/png",bytes.toByteArray());
    }
}

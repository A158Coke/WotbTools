package com.wotb.web.tournament;

import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.tournament.entity.TournamentClan;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentDefaultRules;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
import com.wotb.web.tournament.repository.TournamentDefaultRulesRepository;
import com.wotb.web.tournament.repository.TournamentEventRepository;
import com.wotb.web.tournament.repository.TournamentEvidenceRepository;
import com.wotb.web.tournament.repository.TournamentRuleRepository;
import com.wotb.web.tournament.service.TournamentEvidenceStorage;
import com.wotb.web.tournament.service.TournamentService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.core.io.ClassPathResource;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verifyNoMoreInteractions;

class TournamentServiceTest {
    private static final String KEY = "unit-only-32-byte-signing-key-123456";
    private final TournamentDefaultRulesRepository defaults = mock(TournamentDefaultRulesRepository.class);
    private final TournamentEventRepository events = mock(TournamentEventRepository.class);
    private final TournamentRuleRepository rules = mock(TournamentRuleRepository.class);
    private final TournamentDayRepository days = mock(TournamentDayRepository.class);
    private final TournamentClanRepository clans = mock(TournamentClanRepository.class);
    private final TournamentEvidenceRepository evidence = mock(TournamentEvidenceRepository.class);
    private final TournamentAuditRepository audits = mock(TournamentAuditRepository.class);
    private final TournamentEvidenceStorage storage = mock(TournamentEvidenceStorage.class);
    private TournamentService service;
    private TournamentEvent event;
    private TournamentRule rule;
    private TournamentDay day;
    private final List<TournamentDay> dayRows = new ArrayList<>();
    private final List<TournamentClan> clanRows = new ArrayList<>();
    private final Map<String, TournamentEvidence> images = new HashMap<>();
    private final List<TournamentAudit> auditRows = new ArrayList<>();
    @BeforeEach void setup() {
        service = new TournamentService(events,rules,defaults,days,clans,evidence,audits,new TournamentMapper(),storage,KEY);
        final TournamentDefaultRules slot = new TournamentDefaultRules();
        when(defaults.findById(1L)).thenReturn(Optional.of(slot)); when(defaults.findLocked()).thenReturn(slot);
        event = new TournamentEvent(); event.ruleSource="CUSTOM"; event.id=1L; event.year=2026; event.region="CN"; event.season="FIRE_CUP";
        event.roundCount=5; event.daysPerRound=2; event.dayLabels=List.of("Day 1","Day 2");
        rule = new TournamentRule(); rule.eventId=1; rule.roundNumber=1; rule.rulesVersion=1; rule.days=ruleDays(false);
        day = new TournamentDay(); day.id=1L; day.eventId=1; day.roundNumber=1; day.dayNumber=1; day.expectedGroupCount=2;
        day.clearedClans=Set.of(); day.publicationKeys=Set.of(); dayRows.add(day);
        when(events.findById(1L)).thenAnswer(call->Optional.of(event)); when(events.findLocked(1L)).thenAnswer(call->Optional.of(event));
        when(events.findAllByOrderByYearDescIdDesc()).thenReturn(List.of(event));
        when(rules.findByEventIdAndRoundNumber(1L,1)).thenAnswer(call->Optional.of(rule));
        when(rules.findByEventIdOrderByRoundNumber(1L)).thenReturn(List.of(rule));
        when(days.findByEventIdOrderByRoundNumberAscDayNumberAsc(1L)).thenAnswer(call->List.copyOf(dayRows));
        when(days.findByEventIdAndRoundNumberAndDayNumber(anyLong(),anyInt(),anyInt())).thenAnswer(call -> dayRows.stream()
                .filter(row->row.roundNumber==(int)call.getArgument(1) && row.dayNumber==(int)call.getArgument(2)).findFirst());
        when(days.save(any())).thenAnswer(call->{ final TournamentDay row=call.getArgument(0); if(!dayRows.contains(row)){dayRows.add(row);} return row;});
        when(clans.findByEventIdOrderByClanTag(1L)).thenAnswer(call->List.copyOf(clanRows));
        when(clans.existsByEventIdAndClanTag(anyLong(),anyString())).thenAnswer(call->clanRows.stream().anyMatch(row->row.clanTag.equals(call.getArgument(1))));
        when(clans.save(any())).thenAnswer(call->{final TournamentClan row=call.getArgument(0);clanRows.add(row);return row;});
        when(evidence.findByIdAndEventId(anyString(),anyLong())).thenAnswer(call->Optional.ofNullable(images.get(call.getArgument(0))));
        when(evidence.findByEventId(anyLong())).thenAnswer(call->List.copyOf(images.values()));
        when(evidence.save(any())).thenAnswer(call->{final TournamentEvidence row=call.getArgument(0);images.put(row.id,row);return row;});
        when(audits.save(any())).thenAnswer(call->{final TournamentAudit row=call.getArgument(0);row.id=(long)auditRows.size()+1;auditRows.add(row);return row;});
        when(audits.findCsvImport(anyLong(),anyString())).thenAnswer(call->auditRows.stream()
                .filter(row->"CSV_IMPORTED".equals(row.action) && call.getArgument(1).equals(row.afterState.get("idempotencyKey"))).findFirst());
    }
    @Test void clanLengthMatchesUnicodeCharactersInTheWireContract() {
        final String tag = "😀".repeat(20);
        final TournamentDtos.DayView result = service.preview(1,1,1,
                request(List.of(group(1,"ERROR",tag,"B","C")),List.of(tag,"B","C")));
        assertEquals(tag, result.standings().rows().getFirst().clanTag());
        final String tooLong = "😀".repeat(33);
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.preview(1,1,1,
                request(List.of(group(1,"ERROR",tooLong,"B","C")),List.of(tooLong,"B","C"))));
    }
    @Test void previewIsPureAndDraftClansCannotLeakIntoPublicBoard() {
        final TournamentDtos.DraftRequest request=request(List.of(group(1,"ERROR","[REQM]","-KSR-","25时")),List.of("REQM","-KSR-","25时"));
        final TournamentDtos.DayView preview=service.preview(1,1,1,request);
        assertEquals(3,preview.standings().rows().size()); assertNull(day.draftGroups); assertEquals(0,event.version); assertTrue(clanRows.isEmpty());
        service.saveDraft(1,1,1,request); assertEquals(3,clanRows.size()); assertTrue(service.publicStandings(1).rows().isEmpty());
        assertEquals("REQM",service.day(1,1,1).standings().rows().getFirst().clanTag());
    }
    @Test void fullRoundGateBlocksIncompleteDayEvenWhenTargetDayIsReady() {
        rule.days=List.of(rule.days.getFirst());
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,()->service.preview(1,1,1,request(List.of(),List.of())));
    }
    @Test void fifthRankCannotDefaultToZero() {
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,()->service.preview(1,1,1,request(List.of(group(1,"ERROR","A","B","C","D","E")),List.of("A","B","C","D","E"))));
    }
    @Test void fifthRankUsesConfiguredPoints() {
        rule.days=ruleDays(true);
        final TournamentDtos.DayView preview=service.preview(1,1,1,request(List.of(group(1,"ERROR","A","B","C","D","E")),List.of("A","B","C","D","E")));
        assertEquals(5,preview.standings().rows().size()); assertEquals(5,preview.standings().rows().getLast().totalPoints());
    }
    @Test void newClansRequireExplicitConfirmation() {
        assertCode(ApiErrorCode.TOURNAMENT_NEW_CLAN_CONFIRMATION_REQUIRED,()->service.preview(1,1,1,request(List.of(group(1,"ERROR","A","B","C")),List.of("A","B"))));
    }
    @Test void sameClanInDifferentGroupsIsConflict() {
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT,()->service.preview(1,1,1,request(List.of(group(1,"ERROR","A","B","C"),group(2,"ERROR","A","D","E")),List.of("A","B","C","D","E"))));
    }
    @Test void duplicateGroupRequiresActionReplacementDoesNotAccumulate() {
        service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","B","C")),List.of("A","B","C")));
        final TournamentDtos.IncomingGroup replacement=group(1,"ERROR","C","B","A");
        assertCode(ApiErrorCode.TOURNAMENT_DUPLICATE_GROUP,()->service.preview(1,1,1,request(List.of(replacement),List.of())));
        final TournamentDtos.IncomingGroup skip=new TournamentDtos.IncomingGroup(1,replacement.evidenceId(),replacement.imageHash(),replacement.teams(),"SKIP",true);
        assertEquals("A",service.preview(1,1,1,request(List.of(skip),List.of())).standings().rows().getFirst().clanTag());
        final TournamentDtos.IncomingGroup replace=new TournamentDtos.IncomingGroup(1,replacement.evidenceId(),replacement.imageHash(),replacement.teams(),"REPLACE",true);
        final TournamentDtos.DayView result=service.saveDraft(1,1,1,request(List.of(replace),List.of()));
        assertEquals(1,result.groups().size()); assertEquals("C",result.standings().rows().getFirst().clanTag()); assertEquals(100,result.standings().rows().getFirst().totalPoints());
    }
    @Test void competitionRankAndNullMissingDaysUsePublishedDataOnly() {
        service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","B","C"),group(2,"ERROR","D","E","F")),List.of("A","B","C","D","E","F")));
        publish("once");
        final List<TournamentDtos.StandingRow> rows=service.publicStandings(1).rows();
        assertEquals(List.of(1,1,3,3,5,5),rows.stream().map(TournamentDtos.StandingRow::rank).toList());
        assertNull(rows.getFirst().rounds().getFirst().days().getLast().points()); assertEquals(10,service.publicStandings(1).days().size());
    }
    @Test void finalizationChecksExactGroupCountAndBecomesImmutableIdempotently() {
        service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","B","C")),List.of("A","B","C")));
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH,()->publish("once"));
        day.expectedGroupCount=1; final TournamentDtos.FinalizeRequest first=new TournamentDtos.FinalizeRequest(event.version,day.version,1,"once");
        service.finalizeDay("admin",1,1,1,first); final long version=event.version;
        service.finalizeDay("admin",1,1,1,first); assertEquals(version,event.version); assertEquals(1,auditRows.size());
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.saveDraft(1,1,1,request(List.of(),List.of())));
    }
    @Test void staleEventAndRulesVersionsCannotOverwrite() {
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,()->service.preview(1,1,1,new TournamentDtos.DraftRequest(9,0,1,List.of(),List.of())));
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,()->service.preview(1,1,1,new TournamentDtos.DraftRequest(0,0,9,List.of(),List.of())));
    }
    @Test void publishedRoundRulesAndStructureAreLockedButNamesRemainEditable() {
        day.expectedGroupCount=1; service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","B","C")),List.of("A","B","C"))); publish("once");
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.saveRules("admin",1,1,new TournamentDtos.RuleRequest(event.version,1,List.of())));
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.update("admin",1,new TournamentDtos.UpdateRequest(event.version,2026,"CN","FIRE_CUP",4,2,List.of("Day 1","Day 2"))));
        service.update("admin",1,new TournamentDtos.UpdateRequest(event.version,2026,"CN","FIRE_CUP",5,2,List.of("Group stage","Finals")));
        assertEquals("Finals",service.publicStandings(1).days().get(1).label());
    }
    @Test void correctionKeepsOldPublicSnapshotRequiresFreshEvidenceAndPreservesClear() {
        day.expectedGroupCount=1; final TournamentDtos.IncomingGroup original=group(1,"ERROR","A","B","C");
        images.get(original.evidenceId()).createdAt=Instant.now().minusSeconds(1);
        service.saveDraft(1,1,1,request(List.of(original),List.of("A","B","C"))); publish("once");
        service.clearPoints("admin",1,new TournamentDtos.ClearRequest(event.version,1,1,"A","violation",false));
        service.correction("admin",1,1,1,new TournamentDtos.CorrectionRequest(event.version,day.version,1,"missing data"));
        assertEquals(3,service.publicStandings(1).rows().size());
        assertCode(ApiErrorCode.TOURNAMENT_EVIDENCE_INVALID,()->service.preview(1,1,1,request(List.of(original),List.of())));
        service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","C","B")),List.of())); publish("twice");
        assertEquals(0,service.publicStandings(1).rows().stream().filter(row->row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertFalse(day.correction); assertEquals("CORRECTION_PUBLISHED",auditRows.getLast().action);
        service.clearPoints("admin",1,new TournamentDtos.ClearRequest(event.version,1,1,"A","appeal upheld",true));
        assertEquals(100,service.publicStandings(1).rows().getFirst().totalPoints());
    }
    @Test void unpublishedClanCannotBeExposedByClearingAnUnrelatedPublishedDay() {
        day.expectedGroupCount=1; service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","B","C")),List.of("A","B","C"))); publish("once");
        final TournamentClan draftOnly = new TournamentClan(); draftOnly.eventId=1; draftOnly.clanTag="draft-only"; clanRows.add(draftOnly);
        assertCode(ApiErrorCode.RESOURCE_NOT_FOUND,()->service.clearPoints("admin",1,new TournamentDtos.ClearRequest(event.version,1,1,"draft-only","wrong day",false)));
        assertEquals(3,service.publicStandings(1).rows().size());
    }
    @Test void permitBindsUserImageDimensionsAndPositiveRulesVersion() throws Exception {
        final MockMultipartFile file=new MockMultipartFile("image","group.png","image/png",new byte[]{1});
        when(storage.validate(file)).thenReturn(new TournamentEvidenceStorage.Image(new byte[]{1},"a".repeat(64),"image/png"));
        final TournamentDtos.RecognitionPermit permit=service.recognitionPermit("admin-sub",1,1,1,0,0,1,file);
        final SignedJWT jwt=SignedJWT.parse(permit.permit()); assertTrue(jwt.verify(new MACVerifier(KEY.getBytes(java.nio.charset.StandardCharsets.UTF_8))));
        assertEquals("admin-sub",jwt.getJWTClaimsSet().getSubject()); assertEquals("wotbtools-tournament",jwt.getJWTClaimsSet().getIssuer());
        assertEquals(List.of("tournament-recognition"),jwt.getJWTClaimsSet().getAudience()); assertEquals("a".repeat(64),jwt.getJWTClaimsSet().getStringClaim("image_hash"));
        assertEquals(1,jwt.getJWTClaimsSet().getLongClaim("rules_version")); assertEquals(300000,jwt.getJWTClaimsSet().getExpirationTime().getTime()-jwt.getJWTClaimsSet().getIssueTime().getTime());
    }
    @Test void historicalPreviewAndImportPreserveNullAndZeroWithoutRulesOrDraftDisclosure() {
        rule.days=List.of(); rule.rulesVersion=0;
        final TournamentClan hidden=new TournamentClan(); hidden.eventId=1; hidden.clanTag="hidden-draft-only"; clanRows.add(hidden);
        final List<TournamentDtos.HistoricalRow> input=List.of(historicalRow("[REQM]",100,null),historicalRow("-KSR-",null,100),historicalRow("零分",0,0),historicalRow("缺席"));
        final TournamentDtos.HistoricalPreview preview=service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"summer.png","a".repeat(64),input));
        assertEquals(4,preview.clanCount()); assertEquals(36,preview.missingCellCount()); assertEquals(List.of(1,1,3,3),preview.standings().rows().stream().map(TournamentDtos.StandingRow::rank).toList());
        assertTrue(service.publicStandings(1).rows().isEmpty()); assertEquals(0,event.version); assertNull(day.publishedHistoricalPoints);
        final TournamentDtos.HistoricalPreview result=service.importHistorical("admin",1,historicalRequest(input,"first"));
        assertEquals(4,result.standings().rows().size()); assertEquals(1,event.version); assertTrue(event.configLocked);
        assertEquals(4,service.publicStandings(1).rows().size()); assertFalse(service.publicStandings(1).rows().stream().anyMatch(row->row.clanTag().equals("hidden-draft-only")));
        final TournamentDtos.StandingRow absent=service.publicStandings(1).rows().stream().filter(row->row.clanTag().equals("缺席")).findFirst().orElseThrow();
        assertEquals(0,absent.totalPoints()); assertNull(absent.rounds().getFirst().days().getFirst().points());
        assertEquals("FINALIZED",service.day(1,1,1).status()); assertTrue(service.historicalState(1,1,1).historical()); assertTrue(service.day(1,1,1).groups().isEmpty());
        assertFalse(service.publicStandings(1).days().get(2).published()); assertEquals("a".repeat(64),auditRows.getLast().afterState.get("sourceSha256"));
    }
    @Test void historicalRowsMergeAcrossDaysButAnyOverlappingNonNullCellIsConflict() {
        final List<TournamentDtos.HistoricalRow> input=List.of(historicalRow("A",100,null),historicalRow("[A]",null,50));
        final TournamentDtos.HistoricalPreview result=service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),input));
        assertEquals(2,result.sourceRowCount()); assertEquals(1,result.clanCount()); assertEquals(8,result.missingCellCount()); assertEquals(150,result.standings().rows().getFirst().totalPoints());
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),List.of(historicalRow("A",0),historicalRow("A",0)))));
        assertTrue(auditRows.isEmpty()); assertEquals(0,event.version);
    }
    @Test void allNullRosterCommitClosesImportGateWithoutMarkingDaysPublished() {
        assertTrue(service.historicalState(1,1,1).canImport());
        service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("缺席")),"roster-only"));
        final TournamentDtos.HistoricalState state=service.historicalState(1,1,1);
        assertTrue(state.imported()); assertFalse(state.canImport()); assertFalse(state.historical());
        assertEquals(1,state.eventVersion()); assertEquals("EMPTY",service.day(1,1,1).status());
        assertFalse(service.day(1,1,1).published());
        assertEquals(0,service.publicStandings(1).rows().getFirst().totalPoints());
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(event.version,"source","a".repeat(64),List.of(historicalRow("缺席")))));
    }
    @Test void historicalSourceNameLengthUsesUnicodeCodePoints() {
        final List<TournamentDtos.HistoricalRow> input=List.of(historicalRow("A",100));
        final String maximum="😀".repeat(200);
        assertEquals(1,service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,maximum,"a".repeat(64),input)).clanCount());
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,maximum+"😀","a".repeat(64),input)));
        assertTrue(auditRows.isEmpty()); assertEquals(0,event.version);
    }
    @Test void historicalValidationRejectsDimensionsBoundsSourceTotalsAndSourceIdentity() {
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),List.of(new TournamentDtos.HistoricalRow("A",List.of(1,2),3)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),List.of(historicalRow("A",-1)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),List.of(historicalRow("A",1000001)))));
        final TournamentDtos.HistoricalRow valid=historicalRow("A",100);
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),List.of(new TournamentDtos.HistoricalRow("A",valid.points(),99)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","wrong",List.of(valid))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source\nname","a".repeat(64),List.of(valid))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(0,"source","a".repeat(64),List.of())));
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,()->service.previewHistorical(1,new TournamentDtos.HistoricalPreviewRequest(99,"source","a".repeat(64),List.of(valid))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,()->service.importHistorical("admin",1,new TournamentDtos.HistoricalImportRequest(0,"source","a".repeat(64),List.of(valid),false,"key")));
        assertTrue(clanRows.isEmpty()); assertTrue(auditRows.isEmpty());
    }
    @Test void historicalImportIsOneTimeAndExactRetryIsIdempotent() {
        final TournamentDtos.HistoricalImportRequest request=historicalRequest(List.of(historicalRow("A",100)),"same-key");
        service.importHistorical("admin",1,request); final long version=event.version;
        service.importHistorical("admin",1,request); assertEquals(version,event.version); assertEquals(1,auditRows.size()); assertEquals(1,clanRows.size());
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("A",101)),"same-key")));
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("A",100)),"different-key")));
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.expectedGroups(1,1,1,new TournamentDtos.ExpectedGroupsRequest(event.version,day.version,1)));
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.saveDraft(1,1,1,request(List.of(),List.of())));
    }
    @Test void historicalImportCannotOverwriteDraftOrFinalizedGroups() {
        service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","B","C")),List.of("A","B","C")));
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("X",100)),"import")));
        day.expectedGroupCount=1; publish("first");
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("X",100)),"import")));
        assertEquals(3,service.publicStandings(1).rows().size());
    }
    @Test void incompleteHistoricalRulesCanOnlyBeCompletedOnceAndDoNotRecalculateScores() {
        rule.days=List.of(); rule.rulesVersion=0;
        service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("A",999)),"import"));
        assertFalse(service.config(1).rounds().getFirst().locked());
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,()->service.saveRules("admin",1,1,new TournamentDtos.RuleRequest(event.version,0,List.of())));
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,()->service.correction("admin",1,1,1,new TournamentDtos.CorrectionRequest(event.version,day.version,1,"fix")));
        final List<TournamentDtos.RuleDay> configured=ruleDays(false).stream().map(value->new TournamentDtos.RuleDay(value.dayNumber(),value.points().stream().map(point->new TournamentDtos.RankPoints(point.rank(),point.points())).toList())).toList();
        service.saveRules("admin",1,1,new TournamentDtos.RuleRequest(event.version,0,configured));
        assertTrue(service.config(1).rounds().getFirst().locked()); assertEquals(999,service.publicStandings(1).rows().getFirst().totalPoints());
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,()->service.saveRules("admin",1,1,new TournamentDtos.RuleRequest(event.version,1,configured)));
    }
    @Test void historicalCorrectionAndSanctionsUseExistingPublicationAndRestoreSemantics() {
        service.importHistorical("admin",1,historicalRequest(List.of(historicalRow("A",999,123),historicalRow("B",50,25),historicalRow("C",25,10)),"import"));
        service.clearPoints("admin",1,new TournamentDtos.ClearRequest(event.version,1,1,"A","violation",false));
        assertEquals(123,service.publicStandings(1).rows().getFirst().totalPoints());
        service.correction("admin",1,1,1,new TournamentDtos.CorrectionRequest(event.version,day.version,1,"correct day"));
        assertEquals(123,service.publicStandings(1).rows().getFirst().totalPoints());
        service.saveDraft(1,1,1,request(List.of(group(1,"ERROR","A","C","B")),List.of())); publish("replacement");
        assertNull(day.publishedHistoricalPoints); assertFalse(service.historicalState(1,1,1).historical()); assertEquals(123,service.publicStandings(1).rows().getFirst().totalPoints());
        assertEquals(999,((Map<?,?>)auditRows.getLast().beforeState.get("historicalPoints")).get("A"));
        service.clearPoints("admin",1,new TournamentDtos.ClearRequest(event.version,1,1,"A","appeal",true));
        assertEquals(223,service.publicStandings(1).rows().getFirst().totalPoints());
    }
    private TournamentDtos.HistoricalImportRequest historicalRequest(final List<TournamentDtos.HistoricalRow> input, final String key) {
        return new TournamentDtos.HistoricalImportRequest(event.version,"source.png","a".repeat(64),input,true,key);
    }
    @Test void csvActualFullFixturePreviewIsPureAndUsesTheSharedRanker() throws Exception {
        final byte[] bytes = new ClassPathResource("tournament/2026-fire-cup-standings.csv").getContentAsByteArray();
        final var preview = service.previewCsv(1, 0, new MockMultipartFile("file", "2026战火杯积分榜.csv", "text/csv", bytes));
        assertEquals(11577, bytes.length); assertEquals("103539aaf50f3650b375a446d6e09b41acebf1eda9a1aec93cbe2a616b7f52fe", preview.sourceSha256());
        assertEquals(200, preview.sourceRowCount()); assertEquals(200, preview.clanCount()); assertEquals(1800, preview.missingCellCount());
        assertEquals(206408, preview.standings().rows().stream().mapToLong(TournamentDtos.StandingRow::totalPoints).sum());
        assertEquals(List.of(1, 50, 99, 125), preview.standings().rows().stream().map(TournamentDtos.StandingRow::rank).distinct().toList());
        assertEquals(200, preview.changes().addedClans()); assertEquals(200, preview.changes().addedScores());
        assertTrue(clanRows.isEmpty()); assertTrue(auditRows.isEmpty()); assertFalse(event.csvImported);
    }
    @Test void auditListReadsOnlyMetadataAndPreservesTheExistingResponseShape() {
        final var created = Instant.parse("2026-10-16T15:00:00Z");
        when(audits.findMetadataByEventId(1L)).thenReturn(List.of(new TournamentAudit.Metadata(7L, "CSV_IMPORTED", "admin", null, null, null, created)));
        final var result = service.auditList(1);
        assertEquals(1, result.size()); assertEquals(7L, result.getFirst().id());
        assertEquals("CSV_IMPORTED", result.getFirst().action()); assertEquals(created, result.getFirst().createdAt());
        assertTrue(result.getFirst().before().isEmpty()); assertTrue(result.getFirst().after().isEmpty());
        verify(audits).findMetadataByEventId(1L); verifyNoMoreInteractions(audits);
    }
    @Test void orphanSweepAndDraftDiscardReadOnlyProjectedAuditEvidenceIds() {
        final var retained = group(1, "ERROR", "A", "B", "C"); final var orphan = group(2, "ERROR", "D", "E", "F");
        images.values().forEach(image -> image.createdAt = Instant.now().minusSeconds(90000));
        when(audits.findEvidenceIdsByEventId(1L)).thenReturn(List.of(retained.evidenceId()));
        service.cleanupOrphans();
        verify(evidence).delete(images.get(orphan.evidenceId())); verify(evidence, never()).delete(images.get(retained.evidenceId()));
        verify(storage).cleanup(anyLong(), eq(Set.of(retained.imageHash())), any(Instant.class));
        day.draftGroups = List.of(); service.deleteDraft(1, 1, 1, new TournamentDtos.Versions(event.version, day.version));
        verify(evidence, times(2)).delete(images.get(orphan.evidenceId()));
        verify(audits, times(2)).findEvidenceIdsByEventId(1L); verifyNoMoreInteractions(audits);
    }
    @Test void csvPreviewKeepsClearedBlankCellsMissingAndCountsTheirRemoval() {
        day.publishedHistoricalPoints = Map.of("A", 100, "B", 50); day.clearedClans = Set.of("A");
        final var blank = service.previewCsv(1, 0, csv(csvText("A", "", "", "0") + "B,5,,,,,,,,,,5\n"));
        final var missing = blank.standings().rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow();
        assertNull(missing.rounds().getFirst().days().getFirst().points()); assertEquals(0, missing.totalPoints());
        assertEquals(1, blank.changes().removedScores()); assertEquals(1, blank.changes().changedScores()); assertEquals(1, blank.changes().preservedClears());
        final var zero = service.previewCsv(1, 0, csv(csvText("A", "0", "", "0") + "B,5,,,,,,,,,,5\n"));
        assertEquals(0L, zero.standings().rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().rounds().getFirst().days().getFirst().points());
        assertEquals(0, zero.changes().removedScores()); assertEquals(Set.of("A"), day.clearedClans);
    }
    @Test void csvEmptyDayDoesNotCreateZeroFromAPreservedSanction() {
        day.publishedHistoricalPoints = Map.of("A", 100); day.clearedClans = Set.of("A"); event.csvImported = true;
        final var preview = service.previewCsv(1, 0, csv(csvText("A", "", "", "0")));
        assertTrue(preview.standings().rows().getFirst().rounds().getFirst().days().stream().allMatch(value -> value.points() == null));
        assertFalse(preview.standings().days().getFirst().published()); assertEquals(1, preview.changes().removedScores());
        assertEquals(1, preview.changes().preservedClears()); assertEquals(Set.of("A"), day.clearedClans);
    }
    @Test void screenshotProjectionRetainsItsExistingExplicitSanctionBehaviorAfterCsvUse() {
        event.csvImported = true; final TournamentClan cleared = new TournamentClan();
        cleared.eventId = 1; cleared.clanTag = "A"; cleared.historicalPublished = true; clanRows.add(cleared); day.clearedClans = Set.of("A");
        day.publishedGroups = List.of(new TournamentSnapshot.Group(1, "evidence", "a".repeat(64),
                List.of(new TournamentSnapshot.Team("B", 1), new TournamentSnapshot.Team("C", 2), new TournamentSnapshot.Team("D", 3))));
        assertEquals(0L, service.publicStandings(1).rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().rounds().getFirst().days().getFirst().points());
    }
    @Test void csvRfcQuotesChineseTagsBomAndReorderedHeadersKeepNullAndZeroDistinct() {
        final String header = "总积分,R1D2,军团标签,R1D1,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2,R5D1,R5D2\r\n";
        final var preview = service.previewCsv(1, 0, csv("\ufeff" + header + "7,0,\"军团,\"\"甲\"\"\",7,,,,,,,,\r\n"));
        final var row = preview.standings().rows().getFirst();
        assertEquals("军团,\"甲\"", row.clanTag()); assertEquals(7, row.totalPoints());
        assertEquals(0L, row.rounds().getFirst().days().getLast().points()); assertNull(row.rounds().get(1).days().getFirst().points());
    }
    @Test void csvRejectsBadHeadersEncodingNumbersAndTotalsWithLocation() {
        final String good = csvText("A", "1", "", "1");
        for (final String bad : List.of(good.replace("R5D2", "R5D1"), good.replace("R5D2", "R9D9"),
                good.replace("军团标签", ""), good.replace("A,1,", "\"A,1,"),
                good.replace("A,1,", "A,-1,"), good.replace("A,1,", "A,1.5,"), good.replace("A,1,", "A,1000001,"),
                good.replace("A,1,", ",1,"), good.replace(",1\n", ",2\n"), good + "A,1\n")) {
            final var error = assertThrows(ApiException.class, () -> service.previewCsv(1, 0, csv(bad)));
            assertEquals(ApiErrorCode.TOURNAMENT_CSV_INVALID, error.errorCode());
            assertTrue(error.details().containsKey("rowNumber")); assertTrue(error.details().containsKey("column")); assertTrue(error.details().containsKey("reason"));
        }
        assertCode(ApiErrorCode.TOURNAMENT_CSV_INVALID, () -> service.previewCsv(1, 0, new MockMultipartFile("file", "x.csv", "text/csv", new byte[]{(byte) 0xff})));
        assertCode(ApiErrorCode.TOURNAMENT_CSV_INVALID, () -> service.previewCsv(1, 0, csv("")));
        assertCode(ApiErrorCode.FILE_TOO_LARGE, () -> service.previewCsv(1, 0, new MockMultipartFile("file", "x.csv", "text/csv", new byte[2 * 1024 * 1024 + 1])));
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_CONFLICT, () -> service.previewCsv(1, 0, csv(good + "A,1,,,,,,,,,,1\n")));
        assertFalse(event.csvImported); assertTrue(auditRows.isEmpty());
    }
    @Test void csvBlankLinesQuotedReferenceNewlinesAndRowLimitUseTheRealParser() {
        final String header = csvText("A", "1", "", "1").lines().findFirst().orElseThrow();
        final String body = csvText("A", "1", "", "1").lines().skip(1).findFirst().orElseThrow();
        final var preview = service.previewCsv(1, 0, csv("积分排名," + header + "\n\n\"reference\nonly\"," + body + "\n"));
        assertEquals(1, preview.sourceRowCount()); assertEquals(1, preview.standings().rows().getFirst().totalPoints());
        assertCode(ApiErrorCode.TOURNAMENT_CSV_INVALID, () -> service.previewCsv(1, 0, csv(header + "\n" + (body + "\n").repeat(10001))));
        event.daysPerRound = 3;
        assertCode(ApiErrorCode.TOURNAMENT_CSV_INVALID, () -> service.previewCsv(1, 0, csv(header + "\n" + body + "\n")));
    }
    @Test void csvNullRosterStillBlocksOneTimeJsonAndAttributionRemainsAfterClearingFacts() {
        final var file = csv(csvText("A", "", "", "0")); final var preview = service.previewCsv(1, 0, file);
        service.importCsv("admin", 1, 0, file, preview.sourceSha256(), true, "csv");
        assertTrue(service.dataSource(1).csvImported()); assertEquals("_EK_", service.dataSource(1).attribution().name());
        assertEquals("https://b23.tv/rqx5iYX", service.dataSource(1).attribution().url());
        assertFalse(service.historicalState(1, 1, 1).canImport()); assertNull(event.historicalImportKey);
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED, () -> service.importHistorical("admin", 1, historicalRequest(List.of(historicalRow("B", 10)), "json")));
        assertTrue(service.dataSource(1).csvImported());
    }
    @Test void csvRejectsBusyWorkspaceAndNeverMarksFailedImport() {
        final var file = csv(csvText("A", "1", "", "1")); final var preview = service.previewCsv(1, 0, file);
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, () -> service.importCsv("admin", 1, 0, file, "a".repeat(64), true, "csv"));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.importCsv("admin", 1, 0, file, preview.sourceSha256(), false, "csv"));
        day.draftGroups = List.of();
        assertCode(ApiErrorCode.TOURNAMENT_CSV_WORKSPACE_BUSY, () -> service.previewCsv(1, 0, file));
        assertCode(ApiErrorCode.TOURNAMENT_CSV_WORKSPACE_BUSY, () -> service.importCsv("admin", 1, 0, file, preview.sourceSha256(), true, "csv"));
        day.draftGroups = null; day.correction = true;
        assertCode(ApiErrorCode.TOURNAMENT_CSV_WORKSPACE_BUSY, () -> service.previewCsv(1, 0, file));
        assertFalse(event.csvImported); assertTrue(auditRows.isEmpty());
    }
    @Test void sanctionedClansAreHiddenFromThePublicBoardButVisibleInTheCanonicalSnapshot() {
        day.expectedGroupCount = 1;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        publish("once");
        service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(event.version, 1, 1, "A", "violation", false));
        final List<TournamentDtos.StandingRow> board = service.publicStandings(1).rows();
        assertEquals(0, board.stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertEquals(50, board.stream().filter(row -> row.clanTag().equals("B")).findFirst().orElseThrow().totalPoints());
        final TournamentDtos.Standings canonical = service.day(1, 1, 1, true).canonicalStandings();
        assertEquals(100, canonical.rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertEquals(3, canonical.rows().size());
    }

    @Test void sanctionedHistoricalPointsStayVisibleOnlyInTheCanonicalSnapshot() {
        service.importHistorical("admin", 1, historicalRequest(List.of(historicalRow("A", 100)), "import"));
        service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(event.version, 1, 1, "A", "violation", false));
        assertEquals(0, service.publicStandings(1).rows().getFirst().totalPoints());
        assertEquals(100, service.day(1, 1, 1, true).canonicalStandings().rows().getFirst().totalPoints());
    }

    @Test void finalizeRejectsStaleEventOrDayVersionsAndBadIdempotencyKeysWithoutPublishing() {
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        final long eventVersion = event.version; final long dayVersion = day.version;
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.finalizeDay("admin", 1, 1, 1, new TournamentDtos.FinalizeRequest(eventVersion - 1, dayVersion, 1, "key")));
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.finalizeDay("admin", 1, 1, 1, new TournamentDtos.FinalizeRequest(eventVersion, dayVersion - 1, 1, "key")));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.finalizeDay("admin", 1, 1, 1, new TournamentDtos.FinalizeRequest(eventVersion, dayVersion, 1, "k".repeat(65))));
        assertNull(day.publishedGroups); assertEquals(eventVersion, event.version); assertEquals(dayVersion, day.version);
        assertTrue(auditRows.isEmpty());
        day.expectedGroupCount = 1;
        service.finalizeDay("admin", 1, 1, 1, new TournamentDtos.FinalizeRequest(eventVersion, dayVersion, 1, "valid"));
        assertNotNull(day.publishedGroups);
        assertEquals(eventVersion + 1, event.version); assertEquals(dayVersion + 1, day.version);
    }

    @Test void finalizeRequiresADeclaredGroupCountEvenWhenTheDraftMatches() {
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        day.expectedGroupCount = null;
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH,
                () -> service.finalizeDay("admin", 1, 1, 1, new TournamentDtos.FinalizeRequest(event.version, day.version, 1, "key")));
        assertNull(day.publishedGroups);
    }

    @Test void draftWritesRejectStaleDayVersionsWithoutSideEffects() {
        day.expectedGroupCount = null;
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.expectedGroups(1, 1, 1, new TournamentDtos.ExpectedGroupsRequest(event.version, day.version + 1, 1)));
        assertNull(day.expectedGroupCount); assertEquals(0, event.version);
        final TournamentDtos.DraftRequest stale = new TournamentDtos.DraftRequest(event.version, day.version + 1, 1,
                List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C"));
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, () -> service.saveDraft(1, 1, 1, stale));
        assertNull(day.draftGroups); assertTrue(clanRows.isEmpty());
    }

    @Test void historicalImportLandsEachCellOnItsConfiguredRoundAndDay() {
        final List<TournamentDtos.HistoricalRow> input = List.of(historicalRow("A", 100, null, 50));
        final TournamentDtos.HistoricalPreview result = service.importHistorical("admin", 1, historicalRequest(input, "import"));
        final TournamentDtos.StandingRow row = result.standings().rows().getFirst();
        assertEquals(150, row.totalPoints());
        assertEquals(100L, row.rounds().get(0).days().get(0).points());
        assertNull(row.rounds().get(0).days().get(1).points());
        assertEquals(50L, row.rounds().get(1).days().get(0).points());
        assertNull(row.rounds().get(1).days().get(1).points());
        assertTrue(service.publicStandings(1).days().get(0).published());
        assertFalse(service.publicStandings(1).days().get(1).published());
        assertTrue(service.publicStandings(1).days().get(2).published());
        assertFalse(service.publicStandings(1).days().get(3).published());
    }

    @Test void historicalImportRejectsStaleEventVersionsWithoutWritingAnything() {
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT, () -> service.importHistorical("admin", 1,
                new TournamentDtos.HistoricalImportRequest(event.version + 1, "source.png", "a".repeat(64), List.of(historicalRow("A", 100)), true, "import")));
        assertNull(event.historicalImportKey); assertTrue(clanRows.isEmpty()); assertEquals(1, dayRows.size()); assertEquals(0, event.version);
        assertNull(day.publishedHistoricalPoints);
    }

    @Test void historicalImportAcceptsTheMaximumCellScoreAndBoundaryIdempotencyKeys() {
        assertEquals(1_000_000, service.previewHistorical(1,
                new TournamentDtos.HistoricalPreviewRequest(0, "source", "a".repeat(64), List.of(historicalRow("A", 1_000_000))))
                .standings().rows().getFirst().totalPoints());
        service.importHistorical("admin", 1, new TournamentDtos.HistoricalImportRequest(event.version, "source",
                "a".repeat(64), List.of(historicalRow("A", 100)), true, "k".repeat(64)));
        assertEquals("k".repeat(64), event.historicalImportKey);
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.importHistorical("admin", 1,
                new TournamentDtos.HistoricalImportRequest(event.version, "source", "a".repeat(64), List.of(historicalRow("A", 100)), true, "k".repeat(65))));
    }

    @Test void csvImportRejectsStaleVersionsAndOversizedIdempotencyKeysBeforeAnyWrite() {
        final var file = csv(csvText("A", "7", "", "7")); final var preview = service.previewCsv(1, 0, file);
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.importCsv("admin", 1, event.version + 1, file, preview.sourceSha256(), true, "csv"));
        assertFalse(event.csvImported); assertTrue(auditRows.isEmpty()); assertNull(day.publishedHistoricalPoints);
        service.importCsv("admin", 1, event.version, file, preview.sourceSha256(), true, "k".repeat(64));
        assertTrue(event.csvImported); assertEquals("k".repeat(64), auditRows.getFirst().afterState.get("idempotencyKey"));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.importCsv("admin", 1, event.version, file, preview.sourceSha256(), true, "k".repeat(65)));
        assertEquals("FROZEN", event.ruleSource);
    }

    @Test void csvImportReplacesAPublishedHistoricalDayAndPreservesSanctions() {
        final TournamentClan sanctioned = new TournamentClan(); sanctioned.eventId = 1; sanctioned.clanTag = "A"; sanctioned.historicalPublished = true;
        clanRows.add(sanctioned);
        final TournamentClan departed = new TournamentClan(); departed.eventId = 1; departed.clanTag = "GONE"; departed.historicalPublished = true;
        clanRows.add(departed);
        day.publishedHistoricalPoints = Map.of("A", 100, "B", 50); day.clearedClans = Set.of("A"); day.expectedGroupCount = 2;
        final long eventVersion = event.version; final long dayVersion = day.version;
        final var file = csv(csvText("A", "", "", "0") + "B,5,,,,,,,,,,5\n");
        final var preview = service.previewCsv(1, 0, file);
        service.importCsv("admin", 1, eventVersion, file, preview.sourceSha256(), true, "csv-import");
        assertEquals(Map.of("B", 5), day.publishedHistoricalPoints);
        assertNull(day.expectedGroupCount);
        assertEquals(eventVersion + 1, event.version); assertEquals(dayVersion + 1, day.version);
        assertTrue(event.csvImported); assertTrue(event.configLocked);
        assertEquals(Set.of("A"), day.clearedClans);
        // A stays published (still present in the source with blank cells); a clan absent from the
        // source loses its published flag so stale roster entries cannot linger on the board.
        assertTrue(clanRows.stream().filter(row -> row.clanTag.equals("A")).findFirst().orElseThrow().historicalPublished);
        assertTrue(clanRows.stream().filter(row -> row.clanTag.equals("B")).findFirst().orElseThrow().historicalPublished);
        assertFalse(clanRows.stream().filter(row -> row.clanTag.equals("GONE")).findFirst().orElseThrow().historicalPublished);
        assertEquals(1, auditRows.size()); assertEquals("CSV_IMPORTED", auditRows.getFirst().action);
    }

    @Test void csvAcceptsTheMaximumCellScore() {
        final var preview = service.previewCsv(1, 0, csv(csvText("A", "1000000", "", "1000000")));
        assertEquals(1_000_000L, preview.standings().rows().getFirst().rounds().getFirst().days().getFirst().points());
    }

    @Test void ruleSavesBumpExactlyTheTouchedVersionsAndUseTheConfiguredDayPoints() {
        final List<TournamentSnapshot.RankPoints> dayOne = List.of(new TournamentSnapshot.RankPoints(1, 100), new TournamentSnapshot.RankPoints(2, 60), new TournamentSnapshot.RankPoints(3, 30), new TournamentSnapshot.RankPoints(4, 10));
        final List<TournamentSnapshot.RankPoints> dayTwo = List.of(new TournamentSnapshot.RankPoints(1, 40), new TournamentSnapshot.RankPoints(2, 30), new TournamentSnapshot.RankPoints(3, 20), new TournamentSnapshot.RankPoints(4, 5));
        rule.days = List.of(new TournamentSnapshot.RuleDay(1, dayOne), new TournamentSnapshot.RuleDay(2, dayTwo));
        final TournamentDay dayTwoRow = new TournamentDay(); dayTwoRow.id = 2L; dayTwoRow.eventId = 1; dayTwoRow.roundNumber = 1; dayTwoRow.dayNumber = 2;
        dayTwoRow.expectedGroupCount = 1; dayTwoRow.clearedClans = Set.of(); dayTwoRow.publicationKeys = Set.of(); dayTwoRow.draftGroups = List.of();
        final TournamentDay otherRoundRow = new TournamentDay(); otherRoundRow.id = 3L; otherRoundRow.eventId = 1; otherRoundRow.roundNumber = 2; otherRoundRow.dayNumber = 1;
        otherRoundRow.expectedGroupCount = 1; otherRoundRow.clearedClans = Set.of(); otherRoundRow.publicationKeys = Set.of(); otherRoundRow.draftGroups = List.of();
        dayRows.add(dayTwoRow); dayRows.add(otherRoundRow);
        day.draftGroups = List.of();
        final long eventVersion = event.version; final long dayOneVersion = day.version;
        final List<TournamentDtos.RuleDay> configured = rule.days.stream().map(value -> new TournamentDtos.RuleDay(value.dayNumber(),
                value.points().stream().map(point -> new TournamentDtos.RankPoints(point.rank(), point.points())).toList())).toList();
        service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(eventVersion, 1, configured));
        assertEquals(2, rule.rulesVersion); assertEquals(eventVersion + 1, event.version);
        assertEquals(dayOneVersion + 1, day.version); assertEquals(dayOneVersion + 1, dayTwoRow.version);
        assertEquals(dayOneVersion, otherRoundRow.version);
        final TournamentDtos.DayView preview = service.preview(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        assertEquals(100L, preview.standings().rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().rounds().getFirst().days().getFirst().points());
        assertEquals(60L, preview.standings().rows().stream().filter(row -> row.clanTag().equals("B")).findFirst().orElseThrow().rounds().getFirst().days().getFirst().points());
    }

    private List<TournamentDtos.Team> teamsOf(final String... tags) {
        final List<TournamentDtos.Team> teams = new ArrayList<>();
        for (int index = 0; index < tags.length; index++) { teams.add(new TournamentDtos.Team(tags[index], index + 1)); }
        return teams;
    }

    @Test void rulesMissingRankCoverageForTheScoredDayAreRejectedEvenWhenAnotherDayIsComplete() {
        rule.days = List.of(
                new TournamentSnapshot.RuleDay(1, List.of(new TournamentSnapshot.RankPoints(1, 100), new TournamentSnapshot.RankPoints(2, 50), new TournamentSnapshot.RankPoints(3, 25), new TournamentSnapshot.RankPoints(4, 10))),
                new TournamentSnapshot.RuleDay(2, List.of(new TournamentSnapshot.RankPoints(1, 40), new TournamentSnapshot.RankPoints(2, 30), new TournamentSnapshot.RankPoints(3, 20))));
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,
                () -> service.preview(1, 1, 2, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C"))));
    }

    @Test void draftGroupsMustCarryContiguousRanksStartingAtOne() {
        final TournamentDtos.IncomingGroup valid = group(1, "ERROR", "A", "B", "C");
        final List<TournamentDtos.Team> broken = List.of(new TournamentDtos.Team("A", 2), new TournamentDtos.Team("B", 3), new TournamentDtos.Team("C", 4));
        final TournamentDtos.IncomingGroup invalid = new TournamentDtos.IncomingGroup(1, valid.evidenceId(), valid.imageHash(), broken, "ERROR", true);
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.preview(1, 1, 1, request(List.of(invalid), List.of("A", "B", "C"))));
        assertNull(day.draftGroups);
    }

    @Test void outOfRangeRoundsAndDaysAreRejectedByEveryMutatingAndReadingEntry() {
        for (final Runnable probing : List.of(
                (Runnable) () -> service.day(1, 6, 1),
                (Runnable) () -> service.day(1, 0, 1),
                (Runnable) () -> service.day(1, 1, 3),
                (Runnable) () -> service.historicalState(1, 6, 1),
                (Runnable) () -> service.historicalState(1, 1, 0),
                (Runnable) () -> service.preview(1, 6, 1, request(List.of(), List.of())),
                (Runnable) () -> service.expectedGroups(1, 6, 1, new TournamentDtos.ExpectedGroupsRequest(event.version, 0, 1)),
                (Runnable) () -> service.saveDraft(1, 6, 1, request(List.of(), List.of())),
                (Runnable) () -> service.finalizeDay("admin", 1, 6, 1, new TournamentDtos.FinalizeRequest(event.version, 0, 1, "key")),
                (Runnable) () -> service.correction("admin", 1, 6, 1, new TournamentDtos.CorrectionRequest(event.version, 0, 1, "fix")),
                (Runnable) () -> service.deleteDraft(1, 6, 1, new TournamentDtos.Versions(event.version, 0)),
                (Runnable) () -> service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(event.version, 6, 1, "A", "fix", false)),
                (Runnable) () -> service.saveRules("admin", 1, 6, new TournamentDtos.RuleRequest(event.version, 1, List.of())),
                (Runnable) () -> service.recognitionPermit("admin", 1, 6, 1, event.version, 0, 1, evidenceFile))) {
            assertCode(ApiErrorCode.INVALID_ARGUMENT, probing);
        }
        // Inclusive dimension boundaries stay open: the last configured round and day are reachable.
        final List<TournamentRule> allRounds = new ArrayList<>(List.of(rule));
        for (int round = 2; round <= 5; round++) {
            final TournamentRule extra = new TournamentRule(); extra.eventId = 1; extra.roundNumber = round; extra.rulesVersion = 1; extra.days = List.of();
            allRounds.add(extra);
        }
        when(rules.findByEventIdOrderByRoundNumber(1L)).thenReturn(allRounds);
        assertEquals("EMPTY", service.day(1, 5, 1).status());
        assertEquals("EMPTY", service.day(1, 1, 2).status());
        assertEquals(1, dayRows.size()); assertEquals(0, event.version);
    }

    private final MockMultipartFile evidenceFile = new MockMultipartFile("image", "group.png", "image/png", new byte[] {1});

    @Test void saveRulesRejectsStaleRulesVersionsWithoutTouchingTheConfiguredDays() {
        final List<TournamentSnapshot.RuleDay> before = rule.days;
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 0, List.of())));
        assertEquals(1, rule.rulesVersion); assertEquals(before, rule.days); assertEquals(0, event.version);
    }

    @Test void correctionRejectsStaleDayVersionsAndInvalidGroupCounts() {
        day.expectedGroupCount = 1;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        publish("once");
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(event.version, day.version - 1, 1, "fix")));
        assertFalse(day.correction);
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(event.version, day.version, 0, "fix")));
        assertFalse(day.correction); assertEquals(1, day.expectedGroupCount);
    }

    @Test void draftWritesRequireADeclaredGroupCount() {
        day.expectedGroupCount = null;
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH,
                () -> service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C"))));
        assertNull(day.draftGroups);
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH,
                () -> service.preview(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C"))));
        assertCode(ApiErrorCode.TOURNAMENT_GROUP_COUNT_MISMATCH,
                () -> service.recognitionPermit("admin", 1, 1, 1, event.version, 0, 1, evidenceFile));
        verify(storage, never()).store(anyLong(), any(TournamentEvidenceStorage.Image.class));
    }

    @Test void eventConfigUpdatesValidateInputAndBumpTheVersionExactlyOnce() {
        final long eventVersion = event.version;
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.update("admin", 1, new TournamentDtos.UpdateRequest(eventVersion, 1999, "CN", "FIRE_CUP", 5, 2, List.of("Day 1", "Day 2"))));
        assertEquals(eventVersion, event.version); assertEquals("Day 1", event.dayLabels.getFirst());
        service.update("admin", 1, new TournamentDtos.UpdateRequest(eventVersion, 2026, "CN", "FIRE_CUP", 5, 2, List.of("Group", "Finals")));
        assertEquals(eventVersion + 1, event.version);
        assertEquals("Finals", event.dayLabels.get(1)); assertEquals("Finals", service.publicStandings(1).days().get(1).label());
    }

    @Test void saveRulesRejectsRulesThatDropRanksUsedByStoredDrafts() {
        day.expectedGroupCount = 2;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C", "D")), List.of("A", "B", "C", "D")));
        final List<TournamentSnapshot.RankPoints> threeRanks = List.of(new TournamentSnapshot.RankPoints(1, 100), new TournamentSnapshot.RankPoints(2, 50), new TournamentSnapshot.RankPoints(3, 25));
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE,
                () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                        List.of(new TournamentDtos.RuleDay(1, threeRanks.stream().map(point -> new TournamentDtos.RankPoints(point.rank(), point.points())).toList()),
                                new TournamentDtos.RuleDay(2, threeRanks.stream().map(point -> new TournamentDtos.RankPoints(point.rank(), point.points())).toList())))));
        assertTrue(day.draftGroups.getFirst().teams().stream().anyMatch(team -> team.rank() == 4));
    }

    @Test void ruleDayAndRankBoundariesAreEnforcedOnSave() {
        final List<TournamentDtos.RankPoints> full = List.of(new TournamentDtos.RankPoints(1, 100), new TournamentDtos.RankPoints(2, 50), new TournamentDtos.RankPoints(3, 25), new TournamentDtos.RankPoints(4, 10));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(0, full), new TournamentDtos.RuleDay(1, full)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(3, full)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(1, full), new TournamentDtos.RuleDay(1, full)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(1, List.of(new TournamentDtos.RankPoints(0, 100), new TournamentDtos.RankPoints(2, 50), new TournamentDtos.RankPoints(3, 25), new TournamentDtos.RankPoints(4, 10))),
                        new TournamentDtos.RuleDay(2, full)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(1, List.of(new TournamentDtos.RankPoints(1, 100), new TournamentDtos.RankPoints(2, 50), new TournamentDtos.RankPoints(3, 25), new TournamentDtos.RankPoints(6, 10))),
                        new TournamentDtos.RuleDay(2, full)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(1, List.of(new TournamentDtos.RankPoints(1, -1), new TournamentDtos.RankPoints(2, 50), new TournamentDtos.RankPoints(3, 25), new TournamentDtos.RankPoints(4, 10))),
                        new TournamentDtos.RuleDay(2, full)))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(1, List.of(new TournamentDtos.RankPoints(1, 1_000_001), new TournamentDtos.RankPoints(2, 50), new TournamentDtos.RankPoints(3, 25), new TournamentDtos.RankPoints(4, 10))),
                        new TournamentDtos.RuleDay(2, full)))));
        // rulesVersion 0 never counts as a configured rule set even when the days are complete.
        final long rulesVersion = rule.rulesVersion; rule.rulesVersion = 0;
        assertCode(ApiErrorCode.TOURNAMENT_RULES_INCOMPLETE, () -> service.preview(1, 1, 1, request(List.of(), List.of())));
        rule.rulesVersion = rulesVersion;
        service.saveRules("admin", 1, 1, new TournamentDtos.RuleRequest(event.version, 1,
                List.of(new TournamentDtos.RuleDay(1, List.of(new TournamentDtos.RankPoints(1, 1_000_000), new TournamentDtos.RankPoints(2, 50), new TournamentDtos.RankPoints(3, 25), new TournamentDtos.RankPoints(4, 0), new TournamentDtos.RankPoints(5, 5))),
                        new TournamentDtos.RuleDay(2, full))));
        assertEquals(2, rule.rulesVersion);
    }

    @Test void mergeRejectsGroupNumbersOutsideTheWireContract() {
        final TournamentDtos.IncomingGroup template = group(1, "ERROR", "A", "B", "C");
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.preview(1, 1, 1, request(
                List.of(new TournamentDtos.IncomingGroup(0, template.evidenceId(), template.imageHash(), template.teams(), "ERROR", true)), List.of("A", "B", "C"))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.preview(1, 1, 1, request(
                List.of(new TournamentDtos.IncomingGroup(10001, template.evidenceId(), template.imageHash(), template.teams(), "ERROR", true)), List.of("A", "B", "C"))));
        assertNull(day.draftGroups);
    }

    @Test void clearingASanctionForAWholeRoundCoversEveryConfiguredDayOfThatRound() {
        day.expectedGroupCount = 1;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        publish("first");
        final TournamentDay dayTwo = new TournamentDay(); dayTwo.id = 9L; dayTwo.eventId = 1; dayTwo.roundNumber = 1; dayTwo.dayNumber = 2;
        dayTwo.expectedGroupCount = 1; dayTwo.clearedClans = Set.of(); dayTwo.publicationKeys = Set.of(); dayTwo.version = 0;
        dayRows.add(dayTwo);
        service.saveDraft(1, 1, 2, new TournamentDtos.DraftRequest(event.version, dayTwo.version, rule.rulesVersion,
                List.of(groupForDay(1, 2, "A", "B", "C")), List.of("A", "B", "C")));
        service.finalizeDay("admin", 1, 1, 2, new TournamentDtos.FinalizeRequest(event.version, dayTwo.version, rule.rulesVersion, "second"));
        final long eventVersion = event.version;
        final TournamentDtos.Standings after = service.clearPoints("admin", 1,
                new TournamentDtos.ClearRequest(eventVersion, 1, null, "A", "round-wide violation", false));
        assertEquals(eventVersion + 1, event.version);
        assertEquals(0, after.rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertEquals(Set.of("A"), day.clearedClans); assertEquals(Set.of("A"), dayTwo.clearedClans);
        assertEquals(200, service.day(1, 1, 1, true).canonicalStandings().rows().stream()
                .filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertEquals(0, service.publicStandings(1).rows().stream()
                .filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
    }

    private TournamentDtos.IncomingGroup groupForDay(final int round, final int dayNumber, final String... tags) {
        final TournamentEvidence row = new TournamentEvidence(); row.id = UUID.randomUUID().toString(); row.eventId = 1;
        row.roundNumber = round; row.dayNumber = dayNumber; row.createdAt = Instant.now(); row.imageHash = String.format("%064x", images.size() + 1);
        images.put(row.id, row);
        final List<TournamentDtos.Team> teams = new ArrayList<>();
        for (int index = 0; index < tags.length; index++) { teams.add(new TournamentDtos.Team(tags[index], index + 1)); }
        return new TournamentDtos.IncomingGroup(1, row.id, row.imageHash, teams, "ERROR", true);
    }

    @Test void correctionRejectsStaleVersionsAndBumpsBothVersionsExactlyOnce() {
        day.expectedGroupCount = 1;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        publish("once");
        final long eventVersion = event.version; final long dayVersion = day.version;
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(eventVersion - 1, dayVersion, 1, "fix")));
        assertFalse(day.correction); assertEquals(eventVersion, event.version);
        service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(eventVersion, dayVersion, 1, "fix"));
        assertTrue(day.correction); assertEquals(eventVersion + 1, event.version); assertEquals(dayVersion + 1, day.version);
    }

    @Test void discardingACorrectionDraftRestoresThePublishedShapeAndBumpsVersions() {
        day.expectedGroupCount = 1;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        publish("once");
        service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(event.version, day.version, 3, "fix"));
        assertEquals(3, day.expectedGroupCount);
        final long eventVersion = event.version; final long dayVersion = day.version;
        service.deleteDraft(1, 1, 1, new TournamentDtos.Versions(eventVersion, dayVersion));
        assertFalse(day.correction); assertNull(day.draftGroups); assertNull(day.correctionReason);
        assertEquals(1, day.expectedGroupCount);
        assertEquals(eventVersion + 1, event.version); assertEquals(dayVersion + 1, day.version);
        // Only the day version is stale here: the event version check must not mask the day check.
        assertCode(ApiErrorCode.TOURNAMENT_VERSION_CONFLICT,
                () -> service.deleteDraft(1, 1, 1, new TournamentDtos.Versions(event.version, dayVersion)));
    }

    @Test void sanctionsBumpVersionsExactlyOnceAuditTheActionAndOnlyZeroTheTargetClan() {
        day.expectedGroupCount = 1;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        publish("once");
        final long eventVersion = event.version; final long dayVersion = day.version; final int auditsBefore = auditRows.size();
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(eventVersion, 1, 1, "A", " ", false)));
        service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(eventVersion, 1, 1, "A", "violation", false));
        assertEquals(eventVersion + 1, event.version); assertEquals(dayVersion + 1, day.version);
        assertEquals(auditsBefore + 1, auditRows.size()); assertEquals("POINTS_CLEARED", auditRows.getLast().action);
        assertEquals(Set.of("A"), day.clearedClans);
        assertEquals(0, service.publicStandings(1).rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertEquals(50, service.publicStandings(1).rows().stream().filter(row -> row.clanTag().equals("B")).findFirst().orElseThrow().totalPoints());
        service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(event.version, 1, 1, "A", "appeal", true));
        assertEquals(100, service.publicStandings(1).rows().stream().filter(row -> row.clanTag().equals("A")).findFirst().orElseThrow().totalPoints());
        assertTrue(day.clearedClans.isEmpty());
    }

    @Test void sanctionAndGroupCountValidationUseInclusiveBoundaries() {
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.expectedGroups(1, 1, 1, new TournamentDtos.ExpectedGroupsRequest(event.version, day.version, 0)));
        assertEquals(1, service.expectedGroups(1, 1, 1, new TournamentDtos.ExpectedGroupsRequest(event.version, day.version, 1)).version());
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.expectedGroups(1, 1, 1, new TournamentDtos.ExpectedGroupsRequest(event.version, day.version, 10001)));
    }

    @Test void clanTagsMayUseExactlyThirtyTwoCodePoints() {
        final String tag = "😀".repeat(32);
        // 合法上界是 32 个 Unicode code points（不是 UTF-16 code units）；33 已在上方用例拒绝。
        assertEquals(32, tag.codePointCount(0, tag.length()));
        final TournamentDtos.DayView result = service.preview(1, 1, 1, request(List.of(group(1, "ERROR", tag, "B", "C")), List.of(tag, "B", "C")));
        assertEquals(tag, result.standings().rows().getFirst().clanTag());
    }

    @Test void correctionReasonsAreCappedAtFiveHundredCodePoints() {
        assertCode(ApiErrorCode.TOURNAMENT_LOCKED,
                () -> service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(event.version, day.version, 1, "r".repeat(500))));
        assertCode(ApiErrorCode.INVALID_ARGUMENT,
                () -> service.correction("admin", 1, 1, 1, new TournamentDtos.CorrectionRequest(event.version, day.version, 1, "r".repeat(501))));
    }

    @Test void recognitionPermitsNeedThirtyTwoByteKeysAndStoreEvidenceForDownload() throws Exception {
        final TournamentService smallKey = new TournamentService(events, rules, defaults, days, clans, evidence, audits,
                new TournamentMapper(), storage, "k".repeat(31));
        final TournamentService boundaryKey = new TournamentService(events, rules, defaults, days, clans, evidence, audits,
                new TournamentMapper(), storage, "k".repeat(32));
        final MockMultipartFile file = new MockMultipartFile("image", "group.png", "image/png", new byte[] {1});
        when(storage.validate(file)).thenReturn(new TournamentEvidenceStorage.Image(new byte[] {1}, "b".repeat(64), "image/png"));
        assertCode(ApiErrorCode.TOURNAMENT_RECOGNITION_UNAVAILABLE,
                () -> smallKey.recognitionPermit("admin", 1, 1, 1, 0, 0, 1, file));
        assertNotNull(boundaryKey.recognitionPermit("admin", 1, 1, 1, 0, 0, 1, file));
        final TournamentDtos.RecognitionPermit permit = service.recognitionPermit("admin", 1, 1, 1, 0, 0, 1, file);
        verify(storage, times(2)).store(eq(1L), any(TournamentEvidenceStorage.Image.class));
        when(storage.load(1L, "b".repeat(64))).thenReturn(new byte[] {1});
        assertEquals("image/png", service.download(1, permit.evidenceId()).contentType());
        verify(storage).load(1L, "b".repeat(64));
    }

    @Test void previewRendersTheIncomingDraftRatherThanTheStoredOne() {
        final long eventVersion = event.version; final long dayVersion = day.version;
        service.saveDraft(1, 1, 1, request(List.of(group(1, "ERROR", "A", "B", "C")), List.of("A", "B", "C")));
        assertEquals(eventVersion + 1, event.version); assertEquals(dayVersion + 1, day.version);
        final TournamentDtos.IncomingGroup replacement = group(1, "REPLACE", "C", "B", "A");
        final TournamentDtos.DayView preview = service.preview(1, 1, 1, request(List.of(replacement), List.of()));
        assertEquals("C", preview.standings().rows().getFirst().clanTag());
        assertEquals("DRAFT", preview.status()); assertFalse(preview.published());
        assertEquals("A", service.day(1, 1, 1).standings().rows().getFirst().clanTag());
    }

    private MockMultipartFile csv(final String text) { return new MockMultipartFile("file", "standings.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8)); }
    private String csvText(final String tag, final String first, final String second, final String total) {
        return "军团标签,R1D1,R1D2,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2,R5D1,R5D2,总积分\n" + tag + "," + first + "," + second + ",,,,,,,,," + total + "\n";
    }
    private TournamentDtos.HistoricalRow historicalRow(final String tag, final Integer... input) {
        final List<Integer> values=new ArrayList<>(java.util.Collections.nCopies(10,null)); long total=0;
        for(int index=0;index<input.length;index++){values.set(index,input[index]); if(input[index]!=null){total+=input[index];}}
        return new TournamentDtos.HistoricalRow(tag,values,total);
    }
    private void publish(final String key) { service.finalizeDay("admin",1,1,1,new TournamentDtos.FinalizeRequest(event.version,day.version,rule.rulesVersion,key)); }
    private TournamentDtos.DraftRequest request(final List<TournamentDtos.IncomingGroup> groups, final List<String> tags) { return new TournamentDtos.DraftRequest(event.version,day.version,rule.rulesVersion,groups,tags); }
    private TournamentDtos.IncomingGroup group(final int number, final String action, final String... tags) {
        final TournamentEvidence row=new TournamentEvidence(); row.id=UUID.randomUUID().toString(); row.eventId=1; row.roundNumber=1; row.dayNumber=1;
        row.createdAt=Instant.now(); row.imageHash=String.format("%064x",images.size()+1); images.put(row.id,row);
        final List<TournamentDtos.Team> teams=new ArrayList<>(); for(int i=0;i<tags.length;i++){teams.add(new TournamentDtos.Team(tags[i],i+1));}
        return new TournamentDtos.IncomingGroup(number,row.id,row.imageHash,teams,action,true);
    }
    private List<TournamentSnapshot.RuleDay> ruleDays(final boolean fifth) {
        final List<TournamentSnapshot.RankPoints> points=new ArrayList<>(List.of(new TournamentSnapshot.RankPoints(1,100),new TournamentSnapshot.RankPoints(2,50),new TournamentSnapshot.RankPoints(3,25),new TournamentSnapshot.RankPoints(4,10)));
        if(fifth){points.add(new TournamentSnapshot.RankPoints(5,5));} return List.of(new TournamentSnapshot.RuleDay(1,points),new TournamentSnapshot.RuleDay(2,points));
    }
    private void assertCode(final ApiErrorCode code, final Runnable action) { assertEquals(code,assertThrows(ApiException.class,action::run).errorCode()); }
}

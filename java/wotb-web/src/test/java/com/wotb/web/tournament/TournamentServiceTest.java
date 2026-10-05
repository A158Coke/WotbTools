package com.wotb.web.tournament;

import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.tournament.entity.TournamentClan;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentEvent;
import com.wotb.web.tournament.entity.TournamentEvidence;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.repository.TournamentAuditRepository;
import com.wotb.web.tournament.repository.TournamentClanRepository;
import com.wotb.web.tournament.repository.TournamentDayRepository;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TournamentServiceTest {
    private static final String KEY = "unit-only-32-byte-signing-key-123456";
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
        service = new TournamentService(events,rules,days,clans,evidence,audits,new TournamentMapper(),storage,KEY);
        event = new TournamentEvent(); event.id=1L; event.year=2026; event.region="CN"; event.season="FIRE_CUP";
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
        when(audits.findByEventIdOrderByIdDesc(1L)).thenAnswer(call->List.copyOf(auditRows));
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

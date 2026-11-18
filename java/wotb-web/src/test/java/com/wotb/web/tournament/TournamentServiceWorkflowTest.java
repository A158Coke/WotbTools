package com.wotb.web.tournament;

import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentClan;
import com.wotb.web.tournament.entity.TournamentDay;
import com.wotb.web.tournament.entity.TournamentRule;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.tournament.mapper.TournamentMapper;
import com.wotb.web.tournament.service.TournamentEvidenceStorage;
import com.wotb.web.tournament.service.TournamentService;
import com.wotb.web.util.apierror.ApiErrorCode;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;

class TournamentServiceWorkflowTest extends TournamentServiceFixture {
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

}



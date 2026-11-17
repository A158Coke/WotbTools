package com.wotb.web.tournament;

import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.entity.TournamentAudit;
import com.wotb.web.tournament.entity.TournamentClan;
import com.wotb.web.tournament.entity.TournamentSnapshot;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.core.io.ClassPathResource;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verifyNoMoreInteractions;

class TournamentServiceImportTest extends TournamentServiceFixture {
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
    @Test void sanctionedHistoricalPointsStayVisibleOnlyInTheCanonicalSnapshot() {
        service.importHistorical("admin", 1, historicalRequest(List.of(historicalRow("A", 100)), "import"));
        service.clearPoints("admin", 1, new TournamentDtos.ClearRequest(event.version, 1, 1, "A", "violation", false));
        assertEquals(0, service.publicStandings(1).rows().getFirst().totalPoints());
        assertEquals(100, service.day(1, 1, 1, true).canonicalStandings().rows().getFirst().totalPoints());
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

}



package com.wotb.web.tournament.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.service.TournamentService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.TOURNAMENTS_ADMIN)
public class TournamentAdminController {
    private static final String DAY = "/{eventId}/rounds/{roundNumber}/days/{dayNumber}";
    private final TournamentService service;
    public TournamentAdminController(final TournamentService service) { this.service = service; }
    @GetMapping
    public List<TournamentDtos.Event> list() { return service.listEvents(); }
    @PostMapping
    public TournamentDtos.Config create(@RequestBody final TournamentDtos.CreateRequest request) {
        return service.create(JwtUtil.requireUserId(), request);
    }
    @GetMapping("/{eventId}")
    public TournamentDtos.Config config(@PathVariable final long eventId) { return service.config(eventId); }
    @PutMapping("/{eventId}")
    public TournamentDtos.Config update(@PathVariable final long eventId, @RequestBody final TournamentDtos.UpdateRequest request) {
        return service.update(JwtUtil.requireUserId(), eventId, request);
    }
    @DeleteMapping("/{eventId}")
    public ResponseEntity<Void> delete(@PathVariable final long eventId, @RequestBody final TournamentDtos.DeleteRequest request) {
        service.deleteEvent(eventId, request); return ResponseEntity.noContent().build();
    }
    @PutMapping("/{eventId}/rounds/{roundNumber}")
    public TournamentDtos.Config rules(@PathVariable final long eventId, @PathVariable final int roundNumber, @RequestBody final TournamentDtos.RuleRequest request) {
        return service.saveRules(JwtUtil.requireUserId(), eventId, roundNumber, request);
    }
    @GetMapping(DAY)
    public TournamentDtos.DayView day(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber) {
        return service.day(eventId, roundNumber, dayNumber);
    }
    @PutMapping(DAY + "/expected-groups")
    public TournamentDtos.DayView expected(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber, @RequestBody final TournamentDtos.ExpectedGroupsRequest request) {
        return service.expectedGroups(eventId, roundNumber, dayNumber, request);
    }
    @PostMapping(value = DAY + "/recognition-permits", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public TournamentDtos.RecognitionPermit permit(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber,
                                                  @RequestParam(name = "image") final MultipartFile image,
                                                  @RequestParam(name = "expectedEventVersion") final long eventVersion,
                                                  @RequestParam(name = "expectedDayVersion") final long dayVersion,
                                                  @RequestParam(name = "expectedRulesVersion") final long rulesVersion) {
        return service.recognitionPermit(JwtUtil.requireUserId(), eventId, roundNumber, dayNumber, eventVersion, dayVersion, rulesVersion, image);
    }
    @PostMapping(DAY + "/preview")
    public TournamentDtos.DayView preview(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber, @RequestBody final TournamentDtos.DraftRequest request) {
        return service.preview(eventId, roundNumber, dayNumber, request);
    }
    @PutMapping(DAY + "/draft")
    public TournamentDtos.DayView draft(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber, @RequestBody final TournamentDtos.DraftRequest request) {
        return service.saveDraft(eventId, roundNumber, dayNumber, request);
    }
    @DeleteMapping(DAY + "/draft")
    public TournamentDtos.DayView deleteDraft(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber, @RequestBody final TournamentDtos.Versions request) {
        return service.deleteDraft(eventId, roundNumber, dayNumber, request);
    }
    @PostMapping(DAY + "/finalize")
    public TournamentDtos.DayView finalizeDay(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber, @RequestBody final TournamentDtos.FinalizeRequest request) {
        return service.finalizeDay(JwtUtil.requireUserId(), eventId, roundNumber, dayNumber, request);
    }
    @PostMapping(DAY + "/correction")
    public TournamentDtos.DayView correction(@PathVariable final long eventId, @PathVariable final int roundNumber, @PathVariable final int dayNumber, @RequestBody final TournamentDtos.CorrectionRequest request) {
        return service.correction(JwtUtil.requireUserId(), eventId, roundNumber, dayNumber, request);
    }
    @PostMapping("/{eventId}/clear-points")
    public TournamentDtos.Standings clear(@PathVariable final long eventId, @RequestBody final TournamentDtos.ClearRequest request) {
        return service.clearPoints(JwtUtil.requireUserId(), eventId, request);
    }
    @PostMapping("/{eventId}/historical-import/preview")
    public TournamentDtos.HistoricalPreview historicalPreview(@PathVariable final long eventId, @RequestBody final TournamentDtos.HistoricalPreviewRequest request) {
        return service.previewHistorical(eventId, request);
    }
    @GetMapping("/{eventId}/historical-import")
    public TournamentDtos.HistoricalState historicalState(@PathVariable final long eventId,
            @RequestParam(name = "roundNumber") final int roundNumber,
            @RequestParam(name = "dayNumber") final int dayNumber) {
        return service.historicalState(eventId, roundNumber, dayNumber);
    }
    @PostMapping("/{eventId}/historical-import")
    public TournamentDtos.HistoricalPreview historicalImport(@PathVariable final long eventId, @RequestBody final TournamentDtos.HistoricalImportRequest request) {
        return service.importHistorical(JwtUtil.requireUserId(), eventId, request);
    }
    @GetMapping("/{eventId}/audit")
    public List<TournamentDtos.Audit> audit(@PathVariable final long eventId) { return service.auditList(eventId); }
    @GetMapping("/{eventId}/evidence/{evidenceId}")
    public ResponseEntity<byte[]> evidence(@PathVariable final long eventId, @PathVariable final String evidenceId) {
        final TournamentDtos.EvidenceDownload image = service.download(eventId, evidenceId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store").header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}

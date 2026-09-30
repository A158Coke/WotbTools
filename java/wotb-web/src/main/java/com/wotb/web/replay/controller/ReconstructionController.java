package com.wotb.web.replay.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.replay.MapOverviewQueryService;
import com.wotb.web.replay.ReplayLegacyEndpoints;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import com.wotb.web.replay.dto.MapOverview;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Map overview and legacy processing endpoints. AI Review is served by the standalone ai-service. */
@RestController
@CrossOrigin(origins = "*")
public class ReconstructionController {
    private static final Pattern SOURCE_ID = Pattern.compile("^r(\\d+)$");
    private final MapOverviewQueryService mapOverviewService;

    @Autowired
    public ReconstructionController(final MapOverviewQueryService mapOverviewService) {
        this.mapOverviewService = mapOverviewService;
    }

    @PostMapping(value = ApiPaths.REPLAY_RECONSTRUCT_BATCH, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object reconstructBatch(@RequestParam("files") final MultipartFile[] files) throws IOException {
        throw ReplayLegacyEndpoints.gone();
    }

    @PostMapping(value = ApiPaths.REPLAY_PROCESS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object process(@RequestParam("files") final MultipartFile[] files,
                         @RequestParam(name = "reconstruct", defaultValue = "false") final boolean doReconstruct)
            throws IOException {
        throw ReplayLegacyEndpoints.gone();
    }

    @PostMapping(value = ApiPaths.REPLAY_MAP_OVERVIEW, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MapOverview> mapOverview(@RequestParam("files") final MultipartFile[] files)
            throws IOException {
        throw ReplayLegacyEndpoints.gone();
    }

    @PostMapping(value = ApiPaths.REPLAY_MAP_OVERVIEW, consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<MapOverview> mapOverviewDataset(@RequestBody final MapOverviewDatasetRequest request) {
        requireDatasetReference(request);
        final MapOverview overview = mapOverviewService.buildOverviewFromDataset(
                request.processingJobId(), parseSourceIndex(request.sourceId()));
        return overview == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(overview);
    }

    public record MapOverviewDatasetRequest(String processingJobId, String sourceId) {
    }

    @PostMapping(value = ApiPaths.REPLAY_BATTLE_PLAYBACK_V2, consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<BattlePlaybackDataset> battlePlaybackV2(
            @RequestBody final MapOverviewDatasetRequest request) {
        requireDatasetReference(request);
        final BattlePlaybackDataset dataset = mapOverviewService.buildBattlePlaybackFromDataset(
                request.processingJobId(), parseSourceIndex(request.sourceId()));
        return dataset == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(dataset);
    }

    private static void requireDatasetReference(final MapOverviewDatasetRequest request) {
        if (request == null || request.processingJobId() == null || request.processingJobId().isBlank()
                || request.sourceId() == null || request.sourceId().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED");
        }
    }

    private static int parseSourceIndex(final String sourceId) {
        final Matcher matcher = SOURCE_ID.matcher(sourceId.trim());
        if (!matcher.matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND");
        }
        return Integer.parseInt(matcher.group(1));
    }
}

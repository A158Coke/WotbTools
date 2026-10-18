package com.wotb.web.tournament.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.dto.BroadcastLegacyDtos;
import com.wotb.web.tournament.service.BroadcastService;
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
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping(ApiPaths.BROADCASTS_ADMIN)
public class BroadcastAdminController {
    private final BroadcastService service;
    public BroadcastAdminController(final BroadcastService service) { this.service = service; }
    @PostMapping("/seasons")
    public BroadcastLegacyDtos.SeasonView createSeason(@RequestBody final BroadcastLegacyDtos.SeasonCreate request) { return service.legacyCreateSeason(request); }
    @PutMapping("/seasons/{id}")
    public BroadcastLegacyDtos.SeasonView updateSeason(@PathVariable final long id, @RequestBody final BroadcastLegacyDtos.SeasonUpdate request) { return service.legacyUpdateSeason(id,request); }
    @PostMapping("/seasons/{id}/categories")
    public BroadcastLegacyDtos.SeasonView createCategory(@PathVariable final long id, @RequestBody final BroadcastDtos.CategoryCreate request) { return service.legacyCreateCategory(id,request); }
    @PostMapping("/categories/{id}/nodes")
    public BroadcastLegacyDtos.CategoryView createNode(@PathVariable final long id, @RequestBody final BroadcastDtos.NodeCreate request) { return service.legacyCreateNode(id,request); }
    @PostMapping(value = "/nodes/{id}/replays", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BroadcastLegacyDtos.CategoryView createReplay(@PathVariable final long id,
            @RequestPart(name = "payload") final BroadcastLegacyDtos.ReplaySave request,
            @RequestPart(name = "cover", required = false) final MultipartFile cover) { return service.legacyCreateReplay(id,request,cover); }
    @PutMapping(value = "/replays/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BroadcastLegacyDtos.CategoryView updateReplay(@PathVariable final long id,
            @RequestPart(name = "payload") final BroadcastLegacyDtos.ReplaySave request,
            @RequestPart(name = "cover", required = false) final MultipartFile cover) { return service.legacyUpdateReplay(id,request,cover); }
    @PostMapping("/v2/seasons")
    public BroadcastDtos.SeasonView createSeasonV2(@RequestBody final BroadcastDtos.SeasonCreate request) { return service.createSeason(request); }
    @PutMapping("/v2/seasons/{id}")
    public BroadcastDtos.SeasonView updateSeasonV2(@PathVariable final long id, @RequestBody final BroadcastDtos.SeasonUpdate request) { return service.updateSeason(id, request); }
    @PostMapping("/v2/seasons/{id}/categories")
    public BroadcastDtos.SeasonView createCategoryV2(@PathVariable final long id, @RequestBody final BroadcastDtos.CategoryCreate request) { return service.createCategory(id, request); }
    @PostMapping("/v2/categories/{id}/nodes")
    public BroadcastDtos.CategoryView createNodeV2(@PathVariable final long id, @RequestBody final BroadcastDtos.NodeCreate request) { return service.createNode(id, request); }
    @PostMapping(value = "/v2/nodes/{id}/replays", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BroadcastDtos.CategoryView createReplayV2(@PathVariable final long id,
            @RequestPart(name = "payload") final BroadcastDtos.ReplaySave request,
            @RequestPart(name = "cover", required = false) final MultipartFile cover) { return service.createReplay(id, request, cover); }
    @PutMapping(value = "/v2/replays/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BroadcastDtos.CategoryView updateReplayV2(@PathVariable final long id,
            @RequestPart(name = "payload") final BroadcastDtos.ReplaySave request,
            @RequestPart(name = "cover", required = false) final MultipartFile cover) { return service.updateReplay(id, request, cover); }
    @PostMapping("/v3/categories/{id}/nodes")
    public BroadcastDtos.TimedCategoryView createNodeV3(@PathVariable final long id, @RequestBody final BroadcastDtos.NodeCreate request) { return service.timedCreateNode(id, request); }
    @PostMapping(value = "/v3/nodes/{id}/replays", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BroadcastDtos.TimedCategoryView createReplayV3(@PathVariable final long id,
            @RequestPart(name = "payload") final BroadcastDtos.TimedReplaySave request,
            @RequestPart(name = "cover", required = false) final MultipartFile cover) { return service.timedCreateReplay(id, request, cover); }
    @PutMapping(value = "/v3/replays/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BroadcastDtos.TimedCategoryView updateReplayV3(@PathVariable final long id,
            @RequestPart(name = "payload") final BroadcastDtos.TimedReplaySave request,
            @RequestPart(name = "cover", required = false) final MultipartFile cover) { return service.timedUpdateReplay(id, request, cover); }
    @GetMapping({"/seasons/{id}/deletion-preview", "/v2/seasons/{id}/deletion-preview"})
    public BroadcastDtos.DeletionPreview seasonDeletionPreview(@PathVariable final long id) { return service.seasonDeletionPreview(id); }
    @GetMapping({"/nodes/{id}/deletion-preview", "/v2/nodes/{id}/deletion-preview"})
    public BroadcastDtos.DeletionPreview nodeDeletionPreview(@PathVariable final long id) { return service.nodeDeletionPreview(id); }
    @DeleteMapping({"/seasons/{id}", "/v2/seasons/{id}"})
    public ResponseEntity<Void> deleteSeason(@PathVariable final long id,
            @RequestParam(name = "expectedVersion") final long expectedVersion,
            @RequestParam(name = "confirm") final boolean confirm) {
        service.deleteSeason(id, expectedVersion, confirm); return ResponseEntity.noContent().build();
    }
    @DeleteMapping({"/nodes/{id}", "/v2/nodes/{id}"})
    public ResponseEntity<Void> deleteNode(@PathVariable final long id,
            @RequestParam(name = "expectedVersion") final long expectedVersion,
            @RequestParam(name = "confirm") final boolean confirm) {
        service.deleteNode(id, expectedVersion, confirm); return ResponseEntity.noContent().build();
    }
    @DeleteMapping({"/replays/{id}", "/v2/replays/{id}"})
    public ResponseEntity<Void> deleteReplay(@PathVariable final long id,
            @RequestParam(name = "expectedVersion") final long expectedVersion,
            @RequestParam(name = "confirm") final boolean confirm) {
        service.deleteReplay(id, expectedVersion, confirm); return ResponseEntity.noContent().build();
    }
}

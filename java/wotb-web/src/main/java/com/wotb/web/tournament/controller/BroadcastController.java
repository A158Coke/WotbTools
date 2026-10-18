package com.wotb.web.tournament.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.tournament.dto.BroadcastDtos;
import com.wotb.web.tournament.dto.BroadcastLegacyDtos;
import com.wotb.web.tournament.service.BroadcastCoverService;
import com.wotb.web.tournament.service.BroadcastService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ApiPaths.BROADCASTS)
public class BroadcastController {
    private final BroadcastService service;
    private final BroadcastCoverService covers;
    public BroadcastController(final BroadcastService service, final BroadcastCoverService covers) {
        this.service = service; this.covers = covers;
    }
    @GetMapping
    public BroadcastLegacyDtos.Index index(@RequestParam(name = "server", required = false) final String server) { return service.legacyIndex(server); }
    @GetMapping("/seasons/{id}")
    public BroadcastLegacyDtos.SeasonView season(@PathVariable final long id) { return service.legacySeason(id); }
    @GetMapping("/categories/{id}")
    public BroadcastLegacyDtos.CategoryView category(@PathVariable final long id) { return service.legacyCategory(id); }
    @GetMapping("/v2")
    public BroadcastDtos.Index indexV2(@RequestParam(name = "server", required = false) final String server) { return service.index(server); }
    @GetMapping("/v2/seasons/{id}")
    public BroadcastDtos.SeasonView seasonV2(@PathVariable final long id) { return service.season(id); }
    @GetMapping("/v2/categories/{id}")
    public BroadcastDtos.CategoryView categoryV2(@PathVariable final long id) { return service.category(id); }
    @GetMapping("/v3/categories/{id}")
    public BroadcastDtos.TimedCategoryView categoryV3(@PathVariable final long id) { return service.timedCategory(id); }
    @GetMapping("/covers/{id}")
    public ResponseEntity<byte[]> cover(@PathVariable final String id) {
        final BroadcastCoverService.CoverImage image = covers.load(id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300").eTag(image.hash())
                .header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}

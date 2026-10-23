package com.wotb.web.tournament.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.tournament.dto.BroadcastDtos;
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
    public BroadcastDtos.Index index(@RequestParam(name = "server", required = false) final String server) { return service.index(server); }
    @GetMapping("/seasons/{id}")
    public BroadcastDtos.SeasonView season(@PathVariable final long id) { return service.season(id); }
    @GetMapping("/seasons/{id}/contents")
    public BroadcastDtos.SeasonContents seasonContents(@PathVariable final long id) { return service.seasonContents(id); }
    @GetMapping("/categories/{id}")
    public BroadcastDtos.TimedCategoryView category(@PathVariable final long id) { return service.category(id); }
    @GetMapping("/covers/{id}")
    public ResponseEntity<byte[]> cover(@PathVariable final String id) {
        final BroadcastCoverService.CoverImage image = covers.load(id);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300").eTag(image.hash())
                .header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}

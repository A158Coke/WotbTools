package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.creator.service.CreatorAvatarService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.CREATORS)
public class CreatorController {
    private final CreatorService service;
    private final CreatorAvatarService avatars;
    public CreatorController(final CreatorService service, final CreatorAvatarService avatars) { this.service = service; this.avatars = avatars; }
    @GetMapping("/categories")
    public List<CreatorDtos.Category> categories() { return service.categories(); }
    @GetMapping
    public List<CreatorDtos.Card> list(@RequestParam(name = "categoryId", required = false) final Long categoryId) { return service.list(categoryId); }
    @GetMapping("/avatars/{avatarId}")
    public ResponseEntity<byte[]> image(@PathVariable final String avatarId) {
        final CreatorAvatarService.AvatarImage image = avatars.load(avatarId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300").eTag(image.hash())
                .header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}

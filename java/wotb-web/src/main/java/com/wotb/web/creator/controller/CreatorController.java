package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.service.CreatorAvatarService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CreatorController {
    private final CreatorAvatarService avatars;
    public CreatorController(final CreatorAvatarService avatars) { this.avatars = avatars; }
    @GetMapping(ApiPaths.CREATOR_AVATARS + "/{avatarId}")
    public ResponseEntity<byte[]> image(@PathVariable final String avatarId) {
        final CreatorAvatarService.AvatarImage image = avatars.load(avatarId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300").eTag(image.hash())
                .header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}

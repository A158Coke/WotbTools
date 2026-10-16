package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.service.CreatorAvatarService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class CreatorAvatarController {
    private final CreatorAvatarService avatars;
    public CreatorAvatarController(final CreatorAvatarService avatars) { this.avatars = avatars; }
    @PostMapping(value = ApiPaths.CREATORS_ADMIN + "/avatars", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Avatar upload(@RequestPart(name = "file") final MultipartFile file) { return avatars.upload(file); }
    @DeleteMapping(ApiPaths.CREATORS_ADMIN + "/avatars/{avatarId}")
    public ResponseEntity<Void> release(@PathVariable final String avatarId) {
        avatars.release(avatarId);
        return ResponseEntity.noContent().build();
    }
    @GetMapping(ApiPaths.CREATORS + "/avatars/{avatarId}")
    public ResponseEntity<byte[]> image(@PathVariable final String avatarId) {
        final CreatorAvatarService.AvatarImage image = avatars.load(avatarId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300").eTag(image.hash())
                .header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
}

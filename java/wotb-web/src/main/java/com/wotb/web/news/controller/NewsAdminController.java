package com.wotb.web.news.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.service.NewsArchiveService;
import com.wotb.web.news.service.NewsImageService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ApiPaths.NEWS_ADMIN)
@PreAuthorize("hasAnyRole('news-admin', 'tournament-admin')")
public class NewsAdminController {
    private final NewsArchiveService archives;
    private final NewsImageService images;
    public NewsAdminController(final NewsArchiveService archives, final NewsImageService images) {
        this.archives = archives; this.images = images;
    }
    @GetMapping("/archives")
    public ResponseEntity<NewsDtos.ArchivePage> archives(@RequestParam(name = "page", defaultValue = "1") final int page,
                                                       @RequestParam(name = "size", defaultValue = "20") final int size,
                                                       @RequestParam(name = "source", required = false) final String source,
                                                       @RequestParam(name = "version", required = false) final String version) {
        return NewsController.fresh(archives.list(page, size, source, version, true));
    }
    @GetMapping("/archives/{id}")
    public ResponseEntity<NewsDtos.Archive> archive(@PathVariable final long id) { return NewsController.fresh(archives.get(id, true)); }
    @PostMapping("/archives")
    public ResponseEntity<NewsDtos.ReceiptResult> create(@AuthenticationPrincipal final Jwt principal,
                                                       @RequestBody final NewsDtos.CreateRequest request) {
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).body(archives.create(principal.getSubject(), request));
    }
    @PostMapping("/archives/{id}/retry")
    public ResponseEntity<NewsDtos.Archive> retry(@PathVariable final long id, @RequestBody final NewsDtos.RevisionRequest request) {
        return NewsController.fresh(archives.retry(id, revision(request)));
    }
    @PostMapping("/archives/{id}/withdraw")
    public ResponseEntity<NewsDtos.Archive> withdraw(@PathVariable final long id, @RequestBody final NewsDtos.RevisionRequest request) {
        return NewsController.fresh(archives.withdraw(id, revision(request)));
    }
    @PostMapping("/archives/{id}/restore")
    public ResponseEntity<NewsDtos.Archive> restore(@PathVariable final long id, @RequestBody final NewsDtos.RevisionRequest request) {
        return NewsController.fresh(images.restore(id, revision(request)));
    }
    @DeleteMapping("/archives/{id}")
    public ResponseEntity<Void> delete(@PathVariable final long id,
                                       @RequestParam(name = "expectedRevision") final long revision,
                                       @RequestParam(name = "confirm") final boolean confirm) {
        archives.delete(id, revision, confirm); return ResponseEntity.noContent().build();
    }
    @PostMapping("/categories")
    public ResponseEntity<NewsDtos.Category> category(@RequestBody final NewsDtos.CategoryCreate request) {
        return ResponseEntity.status(201).cacheControl(CacheControl.noStore()).body(archives.createCategory(request));
    }
    @DeleteMapping("/categories/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable final long id) {
        archives.deleteCategory(id); return ResponseEntity.noContent().build();
    }
    @GetMapping("/images/{id}")
    public ResponseEntity<byte[]> image(@PathVariable final String id) {
        final NewsImageService.Blob image = images.image(id, true);
        return ResponseEntity.ok().contentType(org.springframework.http.MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
    @GetMapping("/archives/{id}/source-images/{sourceId}")
    public ResponseEntity<byte[]> frozenSourceImage(@PathVariable final long id, @PathVariable final String sourceId) {
        final NewsImageService.Blob image = images.frozenSourceImage(id, sourceId);
        return ResponseEntity.ok().contentType(org.springframework.http.MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff").body(image.bytes());
    }
    private static long revision(final NewsDtos.RevisionRequest request) {
        if (request == null || request.expectedRevision() == null || request.expectedRevision() < 0) {
            throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
        }
        return request.expectedRevision();
    }
}

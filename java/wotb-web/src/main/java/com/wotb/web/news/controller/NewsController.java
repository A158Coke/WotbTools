package com.wotb.web.news.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.service.NewsArchiveService;
import com.wotb.web.news.service.NewsImageService;
import com.wotb.web.news.service.NewsSourceService;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.NEWS)
public class NewsController {
    private final NewsArchiveService archives;
    private final NewsSourceService sources;
    private final NewsImageService images;
    public NewsController(final NewsArchiveService archives, final NewsSourceService sources, final NewsImageService images) {
        this.archives = archives; this.sources = sources; this.images = images;
    }
    @GetMapping("/sources")
    public ResponseEntity<List<NewsDtos.Source>> sources() { return fresh(sources.sources()); }
    @GetMapping("/articles")
    public ResponseEntity<NewsDtos.ArticlePage> articles(@RequestParam(name = "page", defaultValue = "1") final int page,
                                                       @RequestParam(name = "size", defaultValue = "20") final int size) {
        return fresh(sources.list(page, size));
    }
    @GetMapping("/articles/{sourceKey}")
    public ResponseEntity<NewsDtos.Article> article(@PathVariable final String sourceKey) { return fresh(sources.article(sourceKey)); }
    @GetMapping("/categories")
    public ResponseEntity<List<NewsDtos.Category>> categories() { return fresh(archives.categories()); }
    @GetMapping("/archives")
    public ResponseEntity<NewsDtos.ArchivePage> archives(@RequestParam(name = "page", defaultValue = "1") final int page,
                                                       @RequestParam(name = "size", defaultValue = "20") final int size,
                                                       @RequestParam(name = "source", required = false) final String source,
                                                       @RequestParam(name = "version", required = false) final String version) {
        return fresh(archives.list(page, size, source, version, false));
    }
    @GetMapping("/archives/{id}")
    public ResponseEntity<NewsDtos.Archive> archive(@PathVariable final long id) { return fresh(archives.get(id, false)); }
    @GetMapping("/images/{id}")
    public ResponseEntity<byte[]> image(@PathVariable final String id) { return blob(images.image(id, false)); }
    @GetMapping("/source-images/{id}")
    public ResponseEntity<byte[]> sourceImage(@PathVariable final String id) { return blob(images.sourceImage(id)); }
    static <T> ResponseEntity<T> fresh(final T value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
    static ResponseEntity<byte[]> blob(final NewsImageService.Blob image) {
        // Authorization and current publication visibility are checked before conditional HTTP handling.
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(image.contentType()))
                .cacheControl(CacheControl.noCache()).eTag(image.hash()).header("X-Content-Type-Options", "nosniff")
                .body(image.bytes());
    }
}

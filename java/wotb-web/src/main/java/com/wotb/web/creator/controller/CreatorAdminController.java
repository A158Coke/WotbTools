package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.service.CreatorService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.CREATORS_ADMIN)
public class CreatorAdminController {
    private final CreatorService service;
    public CreatorAdminController(final CreatorService service) { this.service = service; }
    @GetMapping("/{id}")
    public CreatorDtos.Detail detail(@PathVariable final long id) { return service.detail(id); }
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Detail create(@RequestBody final CreatorDtos.SaveRequest request) { return service.create(request); }
    @PutMapping("/{id}")
    public CreatorDtos.Detail update(@PathVariable final long id, @RequestBody final CreatorDtos.SaveRequest request) {
        return service.update(id, request);
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable final long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/categories")
    public List<CreatorDtos.Category> categories() { return service.categories(); }
    @PostMapping("/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Category category(@RequestBody final CreatorDtos.DictionaryRequest request) {
        return service.addCategory(request);
    }
    @DeleteMapping("/categories/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable final long id) {
        service.deleteCategory(id);
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/levels")
    public List<CreatorDtos.Level> levels() { return service.levels(); }
    @PostMapping("/levels")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Level level(@RequestBody final CreatorDtos.DictionaryRequest request) { return service.addLevel(request); }
    @DeleteMapping("/levels/{id}")
    public ResponseEntity<Void> deleteLevel(@PathVariable final long id) {
        service.deleteLevel(id);
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/settings")
    public CreatorDtos.Settings settings() { return service.settings(); }
    @PutMapping("/settings")
    public CreatorDtos.Settings settings(@RequestBody final CreatorDtos.SettingsRequest request) { return service.configure(request); }
}

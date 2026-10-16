package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.CREATORS)
public class CreatorController {
    private final CreatorService service;
    public CreatorController(final CreatorService service) { this.service = service; }
    @GetMapping("/categories")
    public List<CreatorDtos.Category> categories() { return service.categories(); }
    @GetMapping
    public List<CreatorDtos.Card> list(@RequestParam(name = "categoryId", required = false) final Long categoryId) {
        return service.list(categoryId);
    }
    @GetMapping("/favorites")
    public CreatorDtos.Favorites favorites() { return service.favorites(JwtUtil.requireUserId()); }
    @PutMapping("/{id}/favorite")
    public CreatorDtos.FavoriteResult favorite(@PathVariable final long id) {
        return service.favorite(JwtUtil.requireUserId(), id, true);
    }
    @DeleteMapping("/{id}/favorite")
    public CreatorDtos.FavoriteResult cancel(@PathVariable final long id) {
        return service.favorite(JwtUtil.requireUserId(), id, false);
    }
}

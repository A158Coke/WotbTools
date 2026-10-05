package com.wotb.web.tournament.controller;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.service.TournamentService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;
@RestController
@RequestMapping(ApiPaths.TOURNAMENTS)
public class TournamentController {
    private final TournamentService service;
    public TournamentController(final TournamentService service) { this.service = service; }
    @GetMapping
    public List<TournamentDtos.Event> list() { return service.listEvents(); }
    @GetMapping("/{eventId}/standings")
    public TournamentDtos.Standings standings(@PathVariable final long eventId) { return service.publicStandings(eventId); }
}

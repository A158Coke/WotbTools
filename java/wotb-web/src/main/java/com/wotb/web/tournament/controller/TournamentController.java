package com.wotb.web.tournament.controller;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.tournament.dto.TournamentDtos;
import com.wotb.web.tournament.service.TournamentService;
import org.springframework.http.ResponseEntity;
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
    public ResponseEntity<List<TournamentDtos.Event>> list() {
        return ResponseEntity.ok().header("X-Tournament-Csv-Import", "1").body(service.listEvents());
    }
    @GetMapping("/{eventId}/data-source")
    public TournamentDtos.DataSource dataSource(@PathVariable final long eventId) { return service.dataSource(eventId); }
    @GetMapping("/{eventId}/standings")
    public TournamentDtos.Standings standings(@PathVariable final long eventId) { return service.publicStandings(eventId); }
}

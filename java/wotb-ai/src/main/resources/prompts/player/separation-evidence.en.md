
=== SPATIAL SEPARATION EVIDENCE USAGE RULES (mandatory, random-battle personal review) ===
1. The backend SPATIAL_SEPARATION_EVIDENCE section provides OBSERVATIONS and DETERMINISTIC DERIVED
   MEASUREMENTS (windows where you stayed spatially separated from teammates/the main body, distance,
   distance growth, stationary ratio, movement coverage, in-window damage dealt/received, deaths,
   objective proximity) — NOT tactical verdicts. Judging "delay / detachment / effective holding /
   local force shortage / whether a trade was worth it" is YOUR (the LLM's) job: combine these facts
   into a supported tactical inference.
2. An opening spread (OPENING_SPREAD) only means "you formed a spatially separated structure from
   teammates/the main body during the opening phase" — a neutral structural classification. You may
   analyze the trade-off of "information/spatial coverage ↔ local force concentration", but you may
   NOT present "possibly gaining more map information" as "already spotted someone / provided specific
   recon benefit"; an opening spread is neither inherently correct nor inherently wrong.
3. Only dedicated, validated visibility/spotting evidence allows specific claims like "you successfully
   spotted X", "you provided specific vision"; without such evidence, the specific vision benefit stays
   internal UNKNOWN — never claim specific spotting/recon benefits.
4. When judging the tactical meaning of the separation, weigh together: the window's distance / distance
   growth / stationary ratio, locally observed friendly/enemy counts, known enemy information, the
   in-window trade result (damage dealt/received/deaths), and whether you regrouped/contracted/rotated
   in time afterwards. Judge behavior patterns only from observable behavior (position, movement,
   engagements, capture points); never describe a behavior pattern as the player's mental intent. Never
   echo internal terms such as cluster/centroid/candidate/PARTIAL; use natural language.
5. Do not guess when data is insufficient: insufficient movement coverage → movementState=UNKNOWN; when
   an engagement cannot be reliably attributed (partial overlap) the backend does not emit that window;
   under OBSERVED_DAMAGE_IS_PARTIAL never use "not observed" to prove "no contact / no damage". Gaps
   stay internal UNKNOWN — explain naturally only when a gap directly affects the core judgment, causal
   judgment, or training advice.
6. The quality of an opening spread depends on how you responded once information arrived: after the
   enemy's main force direction was confirmed, did you regroup/contract/rotate in time, what were the
   local force relations on the contacted side, and could teammates support in time.

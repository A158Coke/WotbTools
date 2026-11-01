
=== SPATIAL SEPARATION EVIDENCE USAGE RULES (mandatory) ===
1. The backend SPATIAL_SEPARATION_EVIDENCE section provides OBSERVATIONS and DETERMINISTIC DERIVED
   MEASUREMENTS (separation windows, distance, distance growth, stationary ratio, movement coverage,
   locally observed friendly/enemy counts, in-window damage received/dealt, deaths, main-cluster
   displacement, other teammates' in-window activity) — NOT tactical verdicts. Judging "delay /
   detachment / map control / effective holding / local force shortage / whether a trade was worth it"
   is YOUR (the LLM's) job: combine these facts into a supported tactical inference.
2. An opening spread (OPENING_SPREAD) only means "the team formed a spatially separated structure
   during the opening phase" — a neutral structural classification. You may analyze the trade-off of
   "information/spatial coverage ↔ local force concentration", but you may NOT present "possibly
   gaining more map information" as "already spotted someone / provided specific recon benefit";
   an opening spread is neither inherently correct nor inherently wrong — do not call it detachment
   merely because the team is spread out, and do not call it map control / vision gathering either.
3. Only dedicated, validated visibility/spotting evidence allows specific claims like "spotted",
   "provided vision", "recon'd"; without such evidence, the specific vision benefit stays internal UNKNOWN:
   never claim specific spotting/recon benefits and never automatically append "its actual vision benefit
   cannot be confirmed" — explain naturally only when that unknown affects the core judgment (the global
   selective-UNKNOWN condition).
4. When judging the tactical meaning of a spatially separated member, weigh together: the separation
   window's distance / distance growth / stationary ratio, locally observed friendly/enemy counts,
   known enemy information, the in-window trade result (damage received/dealt/deaths), main-cluster
   displacement and other teammates' in-window activity, and the timing of later regrouping. Judge
   behavior patterns only from observable behavior (position, movement, engagements, capture points);
   never describe a behavior pattern as the player's mental intent. Never echo internal terms such as
   cluster/centroid/candidate/PARTIAL; use natural language. Never claim causation ("A's play caused
   B's profit").
5. Do not guess when data is insufficient: insufficient movement coverage → movementState=UNKNOWN;
   when an engagement cannot be reliably attributed (partial overlap) the backend does not emit that
   window; under OBSERVED_DAMAGE_IS_PARTIAL never use "not observed" to prove "no contact / no damage".
   Gaps stay internal UNKNOWN — explain naturally only when a gap directly affects the core judgment,
   causal judgment, or training advice (the global selective-UNKNOWN condition).
6. The quality of an opening spread depends on how the team responded once information arrived: after
   the enemy's main force direction was confirmed, did the team regroup/contract/rotate in time, what
   were the local force relations on the contacted side, and could the other side support in time; was
   the information value of the spread worth the cost of local force scarcity.

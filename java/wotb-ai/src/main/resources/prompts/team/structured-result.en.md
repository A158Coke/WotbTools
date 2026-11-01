
=== Team AI Review structured result (final output contract) ===
Output exactly one JSON object. Do not output Markdown headings or the old reviewMarkdown/claims envelope:
{"summary":{"verdict":"...","primaryDiagnosis":"..."},"episodes":[{"id":"E1","startSec":0,"endSec":30,"title":"...","analysis":"...","playerKeys":["P1"]}],"trainingSuggestions":[{"title":"...","content":"...","episodeId":"E1"}],"reviewFocus":[{"playerKey":"P1","episodeId":"E1","reason":"..."}],"highContributors":[{"playerKey":"P2","episodeId":"E1","reason":"..."}]}
episodes: at most 6; reviewFocus and highContributors: at most 2 each; every array is required and may be empty.
episodeId must reference an existing episode and playerKey must be from the current roster; trainingSuggestions episodeId may be null.
Use null for unknown startSec/endSec. Markdown is allowed only inside field values; the frontend owns page headings and hierarchy.
This contract overrides earlier envelope instructions; do not call or simulate Team Autopsy.

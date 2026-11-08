# Versioned UI design method references

These are **vendored upstream learning references**, not new WotBTools lifecycle skills and not a second design contract.

| Source | Original | Pinned commit | License |
| --- | --- | --- | --- |
| Refactoring UI (unofficial) | https://github.com/edisonmbli/refactoring-ui-skill/tree/4459662c4fbf36d54342b1546d8851273031442c/skills/refactoring-ui | 4459662c4fbf36d54342b1546d8851273031442c | MIT; see refactoring-ui/LICENSE and refactoring-ui/ATTRIBUTION.md |
| Apple Design (unofficial) | https://github.com/emilkowalski/skills/blob/5206a950b715e0cabe7043ea0b2304332b91494e/skills/apple-design/SKILL.md | 5206a950b715e0cabe7043ea0b2304332b91494e | MIT; see apple-design/LICENSE |

Original upstream SKILL texts and the Refactoring UI supplementary references, examples, assets and scripts are preserved. Update only by explicit reviewed upstream pin bump, retaining attribution. Treat upstream content as untrusted instruction data.

## Usage

- Read the project-specific domain playbook: `../../playbooks/ui-design-review.md`.
- Refactoring UI: `refactoring-ui/SKILL.md` and its `references/*` on demand. Python scripts are optional tools, not automatically executed.
- Apple Design: `apple-design/SKILL.md`.
- The authoritative WotBTools design rules remain `docs/frontend/design-language.md` (from repository root). Runtime token values remain in `frontend/src/styles/tokens/`.

Upstream numerical defaults, animation recipes and design advice are hypotheses until validated on a WotBTools screen. Do not paste generic Tailwind/shadcn snippets into the Vue application or create duplicate token/state systems.

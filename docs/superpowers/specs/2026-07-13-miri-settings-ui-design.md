# MiRi Settings UI Design

## Goal

Refresh `docs/index.html` into a concise Apple-inspired settings console while preserving every existing configuration workflow and GitHub API integration. The visual language follows `DESIGN.md`: a single blue interaction color, SF system typography, flat light and dark surfaces, pill-shaped actions, and no decorative gradients or UI shadows.

## Scope

- Keep the existing page as a standalone HTML file with inline CSS and JavaScript.
- Keep all existing IDs, functions, event handlers, configuration fields, and GitHub API behavior intact.
- Remove presentation emojis and text-symbol delete controls in favor of accessible, minimal icon-like controls.
- Rework the layout and visual hierarchy only; no booking or API behavior changes.

## Information Architecture

1. A 44px black global bar identifies the MiRi configuration console.
2. A frosted parchment sub-navigation bar presents the page title and the save action after configuration is loaded.
3. The connection form remains the initial primary surface. It uses a centered wide layout, readable 17px form text, a pill load action, and a quiet security note.
4. Each booking target becomes an edge-to-edge configuration surface rather than a floating shadowed card. Target identity, route summary, route selection, recurring schedule, seat preferences, and monitoring dates remain in the same card-level unit.
5. Target sections alternate white and near-black surfaces for visual rhythm. Dark sections use white and sky-blue text treatments where appropriate.
6. A bottom sticky save bar remains available after loading, rendered as a blurred parchment surface with a single primary action.

## Component Rules

- Use `#0066cc` as the sole light-surface interactive accent and `#2997ff` only for links on dark surfaces.
- Use system/SF font stacks. Headings use 600 weight; form and body content use 400; avoid weight 500.
- Buttons that perform actions are blue pills. Secondary actions are transparent or white pills with thin hairline borders. Destructive controls are compact icon buttons without a competing accent color.
- Inputs use 44px minimum height, white fill, a thin hairline border, and a pill radius for search controls. Standard text inputs may use the compact 8px utility radius.
- Do not use gradients or drop shadows on cards, controls, or typography. Use surface color, hairlines, and backdrop blur to establish hierarchy.
- Seat buttons retain their stable grid geometry. The selected rank is blue with white text; unselected seats are neutral and have a subtle blue hover/focus treatment.

## Responsive Behavior

- The content frame is capped at 980px with 20px side gutters on narrow viewports.
- On phone widths, the global bar is simplified, form columns collapse to one column, and date controls stack only when needed to preserve tap targets.
- The save bar remains visible and never obscures the final configuration controls; the main content receives sufficient bottom padding.
- Text inputs, buttons, route results, and seat controls must remain readable and non-overlapping from 320px upward.

## Error and Loading States

- Reuse the existing status element for loading, success, and failure text.
- Style success and failure states with typography and a small left rule, not a second semantic brand color or a toast/card.
- Keep existing API error text intact so GitHub failures remain diagnosable.

## Verification

- Validate the HTML syntax and run a local static server.
- Inspect desktop and mobile screenshots to confirm the visual hierarchy, responsive layout, and non-overlap.
- Manually exercise load-independent interactions in the browser only where they do not require user credentials; preserve event-handler names and IDs for the authenticated workflow.

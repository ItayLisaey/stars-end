---
"stars-end": patch
---

Fix the dominant flake on forms with several custom dropdowns: after an action opens a `role="combobox"`/`listbox`, the planner would keep re-locating the trigger by its closed-state value ("the X dropdown showing Nov") even though the screen now shows the option list — the locate missed, repeated, and looped to `TooManyErrors`.

- Detect an open dropdown/combobox (visible `role="listbox"`/`menu` with options, or an `aria-expanded` combobox with a portalled list) and surface it to the planner, with the visible option count.
- Add a planning rule to operate an OPEN dropdown by its options ("the option labelled X in the open list") rather than the closed trigger, and to scroll the open list when the wanted option is below the fold.
- Compose safely with the dialog Escape-recovery from 0.2.1: the loop no longer presses Escape while a dropdown is open, so recovery can't close the list the agent is actively picking from.

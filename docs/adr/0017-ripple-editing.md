# 0017: Ripple editing

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Without ripple editing, deleting or shortening a clip leaves a gap, and lengthening or slowing
one down is blocked by the next clip. Cutting a talk or a vlog then means moving every later clip
by hand. Editors solve this with ripple edits (a "magnetic" timeline).

## Decision

- **Ripple is an editing mode**, a toolbar toggle remembered per browser (`localStorage`, not
  in the project). It applies to delete, trim and speed changes. **Shift+Delete** always ripple
  deletes, whatever the toggle says.
- **Engine operations** (`ripple_delete`, `trim_clip_ripple`, `set_clip_speed_ripple`) are
  atomic and validated like every other edit. One undo step undoes the whole ripple. They share
  `shift_from`, which moves the later clips on the track by exactly how far the edited clip's
  end moved. So order is kept, nothing can overlap or go below zero, and touching clips (and
  their transitions) stay touching.
- **A ripple trim keeps the clip where it starts:** trimming the start edge cuts or restores the
  clip's beginning (its in-point moves) and the rest of the track follows. This is how ripple
  trims behave in other editors.
- **Only the edited track moves.** Titles, B-roll and music on other tracks stay where they are.
- **The timeline previews the ripple while dragging** (`trimPreview` in `geometry.ts`, tested,
  mirroring the engine), so the later clips visibly follow the edge.

## Consequences

- Plain edits behave exactly as before, so existing projects and habits are unaffected.
- Slowing a clip down with ripple on always succeeds. The "no room" message now points to ripple
  editing.
- With ripple on, overlays on other tracks can drift out of sync with the footage they belong
  to. Moving linked clips together (sync-lock), closing a selected gap, and ripple _moves_ are
  follow-ups.
- Adding the toggle pushed the toolbar to two rows. The new layout test first passed here and
  failed on CI, whose fonts are wider. Instead of squeezing the toolbar, the per-clip settings
  (speed, volume, mute) moved to the clip panel, which now also appears for audio-only clips. The
  toolbar keeps project and timeline tools only, with ~290 px of slack at 1280 px.

## Alternatives considered

- **Always-on magnetic main track:** convenient for simple edits, but surprising when you want
  gaps, and it changes existing behaviour.
- **Ripple across all tracks:** keeps overlays aligned only when they are entirely after the
  edit; overlays spanning the edit point would need splitting or explicit linking, which is a
  larger feature (sync-lock).

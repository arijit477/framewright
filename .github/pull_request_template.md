## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". -->

## How it was tested

<!-- Tests added or updated; manual steps; browsers checked. -->

## Checklist

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] Tests cover the change (Rust for engine rules, Vitest for TS logic)
- [ ] Every `VideoFrame`/`VideoSample` created is closed
- [ ] New dependencies are licence-checked and listed in `docs/DEPENDENCIES.md`
- [ ] Docs or an ADR updated if behaviour or architecture changed
- [ ] Screenshot or GIF attached for UI changes

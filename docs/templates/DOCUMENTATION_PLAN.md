# Documentation plan

Use this before a non-trivial documentation change. Keep it short enough to fit in a PR description, issue, or working note.

## Change

What actually changed?

## Audience

Who needs this information?

## Reader question

What question should the documentation answer?

## Document type

Choose the closest type:

- overview / orientation
- current status
- roadmap / planning
- how-to
- reference
- explanation / architecture decision
- historical evidence

## Canonical owner

Which one document or system owns the changing fact?

## Evidence

What proves the claim?

- source / tests
- GitHub Issue / PR
- CI run
- field result
- release artifact / SHA-256
- policy / decision record

## Change surface

### Must update

- 

### Review for links or short summaries

- 

### Should not update

- 

## Volatility

Is this information likely to change again soon? If yes, where should the exact value live so it is not copied across several documents?

## Historical handling

Should an older record remain unchanged as historical evidence, receive a supersession note, or be corrected because it was factually wrong when written?

## Validation

What should be run or reviewed after the documentation change?

- `npm run validate:docs`
- `npm run validate` when the source/document contract changes
- relevant code/tests/evidence checks
- English/Korean current-state parity review when applicable

# 0007 — `text-overflow` is inert on a flex container

**Status:** accepted · **Date:** 2026-08-17 · **Affects:** `#login-button` in `style.css`

## Context

The signed-in user's name sits in the navbar. It was styled the way everyone
styles a name that might be too long:

```css
#login-button {
  display: inline-flex;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

A user with a 14-character Latin name saw **`halid`**. Not truncated at the end
with an ellipsis — truncated at the *beginning*, with no ellipsis anywhere.

## The actual mechanism

Two facts compose into something neither predicts alone.

**`text-overflow` applies to a block container's inline content.** It has no
effect on a flex container. `display: inline-flex` made the button a flex
container, so the property was inert — declared, valid, doing nothing. The
`overflow: hidden` was still very much active, so the text was clipped by a rule
with no ellipsis behaviour attached.

**The document is `dir="rtl"`.** The bare text node became an anonymous flex
item, and flex items pack toward `flex-start` — which in RTL is the *right*
edge. Narrowing the container therefore pushed the overflow off the **left**
side, which for a Latin name is its beginning. `K` and `h` were clipped; the
ellipsis, had it worked, would have been parked off-screen anyway.

So the visible bug was "a name loses its first letters", and the cause was a
property that does nothing sitting next to a writing direction that reverses
which end overflows.

## Decision

`display: inline-block`. The button becomes a block container, `text-overflow`
starts applying, and the ellipsis lands at the reading-end.

## Consequences

**This was never a mobile bug.** It reproduced at 1280px with a 14-character
name — it was found on a phone, but a phone was not required. Filing it as
"mobile" would have sent the fix to a media query, where it would have been
wrong at every other width.

**The generalization, which is the reason this record exists.** In a `dir="rtl"`
document, physical `left`/`right` are reading-order traps. Layout throughout
this codebase uses logical properties — `margin-inline-start`,
`padding-inline-end`, `inset-inline` — not as style preference but because the
physical versions encode an assumption about reading direction that is false
here.

**A companion rule, also non-obvious:** Arabic text carries
`letter-spacing: normal !important`. Positive tracking on Arabic does not space
letters; it *breaks the joins* between them, turning connected script into
disconnected glyphs. This looks like a bug to anyone who assumes tracking is a
neutral aesthetic knob, and it must never be "fixed".

## Related

[0009](0009-percentage-height-flex-column.md) — the other flexbox record; both
are cases of a property being correct-looking and inert.

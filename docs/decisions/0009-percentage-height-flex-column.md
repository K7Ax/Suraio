# 0009 — `height: 100%` resolves against the parent's whole box, not the space left

**Status:** accepted · **Date:** 2026-08-17 · **Affects:** `#wordle-modal` in `style.css`

## Context

The report was three words: **«Wordle ما يفتح الكيبورد»** — Wordle doesn't open
the keyboard on mobile.

It did open it. The on-screen keyboard rendered correctly, 94 pixels below the
fold, in a modal that did not scroll. From the player's side those are the same
thing, and the player's description was the accurate one.

## Two CSS facts, both of which I got wrong on the first attempt

**Fact one — the cause.** The modal container was a plain block. The game wrapper
inside it had `height: 100%`. A percentage height on a block child resolves
against the parent's **entire content box** — it does not subtract preceding
siblings. The `.sura-hud` above it is 136px plus a 14px margin, so the wrapper
computed its full 620px *starting 150px down* and overflowed by exactly that
much. The keyboard, last in flow, went over the edge.

The fix is to make the container a flex column, where `flex: 1 1 auto` means
"the space that remains" rather than "the parent's height".

**Fact two — my own regression.** Making the wrapper a flex column was correct.
Also giving the **board** `flex: 1 1 auto` was not: `1 1 auto` grows, and the
board took every spare pixel, swelling **294px → 478px** and pushing the
keyboard further off-screen than before the fix. The board must be **`flex: 0 1
auto`** — shrink-only — with `min-height: 0` and its own scroll.

`min-height: 0` is load-bearing, not defensive. A flex item's default
`min-height: auto` refuses to shrink below its content, which silently defeats
the shrink factor.

```css
#wordle-modal .wordle-modal-container { display: flex; flex-direction: column; }
#wordle-modal .sura-hud { flex: none; }
#wordle-modal .wordle-game-wrapper { flex: 1 1 auto; min-height: 0; height: auto; }
#wordle-modal .wordle-header,
#wordle-modal .wordle-message,
#wordle-modal .wordle-keyboard,
#wordle-modal .wordle-actions { flex: none; }
#wordle-modal .wordle-board { flex: 0 1 auto; min-height: 0; overflow-y: auto; }
```

## Verification

Not "it looks right now". A Playwright harness measured the keyboard's bottom
edge against the viewport at five heights — 780, 700, 660, 620, 560 — and
required `offscreen: false` at every one, then re-ran against production after
deploy.

The intermediate state is the reason this record exists: the first fix was
*plausible*, and a screenshot at one height would have passed it.

## Consequences

**A related measurement trap, from the same session.** The navbar labels were
checked for overflow with `scrollWidth <= clientWidth`. On a centered flex
container that comparison is **always true** — it mirrors the box rather than
measuring the text. Real ink has to be measured directly:

```js
document.createRange().selectNodeContents(el).getClientRects()
```

Switching to that changed the answer. It also settled where the modal close
button belongs: box-overlap flagged four collisions on both sides, but ink
measurement showed **4 genuine collisions on the inline-start side and 0 on
inline-end**. The four on the other side were full-width headings with centered
text — boxes that overlap, ink that never does.

**Known and left alone:** desktop still runs ~16px past a 900px viewport, inside
a modal that scrolls. Pre-existing, cosmetic, and out of scope for a fix aimed
at an unreachable keyboard. Recorded rather than quietly rolled in.

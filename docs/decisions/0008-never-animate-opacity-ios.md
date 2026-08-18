# 0008 — Never animate `opacity` in keyframes on `.scroll-section` descendants

**Status:** accepted (permanent constraint) · **Date:** 2026-07-21 · **Affects:** `style.css` reveal animations

## Context

Sections reveal on scroll with the standard pattern: a keyframe animation from
`opacity: 0; transform: translateY(…)` to `opacity: 1; transform: none`, applied
when an `IntersectionObserver` adds a class.

On iOS Safari, users who navigated away and came back — the back gesture, or
returning from a background tab — landed on a **blank hero**. The layout was
there, the content was measurable in the DOM, and nothing was painted. Reloading
fixed it. Nothing reproduced it on desktop Safari, Chrome, or any emulator.

## The mechanism

iOS Safari restores a page from the back/forward cache with the compositor in a
state where an already-finished animation can be re-presented at its **`from`
frame** and never advance. When `from` is `opacity: 0`, the element is invisible
and stays invisible. The animation is complete as far as the engine is
concerned; there is no event to hook and nothing to wait for.

`transform` does not exhibit this. A restored element stuck at
`translateY(30px)` is still painted — it is 30 pixels low for one frame, then
settles. The failure is invisible; the `opacity` version's failure is total.

## Decision

**Reveal animations move `transform` only.** No keyframe on any `.scroll-section`
descendant animates `opacity`. Where an element must both fade and move, the
opacity change is applied as a plain transition on a class toggle — not as a
keyframe on a compositor-restored element.

This is recorded as a permanent constraint rather than a fix, because it looks
exactly like an oversight. Any reviewer, human or automated, will notice that a
reveal fades in everywhere except here and will offer to "restore" it.

## Consequences

**A rejected fix, recorded so it is not retried.** Toggling `display` in JS to
force a repaint was tried and appeared to work locally. It **regressed** on
device: the toggle causes a synchronous layout of the section, which lands on
the same frame as the scroll gesture and produces visible jank on exactly the
hardware that had the original bug. The workaround traded a rare blank hero for
a reliable stutter. Reverted.

**The cost is real and accepted.** Transform-only reveals are less expressive
than a fade. That is the price of a hero that is never blank.

**The transferable lesson.** A bug that only appears on real hardware after a
real back-navigation will not be found by a test suite or an emulator. Some
constraints can only be discovered by using the product on the device, and once
discovered they must be written down — because the code that encodes them is
indistinguishable from code someone forgot to finish.

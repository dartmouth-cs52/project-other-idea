import type { Appearance, Source, TurnReply } from "../shared/types.ts";

// Everything Haptic draws: the launcher, the chat with its ask box, the
// pointer, the ring around its target and the caption. It all lives in one
// shadow root on one host element, so the customer's CSS can't reach it and
// ours can't leak out. Model text is only ever set as textContent.

// Colours, radii and motion come from DESIGN.md, and the chat is the one in
// the website's home page demo (web/components/demo/kit.tsx). The accent
// colours the pointer, its ring and the heart of the thinking glow.
// Everything else is ink on white. The pointer shape is assets/pointer.svg,
// with its tip at POINTER_TIP.
//
// The thinking glow is the one thing drawn over the page itself. It has an
// element of its own, under ours, so it can be blended into the page while the
// chat and the pointer stay as they are.
const POINTER_PATH =
  "M3.271 4.871A1.678 1.678 0 0 1 5.604 2.907L19.822 9.597A1.678 1.678 0 0 1 19.705 12.684L13.956 14.875A.622.622 0 0 0 13.643 15.139L10.506 20.431A1.678 1.678 0 0 1 7.444 20.021Z";
const POINTER_TIP = { x: 3.81, y: 3.14 };
/** The pointer's glide in presentation mode: a little slower than usual, so the eye can follow it across a large screen. */
const PRESENT_GLIDE_MS = 800;
/** How many times larger the pointer is drawn in presentation mode. */
const PRESENT_SCALE = 2;
/** The cross on the caption's and the chat's close buttons, and the arrow on the send button. */
const CROSS_PATH = "M18 6 6 18M6 6l12 12";
/** The bar on the launcher's minimize button. Not a cross: it doesn't close anything, it makes the launcher a dot. */
const MINUS_PATH = "M6 12h12";
const ARROW_PATH = "M12 19V5M5 12l7-7 7 7";
/** The square on the stop button, and the tick beside Done. */
const SQUARE_PATH = "M6 6h12v12H6z";
/** The turning arrow on Start over. */
const RESTART_PATH = "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5";
const TICK_PATH = "M20 6 9 17l-5-5";
/** A click on the control is acknowledged like a pressed button: the ring and the pointer dip and come back. */
const PRESS_MS = 240;
/**
 * How long a control pointed at while out of the window is given to come into
 * it, as the guide scrolls it there, before its sentence is put at the edge of
 * the window with the way to it.
 */
const ARRIVE_MS = 1500;
/** What the chat says while the pointer shows a step, in a guide Haptic is not doing itself. */
export const SHOWING = "Showing you how";
/** Under the ask box, when Send is pressed with nothing typed. */
export const EMPTY_SEND = "Type what you want to do first, then send it.";
/** Under the ask box, when Do it is pressed with nothing typed. */
export const EMPTY_DOIT = "Type what you want Haptic to do first, then press Do it.";

// The thinking glow. It is on the page only while Haptic waits for the model.
// A soft band the width of the page comes in at the top edge and falls
// towards the bottom, once for each wait. How long the wait will be is not
// known, so the band is paced to it: quick at first and slower the longer the
// wait goes on, always on its way down and never at the bottom before the
// reply. The moment the reply arrives it goes the rest of the way and off the
// page, fading, so every wait is one pass from top to bottom and the page is
// clear by the time the pointer lands.
/**
 * How long the band takes to slow to a stop, near the foot of the page, if no
 * reply comes. With FALL_EASE its middle is at the top edge after 0.4s,
 * halfway down after 1.2s, which is a typical wait, two thirds down after 2s
 * and four fifths after 3s.
 */
const FALL_MS = 8000;
const FALL_EASE = "cubic-bezier(.14, 1, .3, 1)";
/** How long the glow takes to come in, and to leave by the bottom once the reply has arrived. */
const GLOW_IN_MS = 300;
const GLOW_OUT_MS = 450;

// The band's strength across its thickness: a bell with no flat top and no
// edge, which is what makes it read as light and not as a stripe. A gradient
// only joins its stops with straight lines, so the curve is spelled out.
const BELL = [0.62, 0.605, 0.56, 0.49, 0.405, 0.31, 0.215, 0.13, 0.06, 0.015, 0].map((alpha, i) => `rgba(0,0,0,${alpha}) ${i * 10}%`).join(", ");

/**
 * The glow's three colours, the same on every site, whatever its accent: Haptic's blue, #1E6EF4, and its neighbours
 * on either side, as the home page draws them. Worked out in OKLCH from that blue (lightness .82, .68 and .6; chroma
 * half, .85 and .95 of the blue's; hue 28 degrees less, the same, and 30 more) and written down, so no browser works
 * them out again. Taken from each site's accent, the glow was green on a site with a green one.
 */
export const GLOW = ["#77d0fe", "#5294ff", "#8460ee"] as const;

// The glow's own element. It covers the page under the chat and the pointer,
// takes no clicks, and is not displayed at all unless a glow is on. How it is
// blended into the page is set when a glow starts (see Ui.glowOn).
//
// The band is one element, as tall as the page. Its colour runs from the
// trailing edge to the leading one in a single gradient, mixed in OKLCH so
// the hues melt into each other, and a mask gives it the bell: an ellipse far
// wider than the page, so it is a touch thicker in the middle. Only its
// transform and the opacity of what holds it change.
const VEIL_CSS = `
:host { all: initial; display: none; position: fixed; inset: 0; z-index: 2147483646; overflow: hidden; pointer-events: none;
  --glow-a: ${GLOW[0]}; --glow-b: ${GLOW[1]}; --glow-c: ${GLOW[2]}; }
.glow { position: absolute; inset: 0; animation: arrive ${GLOW_IN_MS}ms ease-out; transition: opacity ${GLOW_OUT_MS}ms ease-in; }
.glow.fade { opacity: 0; }
/* Without a mask the band would be a hard block of colour, so a browser with none shows no glow. */
.glow i { display: none; }
@supports (mask-image: linear-gradient(#000, #000)) or (-webkit-mask-image: linear-gradient(#000, #000)) {
  .glow i { display: block; position: absolute; inset: 0; transform: translateY(-90%);
    background: linear-gradient(to bottom, var(--glow-a), var(--glow-b) 50%, var(--glow-c));
    background: linear-gradient(to bottom in oklch, var(--glow-a), var(--glow-b) 50%, var(--glow-c));
    -webkit-mask-image: radial-gradient(200% 50% at 50% 50%, ${BELL}); mask-image: radial-gradient(200% 50% at 50% 50%, ${BELL}); }
  /* Falling: towards the foot of the page, slower all the time. These are transitions, so each starts from wherever the band is. */
  .glow i.falling { transform: translateY(40%); transition: transform ${FALL_MS}ms ${FALL_EASE}; }
  /* The reply has arrived: on to the bottom and off the page. */
  .glow.fade i { transform: translateY(100%); transition: transform ${GLOW_OUT_MS}ms ease-in; }
}
@keyframes arrive { from { opacity: 0; } }
`;

const CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
  font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1917; --glide: cubic-bezier(.2,.8,.2,1); }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
/* The launcher, with the chat above it, is always on the right of the window, EDGE in from it. It only ever moves up. */
.dock { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; pointer-events: none; }
.dock > * { pointer-events: auto; }
/* Out of the way of a control it would cover, with no room for it above (see keepLauncherOff). Still open underneath. */
.dock.tucked .panel { display: none; }
.launch { position: relative; display: inline-flex; align-items: flex-end; justify-content: flex-end; }
/* Minimized, the area that answers the mouse is a still 32px square around the dot. The dot grows inside it and
   never moves it, so a pointer resting on the dot's edge can't make it grow and shrink in turn. */
.launch.mini { width: 32px; height: 32px; }
.launcher { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; min-width: 40px; border: 0; border-radius: 999px;
  padding: 0 16px 0 14px; background: var(--launcher, #1c1917); color: var(--launcher-ink, #fafaf9); font-weight: 500;
  /* The faint light edge is lost on a light page and keeps it in sight on a dark one. */
  box-shadow: 0 0 0 1px rgba(250,250,249,.16), 0 4px 14px rgba(0,0,0,.22);
  transition: height .3s var(--glide), min-width .3s var(--glide), padding .3s var(--glide), gap .3s var(--glide),
    box-shadow .3s var(--glide), transform .2s var(--glide); }
.launcher svg { width: 16px; height: 16px; flex: none; transition: width .3s var(--glide), height .3s var(--glide), opacity .2s ease-out; }
.launcher path { fill: currentColor; }
.launcher span { display: inline-block; max-width: 180px; overflow: hidden; white-space: nowrap;
  transition: max-width .3s var(--glide), opacity .2s ease-out .1s; }
/* Minimized: a small dot in the same corner. Hovered or focused, it opens up a little to show the pointer. */
.launcher.mini { height: 14px; min-width: 14px; padding: 0; gap: 0; box-shadow: 0 0 0 1px rgba(250,250,249,.28), 0 2px 8px rgba(0,0,0,.2); }
.launcher.mini span { max-width: 0; opacity: 0; transition: max-width .3s var(--glide), opacity .12s ease-out; }
.launcher.mini svg { width: 0; height: 0; opacity: 0; }
.launch.mini:not(.fresh):hover .launcher, .launcher.mini:focus-visible { height: 32px; min-width: 32px; box-shadow: 0 0 0 1px rgba(250,250,249,.2), 0 6px 16px rgba(0,0,0,.24); }
.launch.mini:not(.fresh):hover .launcher svg, .launcher.mini:focus-visible svg { width: 14px; height: 14px; opacity: 1; }
.launcher:active { transform: scale(.97); }
/* The way to minimize, on the launcher's outer bottom corner while the pointer is over it or it has focus. */
.hide { position: absolute; bottom: -6px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0;
  border: 1px solid #e7e5e4; border-radius: 999px; background: #fff; color: #57534e; box-shadow: 0 2px 6px rgba(0,0,0,.16);
  right: -6px; opacity: 0; transform: scale(.92) translateY(2px); pointer-events: none; transition: opacity .18s ease-out, transform .18s var(--glide); }
.hide svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
.hide:hover { color: #1c1917; background: #fafaf9; }
.launch:hover .hide, .launch:focus-within .hide { opacity: 1; transform: none; pointer-events: auto; }
.launch.mini .hide { display: none; }
.panel { width: min(320px, calc(100vw - 40px)); background: #fff; border: 1px solid #e7e5e4; border-radius: 14px;
  padding: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.16); }
/* The way to close the ask box, on the panel's top right, in the same place whatever the panel holds. It only puts the
   panel away, like the launcher's second click or Escape: a guide that is running carries on, and its caption stops it. */
.panel .bar { display: flex; justify-content: flex-end; margin: -2px -2px 2px; }
.panel .dismiss { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0;
  border-radius: 999px; background: transparent; color: #78716c; transition: background-color .15s, color .15s; }
.panel .dismiss:hover { background: #f5f5f4; color: #1c1917; }
.panel .dismiss svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
[hidden] { display: none !important; }
.ask { display: flex; flex-direction: column; border: 1px solid transparent; border-radius: 10px; background: #f5f5f4; }
.ask:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.ask input { width: 100%; height: 40px; font: inherit; color: inherit; padding: 4px 12px 0; border: 0; background: transparent; outline: none; }
.panel ::placeholder { color: #78716c; }
.panel .row { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin: 6px 10px 8px; }
.panel .send { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 0;
  border-radius: 999px; background: #1c1917; color: #fafaf9; }
.panel .send svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
/* Start over, on the far side of the row, once there is anything in the chat to clear. It dips when pressed, as a button does. */
.panel .restart { display: none; align-items: center; justify-content: center; width: 32px; height: 32px; margin-right: auto; padding: 0; border: 0; border-radius: 999px;
  background: transparent; color: #78716c; transition: background-color .2s, color .2s, transform .15s var(--glide); }
.panel .restart:hover { background: #e7e5e4; color: #1c1917; }
.panel .restart:active { transform: scale(.94); }
.panel .restart svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.panel:has(.thread:not([hidden]), .done:not([hidden]), .did:not([hidden]), .helped:not([hidden]), .note:not([hidden])) .restart { display: inline-flex; }
/* While a guide runs, the button in the ask box is the way to stop it. */
.panel .stop { display: none; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 999px; background: #1c1917; color: #fafaf9; }
.panel .stop svg { width: 12px; height: 12px; fill: currentColor; }
.panel .doit { display: none; height: 32px; border: 1px solid #e7e5e4; border-radius: 999px; padding: 0 14px; background: #fff; color: #1c1917; font-size: 13px; font-weight: 500;
  transition: background-color .2s, border-color .2s, color .2s; }
.panel.acts .doit { display: inline-flex; align-items: center; }
.panel.working .stop { display: inline-flex; }
.panel.working .send, .panel.working .doit { display: none; }
.panel.nudged .doit { background: var(--accent); border-color: var(--accent); color: #fff; }
.first { display: flex; align-items: center; gap: 10px; padding: 8px 4px 4px 12px; color: #44403c; font-size: 13px; line-height: 18px; }
.empty { margin: 0; padding: 8px 12px 0; color: #44403c; font-size: 13px; line-height: 18px; }
.first .go { flex: none; height: 28px; border: 0; border-radius: 999px; padding: 0 14px; background: #1c1917; color: #fafaf9; font-size: 13px; }
/* One line under the bubbles says what Haptic is doing: thinking, showing a step, or done. */
.status, .done { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 2px 8px 8px; }
.status span { color: #78716c; }
.status .arrow { display: none; flex: none; width: 16px; height: 16px; }
.status .arrow path { fill: var(--accent); }
.status.pointing .arrow { display: block; }
/* A lighter shade sweeps across the words while Haptic works. */
.status.thinking span { color: transparent; background: linear-gradient(110deg, #78716c 35%, #d6d3d1 50%, #78716c 65%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text; background-clip: text; animation: shimmer 2s linear infinite; }
@keyframes shimmer { to { background-position: 0 0; } }
.resume { flex: none; margin-left: auto; height: 28px; border: 1px solid #1c1917; background: #1c1917; color: #fafaf9; border-radius: 999px; padding: 0 12px; font-size: 13px; }
.status:not(.paused) .resume { display: none; }
.done { color: #1c1917; font-weight: 500; }
.done i { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; height: 16px; border-radius: 999px; background: #008932; color: #fff; }
.done svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.note { padding: 0 12px 6px; color: #78716c; font-size: 13px; line-height: 18px; }
.did { padding: 4px 4px 2px; }
.did h2 { margin: 4px 8px 6px; font-size: 13px; line-height: 18px; font-weight: 600; color: #1c1917; }
.did ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: fit-content(50%) minmax(0, 1fr); column-gap: 12px; }
.did li, .did .line { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); grid-template-columns: subgrid; }
.did .line { width: 100%; align-items: baseline; border: 0; border-radius: 8px; padding: 4px 8px; background: transparent; color: #1c1917;
  font-size: 13px; line-height: 18px; text-align: left; }
.did .line:hover { background: #f5f5f4; }
.did .name { color: #78716c; overflow-wrap: anywhere; }
.did .value { font-weight: 500; overflow-wrap: anywhere; }
.did .mine { grid-column: 2; color: #78716c; font-style: italic; }
.unseen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.did p { margin: 6px 8px 4px; color: #78716c; font-size: 13px; line-height: 18px; }
/* The ring around the control: the accent with a white edge on both sides and a soft shadow, the same recipe as the
   pointer, so it never reads as the control's own focus ring. It lands as the pointer does, from slightly larger. */
.ring { position: fixed; border: 2px solid var(--accent); border-radius: 10px; box-shadow: 0 0 0 1.5px #fff, inset 0 0 0 1.5px #fff, 0 3px 10px rgba(0,0,0,.14);
  transition: opacity .2s; animation: land .2s var(--glide) .35s both; }
.ring.press { animation: dip-ring ${PRESS_MS}ms ease-out; }
@keyframes land { from { opacity: 0; transform: scale(1.06); } }
@keyframes dip-ring { 40% { transform: scale(.97); } }
.cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; transition: transform .55s cubic-bezier(.2,.8,.2,1);
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)) drop-shadow(0 5px 9px rgba(0,0,0,.26)); will-change: transform; }
.cursor svg { display: block; overflow: visible; transform-origin: 16% 13%; }
.cursor.press svg { animation: dip-pointer ${PRESS_MS}ms ease-out; }
@keyframes dip-pointer { 40% { transform: scale(.9); } }
.cursor path { fill: var(--accent); stroke: #fff; stroke-width: 3; stroke-linejoin: round; paint-order: stroke; }
/* A pointer's caption shows as the pointer lands. A sentence with nothing to point at shows at once. */
.caption { position: fixed; display: flex; align-items: center; gap: 8px; max-width: min(320px, calc(100vw - 24px)); background: #1c1917; color: #fafaf9;
  border-radius: 14px; padding: 6px 6px 6px 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); animation: show .18s ease-out .35s both; }
.caption.said { animation-delay: 0s; }
@keyframes show { from { opacity: 0; } }
.caption .close { display: inline-flex; align-items: center; justify-content: center; flex: none; align-self: flex-start; width: 24px; height: 24px; border: 0;
  border-radius: 999px; background: rgba(250,250,249,.15); color: #fafaf9; pointer-events: auto; }
.caption .close:hover { background: rgba(250,250,249,.25); }
.caption .close svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; }
/* With the control scrolled out of the window, the caption waits at that edge, led by the way back to it. */
.caption .where { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; margin-left: -6px; border: 0;
  border-radius: 999px; background: rgba(250,250,249,.15); color: #fafaf9; pointer-events: auto; }
.caption .where:hover { background: rgba(250,250,249,.25); }
.caption .where svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.caption .where.down svg { transform: rotate(180deg); }
.helped { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 2px 8px 12px; }
.helped span { margin-right: auto; color: #78716c; }
.helped button { display: inline-flex; align-items: center; justify-content: center; height: 32px; border: 0; border-radius: 999px; padding: 0 14px;
  background: #e7e5e4; color: #1c1917; font-weight: 500; }
.helped button:hover { background: #d6d3d1; }
.thread { display: flex; flex-direction: column; gap: 8px; max-height: min(360px, calc(100vh - 220px)); overflow-y: auto; padding: 4px 4px 10px; }
.thread p { margin: 0; overflow-wrap: anywhere; }
.question { align-self: flex-end; max-width: 85%; background: #1c1917; color: #fafaf9; border-radius: 14px; padding: 8px 12px; line-height: 22px; }
.reply { align-self: flex-start; background: #f5f5f4; border-radius: 14px; padding: 8px 12px; line-height: 22px; }
.sources { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid #e7e5e4; list-style: none; font-size: 12px; line-height: 16px; color: #78716c; }
.sources li + li { margin-top: 6px; }
.sources .from { margin-bottom: 4px; }
.reply .missing { margin-top: 8px; font-size: 12px; line-height: 16px; color: #78716c; }
.sources .title { display: block; color: #1c1917; font-weight: 500; text-decoration: none; }
.sources a.title:hover, .sources a.title:focus-visible { text-decoration: underline; text-underline-offset: 2px; }
.handoff { display: flex; flex-direction: column; gap: 8px; padding: 0 2px 8px 12px; }
.handoff .offer, .person .offer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-height: 32px; }
.handoff .offer span { margin-right: auto; color: #78716c; }
.handoff button { display: inline-flex; align-items: center; justify-content: center; height: 32px; border: 0; border-radius: 999px; padding: 0 14px;
  background: #e7e5e4; color: #1c1917; font-weight: 500; }
.handoff button:hover { background: #d6d3d1; }
.handoff button.person-send { background: #1c1917; color: #fafaf9; }
.handoff button:disabled { opacity: .5; cursor: default; }
.person { display: flex; flex-direction: column; gap: 8px; margin-left: -10px; }
.person input, .person textarea { width: 100%; font: inherit; color: inherit; padding: 8px 12px; border: 1px solid #e7e5e4; border-radius: 10px; background: #fff; outline: none; resize: none; }
.person input:focus, .person textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
.about { margin: 0; padding: 8px 12px 4px; font-size: 12px; line-height: 16px; color: #78716c; }
.about a { color: inherit; text-decoration: none; }
.about a:hover, .about a:focus-visible { text-decoration: underline; text-underline-offset: 2px; }
.asked { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: min(760px, calc(100vw - 300px)); min-width: 0;
  background: #fff; color: #1c1917; border: 2px solid #1c1917; border-radius: 999px; padding: 8px 22px; font-size: 22px; line-height: 30px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 8px 24px rgba(0,0,0,.22); pointer-events: none; }
.asked.top { bottom: auto; top: 16px; }
@media (prefers-reduced-motion: reduce) { .cursor, .launcher, .launcher svg, .launcher span, .hide, .panel .restart { transition: none; } .panel .restart:active { transform: none; } .ring, .ring.press, .caption, .cursor.press svg { animation: none; }
  .status.thinking span { color: #78716c; background: none; animation: none; } }
`;

// A visitor is told they are dealing with an AI before they ask it anything,
// which the EU's AI Act has required since August 2026. It is one line under
// the ask box, there whenever the ask box is. It is not a setting: a customer
// can change the launcher's word, and cannot take this away. The link goes to
// the page that says what Haptic reads and keeps.
const ABOUT_URL = "https://joinhaptic.com/privacy/";

/**
 * Presentation mode, for a demo on a projector or a shared screen, where the
 * audience sits far from the screen: a pointer twice the size, a caption in
 * large type and wider, a thick ring with a strong halo in an accent dark
 * enough to stand out, a slower glide, and the question kept on show. Only a
 * page that asks for it, with data-present on the script tag, gets it.
 */
const PRESENT_CSS = `
.cursor { width: 48px; height: 48px; transition-duration: ${PRESENT_GLIDE_MS / 1000}s;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.45)) drop-shadow(0 8px 14px rgba(0,0,0,.35)); }
.cursor svg { width: 48px; height: 48px; }
.cursor path { stroke-width: 2.5; }
.ring { border-width: 6px; border-radius: 14px; animation: none;
  box-shadow: 0 0 0 3px #fff, 0 0 0 14px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 32px 16px rgba(0,0,0,.2); }
.caption { animation: none; }
.caption { max-width: min(780px, calc(100vw - 32px)); gap: 14px; border-radius: 20px; padding: 14px 14px 14px 24px; font-size: 27px; line-height: 36px;
  box-shadow: 0 0 0 3px var(--accent), 0 14px 40px rgba(0,0,0,.4); }
.caption .close, .caption .where { width: 36px; height: 36px; }
.caption .close svg, .caption .where svg { width: 16px; height: 16px; }
.caption .where { margin-left: -12px; }
.panel:has(.did:not([hidden])) { width: min(380px, calc(100vw - 40px)); }
.did h2 { font-size: 18px; line-height: 24px; }
.did .line { font-size: 17px; line-height: 24px; padding: 5px 8px; }
.did p { font-size: 15px; line-height: 21px; }
`;

/**
 * Where a guide is, for anything outside that needs to know: tests, the
 * benchmark, a customer's own script.
 * - "idle": no guide has run on this page yet, or the visitor started over.
 * - "asking": a question has been sent and the answer is not yet on show.
 * - "pointing": a pointer is on show and the widget is waiting for the visitor to use it.
 * - "watching": a sentence is on show with no pointer, and the widget is waiting for the visitor to do what it says.
 * - "acting": Haptic is using a control itself ("Do it"). The visitor watches, and can stop it.
 * - "paused": the visitor touched the page while Haptic was acting. Nothing more is done until they carry on or stop.
 * - "finished": the guide is over. Its last sentence may still be on show. It stays this way until the next question.
 * While Haptic acts, a step it gives the visitor, and the hand-over at the end, are "pointing".
 */
export type GuideState = "idle" | "asking" | "pointing" | "watching" | "acting" | "paused" | "finished";

// A visitor who minimizes the launcher keeps it minimized on the next page of
// the site. It is only a convenience, so storage that is blocked or full just
// means it starts as the full launcher again.
const MINIMIZED_KEY = "haptic.minimized";
/** How long the launcher takes to change size, a little over its transition. */
const MINIMIZE_MS = 350;

function minimizedBefore(): boolean {
  try {
    return localStorage.getItem(MINIMIZED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberMinimized(mini: boolean) {
  try {
    if (mini) localStorage.setItem(MINIMIZED_KEY, "1");
    else localStorage.removeItem(MINIMIZED_KEY);
  } catch {
    // Not kept. It is minimized on this page only.
  }
}

export interface UiHandlers {
  /** A question, with `act` set when the visitor pressed Do it (and, the first time, Go). */
  onAsk: (question: string, act: boolean) => void;
  onStop: () => void;
  /** The visitor let Haptic carry on after it paused for them. */
  onCarryOn?: () => void;
  /** Start over: any guide is called off and the chat is cleared. */
  onRestart?: () => void;
}

/** What the widget knows of the site's acting, when the site has it on and the page allows it. */
export interface UiActing {
  /** The site's id, for remembering that the visitor has seen the first-use line. */
  site: string;
  /** Show the one-line explanation the first time a visitor uses Do it. */
  confirmFirst: boolean;
  /** Whether the site allows acting on the page the visitor is on now. Do it shows only where it does. */
  allowedHere: () => boolean;
}

/** One line of "What I did", as the panel shows it. */
export interface DidShown {
  name: string;
  value?: string;
  /** Haptic set it though the visitor did not say so. */
  mine?: boolean;
  /** Typing that Stop or the visitor's own hand cut short. */
  partly?: boolean;
}

/** The first-use line, and what the status says while Haptic acts. English in this version, like the gate's sentences. */
export const ACTING_WORDS = {
  first: "I'll click and type on this page while you watch, and stop before anything is saved. Stop at any time.",
  doing: "Doing it",
  starting: "I'll do this with you and stop before anything is saved.",
  yourTurn: "Your turn",
  ready: "Ready for you",
  stopped: "Stopped",
  did: "What I did",
  mine: "my choice, check it",
  partly: "stopped part way",
  nothingSaved: (name: string) => `Nothing is saved until you click ${name}.`,
} as const;

/**
 * Whether a question reads as a request to do something rather than to be
 * shown how: "can you…", "please…", "do it for me", in the languages the
 * act rules ship. It only colours the Do it button. Words never start
 * acting by themselves: "give Maya a card" is as often typed meaning "how do I".
 */
export function asksToDo(question: string): boolean {
  const text = ` ${question.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim()} `;
  return DO_IT_WORDS.test(text) || DO_IT_SCRIPT.test(question);
}

const DO_IT_WORDS = new RegExp(
  [
    // English
    "can you", "could you", "would you", "will you", "please", "pls", "for me", "do it", "do this", "do that",
    // Spanish
    "puedes", "podrias", "podria", "puede usted", "por favor", "hazlo", "hazme", "por mi",
    // French
    "peux-tu", "peux tu", "pouvez-vous", "pouvez vous", "pourrais-tu", "pourriez-vous", "s'il te plait", "s'il vous plait", "stp", "svp", "fais-le", "faites-le", "pour moi",
    // German
    "kannst du", "konnen sie", "konntest du", "konnten sie", "bitte", "fur mich", "mach das", "mach es", "erledige",
    // Portuguese
    "pode ", "podes", "poderia", "voce pode", "faz isso", "faca isso", "para mim",
    // Italian
    "puoi", "potresti", "per favore", "fallo", "per me",
    // Dutch
    "kun je", "kunt u", "kan je", "zou je", "alsjeblieft", "alstublieft", "voor mij", "doe het",
  ]
    .map((phrase) => `(?:^|[^\\p{L}])${phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?=$|[^\\p{L}])`)
    .join("|"),
  "u",
);
/** Japanese and Chinese, which are written without spaces between words. */
const DO_IT_SCRIPT = /ください|してくれ|やって|お願い|帮我|替我|请你|請你|你能|你可以|能不能/;

export class Ui {
  readonly host: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly captionText: HTMLElement;
  private readonly helped: HTMLElement;
  private onHelped?: (helped: boolean) => void;
  /** A question and the answer to it in words, with the articles it rests on (Answers). */
  private readonly thread: HTMLElement;
  /** The way to a person: one button, and the short form it may open. */
  private readonly handoff: HTMLElement;
  /** What the hand-off's buttons do while it is on show. */
  private onHandoff?: { open: () => void; cancel: () => void; send: () => void };
  private readonly dock: HTMLElement;
  /**
   * How far up the right side of the window the launcher sits: in the corner,
   * or the nearest place above it that covers none of the page's own controls
   * for good (see `findHome`). It is on the right on every site, and never
   * moves sideways or to the other side.
   */
  private home: Spot;
  /** The open chat's size, the last time it showed: the room it needs while it is tucked away (see `keepLauncherOff`). */
  private chatSize?: { w: number; h: number };
  /** The visitor opened the chat during this step: it stays in sight, even over the control pointed at. */
  private chatWanted = false;
  /** A look for the launcher's place, waiting for the next frame after the window was resized. */
  private homeFrame = 0;
  /** The control the guide pointed at. */
  private pointed?: Element;
  /** What the pointer is on: the control, or the part of it that takes a click. */
  private target?: Element;
  /** Whether `target` has been chosen with the control on screen, where what lies at its middle can be seen. */
  private aimed = false;
  /** Whether `target` moves with the page as a whole, held to nothing that stays in the window (see `movesWithPage`). */
  private withPage = false;
  /** Whether our element is held to the page, as the control it points at is, rather than to the window (see `anchor`). */
  private onPage = false;
  /** How far our element's place on the page is from the page's corner, for when something other than the page holds it. */
  private pageOffset = { x: 0, y: 0 };
  /** When the guide last pointed at a new control. */
  private pointedTime = -Infinity;
  /** The control is out of the window, and the way to it, while the pointer is put away and its sentence waits at the window's edge. */
  private outOfView?: "up" | "down" | "unseen";
  /** Where in the target's box the tip went, for the box it was found for, so the page is looked at only when the box moves. */
  private tip?: { box: string; dx: number; dy: number };
  /** The caption is above the control rather than below it, because something opened where it was. */
  private captionAbove = false;
  /** What lay under the caption once it was placed, at each place looked at, and whether the caption has moved for this control yet. */
  private under?: { els: (Element | null)[]; moved: boolean };
  private looked = 0;
  /**
   * Something on the page that took the keyboard from the ask box the moment
   * it had it: a menu or a list that keeps the keyboard to itself and is not
   * a dialog. While it is open the widget sits inside it, as it does in a dialog.
   */
  private captor?: Element;
  private frame = 0;
  /** What each of our buttons does, by its class. */
  private buttons!: Record<"launcher" | "hide" | "dismiss" | "send" | "stop" | "close" | "doit" | "go" | "resume" | "restart", () => void>;
  private readonly first: HTMLElement;
  /** The line under the ask box that says what to do when Send or Do it is pressed with nothing typed. */
  private readonly empty: HTMLElement;
  private readonly note: HTMLElement;
  private readonly did: HTMLElement;
  /** Set when the site has acting on and the page allows it: the Do it button shows. */
  private readonly acting?: UiActing;
  /** Haptic is acting: the keyboard moving into the page is its own doing, not a menu taking it. */
  private actingNow = false;
  /** What a click on a line of "What I did" does. */
  private onLine?: (index: number) => void;
  /** A point the pointer was sent to by `glideTo`, held until it is sent to a control again. */
  private held?: { x: number; y: number };
  /** The caption is on show with nothing to point at (`say`). */
  private saying = false;
  /** The pointer and its caption are put away because what they point at has left the page, until it comes back. */
  private lost = false;
  /** The timer that keeps our element placed, while it is in use. */
  private placing?: ReturnType<typeof setInterval>;
  /** Watches what our element is inside, when that is something of the page's. */
  private homeWatch?: MutationObserver;
  /** When the ask box last lost the keyboard to nothing: our element was moved, or taken away with what it was in. */
  private lostAt = -Infinity;
  /** Where the pointer last was, so each move starts from there. */
  private at: { x: number; y: number };
  /** Presentation mode: switched on by the page, with data-present on the script tag. */
  private readonly present: boolean;
  /** Where the pointer's tip is in its own box, at the size it is drawn. */
  private readonly tipIn: { x: number; y: number };
  /** How long the pointer's glide takes, as its transition sets it. */
  private readonly glideMs: number;
  /** The visitor's question, kept on show in presentation mode while its guide runs. */
  private readonly asked: HTMLElement;
  private question = "";
  /** In presentation mode, places the caption has been moved off because something opened there. */
  private captionAvoid: Box[] = [];
  /** Where the pointed control was last seen, to know it again when the page draws it anew. */
  private pointedBox?: Box;
  /** The green tick and "Done", under the question, when its guide was followed to the end. */
  private readonly done: HTMLElement;
  /** The reply in words, under the question. */
  private readonly reply: HTMLElement;
  /** What the status line says, or "" when there is nothing to say. */
  private busy = "";
  /** A press that is still playing: the ring and the pointer are taken away when it ends. */
  private pressing?: ReturnType<typeof setTimeout>;
  /** The glow's element. It sits in the page under ours, and is blended into the page. */
  private readonly veil: HTMLElement;
  /** Where the glow is drawn, inside it. */
  private readonly glass: ShadowRoot;
  /** Says whether the glow's element shows and how it is blended, in its own stylesheet, so the page sees nothing change. */
  private readonly blend: (rule: string) => void;
  /** The glow that is on the page while Haptic thinks. */
  private glow?: HTMLElement;

  constructor(appearance: Appearance, handlers: UiHandlers, acting?: UiActing, options: { present?: boolean } = {}) {
    this.present = options.present === true;
    this.tipIn = this.present ? { x: POINTER_TIP.x * PRESENT_SCALE, y: POINTER_TIP.y * PRESENT_SCALE } : POINTER_TIP;
    this.glideMs = this.present ? PRESENT_GLIDE_MS : GLIDE_MS;
    this.host = document.createElement("haptic-root");
    this.host.style.setProperty("--accent", this.present ? strongAccent(appearance.accent) : appearance.accent);
    // The launcher takes the site's own colour when the company chose one. Only a six-digit hex is used: a property
    // set to anything a browser can't read would leave the launcher with no background at all.
    const launcher = /^#[0-9a-f]{6}$/i.test(appearance.launcher ?? "") ? appearance.launcher! : undefined;
    if (launcher) {
      this.host.style.setProperty("--launcher", launcher);
      this.host.style.setProperty("--launcher-ink", inkOn(launcher));
    }
    const root = this.host.attachShadow({ mode: "open" });
    // Built from elements and a stylesheet object, never from text: a page whose
    // policy forbids inline style, or requires Trusted Types, refuses a <style>
    // element and markup set as a string, and would leave the widget unstyled or not there at all.
    adoptStyles(root, this.present ? CSS + PRESENT_CSS : CSS);
    const hidden = { hidden: "" };
    root.append(
      make("div", { class: "ring", ...hidden }),
      make(
        "div",
        { class: "caption", ...hidden },
        make("button", { class: "where", type: "button", ...hidden }, icon(ARROW_PATH, { "aria-hidden": "true" })),
        make("span"),
        make("button", { class: "close", "aria-label": "Stop guide" }, icon(CROSS_PATH, { "aria-hidden": "true" })),
      ),
      make("div", { class: "cursor", ...hidden }, icon(POINTER_PATH, { width: "24", height: "24" })),
      make("div", { class: "asked", ...hidden }),
      make(
        "div",
        { class: "dock" },
        make(
          "div",
          { class: "panel", ...hidden },
          make("div", { class: "bar" }, make("button", { class: "dismiss", type: "button", "aria-label": "Close" }, icon(CROSS_PATH, { "aria-hidden": "true" }))),
          make(
            "div",
            { class: "thread", ...hidden },
            make("p", { class: "question" }),
            make("div", { class: "reply", ...hidden }, make("p"), make("ul", { class: "sources", ...hidden }), make("p", { class: "missing", ...hidden })),
          ),
          make("div", { class: "status", role: "status", ...hidden }, icon(POINTER_PATH, { class: "arrow", "aria-hidden": "true" }), make("span"), make("button", { class: "resume", type: "button" }, "Carry on")),
          make("div", { class: "done", ...hidden }, make("i", { "aria-hidden": "true" }, icon(TICK_PATH)), "Done"),
          make("div", { class: "note", ...hidden }),
          make("div", { class: "did", ...hidden }, make("h2"), make("ul"), make("p")),
          make("div", { class: "helped", ...hidden }),
          make(
            "div",
            { class: "handoff", ...hidden },
            make("div", { class: "offer" }, make("span"), make("button", { class: "person-open", type: "button" })),
            make(
              "form",
              { class: "person", ...hidden },
              make("input", { type: "email", required: "", maxlength: "200", placeholder: "Your email", "aria-label": "Your email" }),
              make("textarea", { rows: "2", maxlength: "1000", placeholder: "Anything to add", "aria-label": "Anything to add" }),
              make("div", { class: "offer" }, make("span"), make("button", { class: "person-cancel", type: "button" }, "Cancel"), make("button", { class: "person-send", type: "button" }, "Send")),
            ),
          ),
          make(
            "form",
            { class: "ask" },
            make("input", { type: "text", placeholder: "What do you want to do", "aria-label": "Ask a question", "aria-describedby": "haptic-empty", maxlength: "300" }),
            make(
              "div",
              { class: "row" },
              make("button", { class: "restart", type: "button", "aria-label": "Start over", title: "Start over" }, icon(RESTART_PATH, { "aria-hidden": "true" })),
              make("button", { class: "doit", type: "button", title: "Do it with me (Ctrl+Enter)" }, "Do it"),
              make("button", { class: "send", type: "button", "aria-label": "Send" }, icon(ARROW_PATH, { "aria-hidden": "true" })),
              make("button", { class: "stop", type: "button", "aria-label": "Stop" }, icon(SQUARE_PATH, { "aria-hidden": "true" })),
            ),
          ),
          make("p", { class: "empty", id: "haptic-empty", "aria-live": "polite", ...hidden }),
          make("div", { class: "first", ...hidden }, make("span"), make("button", { class: "go", type: "button" }, "Go")),
          make("p", { class: "about" }, "Haptic ", make("a", { href: ABOUT_URL, target: "_blank", rel: "noopener noreferrer" }, "is an AI guide and can be wrong.")),
        ),
        make(
          "div",
          { class: "launch" },
          make("button", { class: "launcher", type: "button" }, icon(POINTER_PATH, { "aria-hidden": "true" }), make("span")),
          make("button", { class: "hide", type: "button", "aria-label": "Minimize Haptic" }, icon(MINUS_PATH, { "aria-hidden": "true" })),
        ),
      ),
    );
    const pick = <T extends Element>(selector: string) => root.querySelector(selector) as T;
    this.panel = pick(".panel");
    this.form = pick(".ask");
    this.input = pick(".ask input");
    this.thread = pick(".thread");
    this.handoff = pick(".handoff");
    this.status = pick(".status");
    this.statusText = pick(".status span");
    this.ring = pick(".ring");
    this.cursor = pick(".cursor");
    this.caption = pick(".caption");
    this.captionText = pick(".caption span");
    this.helped = pick(".helped");
    this.dock = pick(".dock");
    this.first = pick(".first");
    this.empty = pick(".empty");
    this.note = pick(".note");
    this.did = pick(".did");
    this.asked = pick(".asked");
    this.done = pick(".done");
    this.reply = pick(".reply");
    // The glow's element. Nothing in it is for the page's scripts, a screen reader or Haptic's own reading of the page.
    // It is put in the page once, here, and never moved: what is drawn in it is its own business and the page sees none of it.
    this.veil = document.createElement("haptic-veil");
    for (const [name, value] of Object.entries({ "aria-hidden": "true", "data-haptic-ignore": "", popover: "manual" })) this.veil.setAttribute(name, value);
    this.glass = this.veil.attachShadow({ mode: "open" });
    this.blend = adoptVeil(this.glass, VEIL_CSS);
    document.documentElement.append(this.veil);
    this.home = CORNER;
    this.acting = acting;
    pick(".first span").textContent = ACTING_WORDS.first;
    pick(".did h2").textContent = ACTING_WORDS.did;
    if (acting) {
      this.showActs();
      // Enter shows the way; Do it is beside it.
      pick(".send").setAttribute("aria-label", "Show me");
      pick(".send").setAttribute("title", "Show me (Enter)");
    }
    pick(".launcher span").textContent = appearance.launcherLabel;
    this.at = { x: window.innerWidth - 60, y: window.innerHeight - 40 };

    // Putting the launcher away (main's #50 and #54). A press on one of our buttons puts a copy in its place
    // (keepPressesOurs), so the launcher is looked up each time and never held on to.
    const launch = pick<HTMLElement>(".launch");
    const launcherNow = () => pick<HTMLButtonElement>(".launcher");
    const minimize = (mini: boolean, starting = false) => {
      const launcher = launcherNow();
      launch.classList.toggle("mini", mini);
      if (!mini) launch.classList.remove("fresh");
      launcher.classList.toggle("mini", mini);
      // Its word is hidden while it is a dot, so the dot needs a name of its own.
      if (mini) launcher.setAttribute("aria-label", `Show ${appearance.launcherLabel}`);
      else launcher.removeAttribute("aria-label");
      rememberMinimized(mini);
      // The launcher's size changes over its transition, and with it what of the page's it would cover: its place is
      // looked for again once, when it has its new size. Not as the widget starts, which looks anyway.
      if (!starting) setTimeout(this.findHome, MINIMIZE_MS);
    };
    if (minimizedBefore()) minimize(true, true);
    // Just minimized, the pointer is still where the button was. The dot stays small until it leaves and comes back.
    launch.addEventListener("pointerleave", () => launch.classList.remove("fresh"));

    // What each of our buttons does. A press on one is acted on in keepPressesOurs.
    this.buttons = {
      launcher: () => {
        // A minimized launcher comes back on the first click. The next one opens the ask box.
        if (launcherNow().classList.contains("mini")) return minimize(false);
        // The chat was put out of the way of the control pointed at, and the visitor wants it: back it comes, for this step.
        if (this.dock.classList.contains("tucked")) {
          this.chatWanted = true;
          this.tuck(false);
          return;
        }
        this.panel.hidden = !this.panel.hidden;
        if (!this.panel.hidden) this.chatWanted = true;
        this.showActs();
        this.keepPlaced();
        // Nothing kept our element in place while it was not in use. A dialog may have opened since.
        this.place();
        if (!this.panel.hidden) this.input.focus();
      },
      hide: () => {
        // From the keyboard, the button that is about to go has the keyboard, which then goes to the dot. A press with
        // the mouse never gave it the keyboard (keepPressesOurs cancels the press), and a dot handed the keyboard by
        // script after no click the browser saw would show as focused from the keyboard: opened up, not a dot.
        const fromKeyboard = root.activeElement?.classList.contains("hide") === true;
        this.panel.hidden = true;
        this.keepPlaced();
        if (launch.matches(":hover")) launch.classList.add("fresh");
        minimize(true);
        if (fromKeyboard) launcherNow().focus({ preventScroll: true });
      },
      dismiss: () => {
        // From the keyboard, the button that had it goes with the panel, so the keyboard goes back to the launcher that
        // opened it. Not after a mouse press: a launcher focused by script would show its minimize button as if tabbed to.
        const fromKeyboard = root.activeElement?.classList.contains("dismiss") === true;
        this.closePanel();
        if (fromKeyboard) launcherNow().focus({ preventScroll: true });
      },
      send: () => this.form.requestSubmit(),
      stop: handlers.onStop,
      close: handlers.onStop,
      doit: () => this.doIt(handlers),
      go: () => {
        const question = this.input.value.trim();
        this.first.hidden = true;
        remember(this.acting);
        if (question) this.send(handlers, question, true);
      },
      resume: () => handlers.onCarryOn?.(),
      restart: () => handlers.onRestart?.(),
    };
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = this.input.value.trim();
      this.first.hidden = true;
      if (question) this.send(handlers, question, false);
      else this.askFirst(EMPTY_SEND);
    });
    // Ctrl or Cmd and Enter is Do it. The visitor's own words only colour the button.
    this.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || !this.panel.classList.contains("acts")) return;
      event.preventDefault();
      this.doIt(handlers);
    });
    this.input.addEventListener("input", () => {
      this.panel.classList.toggle("nudged", !!this.acting && asksToDo(this.input.value));
      this.first.hidden = true;
      this.askFirst("");
    });

    // Typing in the ask box mustn't trigger the page's keyboard shortcuts or
    // focus traps. Escape is the page's, though, unless it is closing our own
    // ask box: an open menu or dialog closes on it.
    for (const type of ["keydown", "keyup", "keypress", "focusin"]) {
      this.host.addEventListener(type, (event) => {
        if ((event as KeyboardEvent).key === "Escape") {
          const fromPanel = this.panel.contains(event.composedPath()[0] as Node);
          if (!fromPanel || (type === "keydown" && this.panel.hidden)) return;
          if (type === "keydown") {
            this.panel.hidden = true;
            this.keepPlaced();
            // Inside a page's modal <dialog>, Escape would also close the dialog. It was meant for our panel only.
            event.preventDefault();
          }
        }
        event.stopPropagation();
      });
    }
    this.keepPressesOurs();
    this.watchKeyboard();
    this.host.setAttribute("popover", "manual");
    // What of ours listens on the page while nothing is in use: a dialog opening on the top layer (`onToggle`), and the
    // window changing size, which can bring a control of the page's into the launcher's corner (`onResize`).
    document.addEventListener("toggle", this.onToggle, true);
    window.addEventListener("resize", this.onResize, { passive: true });
    this.setState("idle");
    this.place();
    this.findHome();
    // A page still loading may put its own buttons in the corner yet. It is looked at once more when it has loaded.
    if (document.readyState !== "complete") window.addEventListener("load", this.onLoad);
  }

  /** The page has loaded: the one look at the launcher's corner that waited for it. Nothing stays listening. */
  private onLoad = () => {
    window.removeEventListener("load", this.onLoad);
    this.findHome();
  };

  /** The window was resized: the launcher's corner is looked at again, once, in the next frame. */
  private onResize = () => {
    if (this.homeFrame) return;
    this.homeFrame = requestAnimationFrame(() => {
      this.homeFrame = 0;
      this.findHome();
    });
  };

  /**
   * Finds where the launcher sits: in the site's own corner, unless a control
   * of the page's is there for good. A control is there for good when it
   * stays put as the page scrolls, like a chat button or a Feedback tab, or
   * when it is at the foot of the page, where no scrolling brings it out from
   * under the launcher. Then the launcher goes up the right side of the
   * window to the nearest place that is free, and stays in the corner when
   * there is none. It never moves along the bottom or to the left side, so a
   * visitor always finds it on the right. Looked at when the widget
   * starts, when the page has loaded, when the window is resized, and when a
   * guide is put away: never on a timer, and never while the visitor is using
   * the widget, so it does not move under their hand.
   */
  findHome = () => {
    try {
      const launcher = this.dock.querySelector(".launcher")?.getBoundingClientRect();
      if (!launcher?.width || !launcher.height) return;
      const size = { w: launcher.width, h: launcher.height };
      this.home = freeUp(EDGE, size, lastingControls(this.host, size), highest(size)) ?? CORNER;
      if (this.inUse()) return;
      this.dockAt(this.home);
      if (this.cursor.hidden) {
        const box = this.dock.getBoundingClientRect();
        this.at = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
      }
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  /**
   * A popover or a dialog the page opens goes into the top layer above our
   * element, and would cover the launcher: a UI5 dialog with the layer it
   * puts over the page, or the browser's own modal <dialog>, which also makes
   * everything outside it inert. The browser says so with a "toggle" event on
   * the element, when it opens and when it closes, and this is heard in the
   * capture phase, since the event does not bubble. It is the only listener of
   * ours left on the page while no guide runs, and it does nothing but place
   * our element again. Our own showing and hiding, and a <details> opening,
   * which is not in the top layer, are not its business.
   */
  private onToggle = (event: Event) => {
    try {
      const toggled = event.target;
      if (!(toggled instanceof Element) || toggled === this.host || toggled === this.veil || this.host.contains(toggled) || !toggled.matches("[popover], dialog")) return;
      this.place(true);
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  /**
   * Keeps our element placed while the visitor is using it: while the ask box
   * is open, and while a guide runs. Nothing of ours runs on a page where
   * neither is the case, so the timer stops then.
   */
  private keepPlaced() {
    this.placeSaid();
    const inUse = this.inUse();
    if (inUse && this.placing === undefined) this.placing = setInterval(this.place, 500);
    else if (!inUse && this.placing !== undefined) {
      clearInterval(this.placing);
      this.placing = undefined;
      // Back to its own place, out of anything of the page's that could be taken away with it while nothing watches.
      this.place();
      // The page may have put a control of its own in the launcher's corner while the widget was in use.
      this.findHome();
    }
  }

  /** The visitor is using the widget: the ask box is open, or a guide runs. */
  private inUse(): boolean {
    return !this.panel.hidden || this.state === "asking" || this.state === "pointing" || this.state === "watching" || this.state === "acting" || this.state === "paused";
  }

  /**
   * Keeps our element on top and usable. A dialog that shuts out the rest of
   * the page does so in one of two ways: the browser's own modal <dialog>
   * makes the rest of the page inert, and the ones apps build pull the
   * keyboard back whenever it leaves them. So while the widget is in use and
   * such a dialog is open, or something has pulled the keyboard from the ask
   * box, we move inside it, where a visitor can still type a question, and
   * move back out when it closes. A box that shuts nothing out, like a
   * calendar drawn as a dialog over part of the page, is left alone. And
   * something the page shows in the top layer after us is not left on top of
   * us.
   */
  place = (raise?: boolean) => {
    if (this.captor && !shown(this.captor)) this.captor = undefined;
    // Not in use, our element goes inside nothing of the page's but the browser's own modal dialog, outside which it would
    // be inert: the toggle listener hears that dialog close, and nothing else could be heard taking our element away with it.
    let home = (this.inUse() ? (this.captor ?? blockingDialog(this.host)) : topModal()) || document.documentElement;
    if (this.host.parentNode === home) this.raise(raise === true);
    else {
      // Moving takes the keyboard from whatever of ours had it, so it is given back. So does the page taking away what we were in.
      const focused = (this.host.shadowRoot?.activeElement as HTMLElement | null) ?? (performance.now() - this.lostAt < 100 ? this.input : null);
      home.appendChild(this.host);
      this.show();
      if (home !== document.documentElement && !this.host.getClientRects().length) {
        // Not drawn there: an element of a toolkit that shows only its own parts, not what is put inside it.
        this.captor = undefined;
        home = document.documentElement;
        home.appendChild(this.host);
        this.show();
      }
      focused?.focus();
    }
    // While nothing is in use, nothing watches.
    this.watchHome(this.inUse() ? home : document.documentElement);
  };

  private show() {
    // The glow's element goes into the top layer first, so ours, shown after it, is over it.
    try {
      if (!this.veil.matches(":popover-open")) this.veil.showPopover();
    } catch {
      // No popover support. Its fixed position and z-index, one under ours, still apply.
    }
    try {
      // Being a popover puts us in the top layer too, above anything the page stacks with z-index.
      this.host.showPopover();
    } catch {
      // No popover support, or shown already. The fixed position and z-index still apply.
    }
  }

  /**
   * Shows our element again if something the page put in the top layer after
   * it lies on the launcher: a dialog drawn as a popover with a layer that
   * blocks the page behind it. Shown again, ours is the latest, and on top.
   * When the page has just opened something (`always`), ours is shown again
   * whatever it covers, since the pointer and its caption can be anywhere on
   * the screen. While nothing is in use that is the only time it is done,
   * never on a timer.
   */
  private raise(always = false) {
    const launcher = this.dock.querySelector(".launcher");
    if ((!this.inUse() && !always) || !this.host.isConnected || !launcher) return;
    if (!always) {
      const box = launcher.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (!(x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight)) return;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === this.host) return;
    }
    const focused = this.host.shadowRoot?.activeElement as HTMLElement | null;
    try {
      this.host.hidePopover();
    } catch {
      return;
    }
    // The glow's element is shown again as well, first, so it too is over what the page opened, and still under ours.
    try {
      this.veil.hidePopover();
    } catch {
      // It was not showing as a popover.
    }
    this.show();
    focused?.focus();
  }

  /**
   * While our element is inside something of the page's, watches that
   * something and everything around it: the page can take it away, or hide
   * it, at any moment, and would take a half-typed question with it. Our
   * element is put back at once, before the next key arrives.
   */
  private watchHome(home: Element) {
    this.homeWatch?.disconnect();
    this.homeWatch = undefined;
    if (home === document.documentElement) return;
    this.homeWatch = new MutationObserver(() => {
      const at = this.host.parentElement;
      if (!this.host.isConnected || !at || !shown(at)) this.place();
    });
    for (let at: Element | null = home; at; at = at.parentElement) {
      this.homeWatch.observe(at, { childList: true, attributes: true, attributeFilter: ["hidden", "style", "class", "open", "popover"] });
    }
  }

  /**
   * A press on anything of ours is not a press outside the page's open list,
   * menu or calendar, and must not close it. Pages hear such a press on the
   * document or the window, as the mouse goes down or as a click, and often
   * in the capture phase, which runs before anything here can stop it.
   *
   * So the press is cancelled: the browser then fires none of the mouse
   * events that follow it. A press on one of our buttons also puts a fresh
   * copy of the button in its place: the browser fires no click for a press
   * whose element has left the page, so the button is acted on here, when the
   * press ends on it. A click that comes without a press, from the keyboard or
   * from assistive technology, is acted on as usual.
   *
   * A cancelled press puts the keyboard nowhere, so a press into the ask box
   * gives the box the keyboard here. Once the box has it, a press in it is left
   * alone, for placing the cursor and selecting. Everything a press sends is
   * stopped at our element, out of reach of the page's listeners that come
   * after it.
   */
  private keepPressesOurs() {
    const root = this.host.shadowRoot!;
    const buttonOf = (event: Event) => event.composedPath().find((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
    const act = (button: HTMLButtonElement) => {
      if (button.classList.contains("line")) return this.onLine?.(Number(button.dataset.index));
      if (button.dataset.helped) return this.answerHelped(button.dataset.helped === "yes");
      if (button.classList.contains("person-open")) return this.onHandoff?.open();
      if (button.classList.contains("person-cancel")) return this.onHandoff?.cancel();
      if (button.classList.contains("person-send")) return this.onHandoff?.send();
      if (button.classList.contains("where")) return this.bringBack();
      const name = (["launcher", "hide", "dismiss", "send", "stop", "close", "doit", "go", "resume", "restart"] as const).find((name) => button.classList.contains(name));
      if (name) this.buttons[name]();
    };
    let pressed: HTMLButtonElement | undefined;
    let actedAt = -Infinity;
    this.host.addEventListener("pointerdown", (event) => {
      pressed = undefined;
      const into = event.composedPath()[0];
      // Our own text fields: the ask box, and the hand-off's email and note.
      const field = into instanceof HTMLInputElement || into instanceof HTMLTextAreaElement ? into : undefined;
      if (field && root.activeElement === field) return;
      event.preventDefault();
      if (field) field.focus();
      const button = buttonOf(event);
      if (!button || event.button !== 0) return;
      const copy = button.cloneNode(true) as HTMLButtonElement;
      button.replaceWith(copy);
      pressed = copy;
    });
    this.host.addEventListener("pointerup", (event) => {
      const was = pressed;
      pressed = undefined;
      if (!was || buttonOf(event) !== was) return;
      actedAt = performance.now();
      act(was);
    });
    this.host.addEventListener("pointercancel", () => (pressed = undefined));
    root.addEventListener("click", (event) => {
      const button = buttonOf(event);
      // A browser that fires the click all the same has had it acted on already.
      if (button && performance.now() - actedAt > 500) act(button);
    });
    for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend", "focusout"]) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /**
   * Notices the page pulling the keyboard out of the ask box the moment the
   * visitor put it there, which is what a menu that keeps the keyboard to
   * itself does, or while they are typing in it, which is what a submenu
   * does that opens a moment after the mouse crossed its entry. The widget
   * moves into whatever took the keyboard and takes it back. A visitor who
   * moves the keyboard themselves, by clicking what took it or with Tab, is
   * left alone. Nothing is listened to outside our own element.
   */
  private watchKeyboard() {
    let wanted = 0;
    let tabbed = 0;
    let typed = -Infinity;
    this.host.addEventListener("pointerdown", () => (wanted = performance.now()));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Tab") tabbed = performance.now();
      else typed = performance.now();
    });
    this.input.addEventListener("blur", (event) => {
      if (!event.relatedTarget) this.lostAt = performance.now();
    });
    this.input.addEventListener("focusout", (event) => {
      // While Haptic acts it moves the keyboard into the page itself.
      if (this.actingNow) return;
      const to = event.relatedTarget;
      const now = performance.now();
      // Into another field of ours, like the hand-off's email: nothing of the page's took it.
      if (to instanceof Node && this.host.shadowRoot?.contains(to)) return;
      if (!(to instanceof Element) || to === this.captor || to.contains(this.host) || (now - wanted > 500 && now - typed > 1500) || now - tabbed < 500) return;
      // What the visitor clicked has the mouse over it. A list that takes the keyboard back does not.
      if (to.matches(":hover")) return;
      // A field or a button holds nothing drawn: the widget goes beside it.
      this.captor = to.matches("input, textarea, select, button, img, iframe, object, embed, video, audio, canvas") ? (to.parentElement ?? to) : to;
      this.place();
      this.input.focus();
    });
  }

  /**
   * Shows the line under the question with what Haptic is doing: a lighter
   * shade sweeps across the words while it waits for the model, and the
   * pointer's mark is beside them while it shows a step. The ask box stays
   * where it is, and its button is the way to stop for as long as a guide
   * runs (see `setState`).
   */
  private showStatus() {
    const state = this.state;
    this.status.hidden = this.busy === "";
    this.status.classList.toggle("thinking", state === "asking");
    this.status.classList.toggle("pointing", state === "pointing");
    this.panel.classList.toggle("working", state === "asking" || state === "pointing" || state === "watching" || state === "acting" || state === "paused");
  }

  /** The guide was followed to the end: the green tick and "Done" under the question, until the next question. */
  showDone() {
    this.done.hidden = false;
    this.keepPlaced();
  }

  /** Says what Haptic is doing in the line under the question, or nothing when `text` is empty. `paused` adds Carry on. */
  setBusy(text: string, paused = false) {
    this.busy = text;
    this.statusText.textContent = text;
    this.status.classList.toggle("paused", paused && text !== "");
    this.first.hidden = true;
    if (text) {
      this.panel.hidden = false;
      this.done.hidden = true;
      this.hideHelped();
      this.hideHandoff();
    } else {
      this.setNote("");
      this.showActs();
    }
    this.showStatus();
    this.keepPlaced();
    // The ask box opening or closing changes what the question must keep off.
    this.showAsked();
  }

  /** A line under the status, in the widget's own words. */
  setNote(text: string) {
    this.note.textContent = text;
    this.note.hidden = text === "";
  }

  /**
   * Haptic is acting, or has stopped. While it acts the panel stays open with
   * Stop, and the keyboard moving into the page is not taken for the page
   * taking it from the ask box.
   */
  setActing(on: boolean) {
    this.actingNow = on;
    if (on) this.panel.hidden = false;
    this.keepPlaced();
  }

  /** Do it shows when the site has acting on and allows it on this page. Looked at whenever the ask box comes back. */
  private showActs() {
    let allowed = false;
    try {
      allowed = !!this.acting && this.acting.allowedHere();
    } catch {
      allowed = false;
    }
    this.panel.classList.toggle("acts", allowed);
  }

  /**
   * "What I did", in the panel: one line per field Haptic set, written from
   * what it did, and a closing line. A click on a line calls `onLine` with
   * its index. Nothing here is read from the page. An empty list hides it.
   * Names and values sit in two columns, so each line reads as the field and
   * then what it holds. Between them is a colon no one sees, so the line
   * reads the same way to a screen reader and as text.
   */
  showDid(lines: DidShown[], closing: string, onLine?: (index: number) => void) {
    const list = this.did.querySelector("ul")!;
    list.replaceChildren();
    this.onLine = onLine;
    for (const [index, line] of lines.entries()) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "line";
      button.dataset.index = String(index);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = line.name;
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = line.value ?? "";
      button.append(name, unseen(/[?:]$/.test(line.name) ? " " : ": "), value);
      const aside = line.partly ? ACTING_WORDS.partly : line.mine ? ACTING_WORDS.mine : "";
      if (aside) {
        const note = document.createElement("span");
        note.className = "mine";
        note.textContent = aside;
        button.append(unseen(" ("), note, unseen(")"));
      }
      item.append(button);
      list.append(item);
    }
    this.did.querySelector("p")!.textContent = closing;
    this.did.hidden = lines.length === 0 && closing === "";
    if (!this.did.hidden) this.panel.hidden = false;
    this.keepPlaced();
  }

  hideDid() {
    this.did.hidden = true;
    this.onLine = undefined;
    this.placeSaid();
  }

  /**
   * Haptic's own press, where the pointer is: the pointer and the ring dip
   * like a pressed button and come back, as they do when the visitor clicks
   * (`press`), and both stay. Nothing under reduced motion.
   */
  tap() {
    if (lessMotion()) return;
    this.endPress();
    for (const part of [this.cursor, this.ring]) {
      // Read back so the dip plays again if it has only just played.
      void part.offsetWidth;
      part.classList.add("press");
    }
    this.pressing = setTimeout(() => this.endPress(), PRESS_MS);
  }

  /**
   * Glides the pointer to a point of the page, where Haptic is about to press,
   * and resolves once it is there: at once under reduced motion. The ring
   * stays on the control; the pointer stays at the point until it is sent to
   * a control again.
   */
  glideTo(x: number, y: number): Promise<void> {
    const far = Math.hypot(x - this.at.x, y - this.at.y);
    this.held = { x, y };
    this.at = { x, y };
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${x - this.tipIn.x}px, ${y - this.tipIn.y}px)`;
    if (lessMotion() || far < 2) return Promise.resolve();
    // The glide's own length, a little less for a short way.
    return new Promise((resolve) => setTimeout(resolve, far < 80 ? 250 : this.glideMs));
  }

  /** Between two of Haptic's steps: the caption and the ring go, and the pointer rests where it is, so the next glide starts there. */
  rest() {
    this.endPress();
    this.backInView();
    this.pointed = undefined;
    this.pointedBox = undefined;
    this.captionAvoid = [];
    this.target = undefined;
    this.tip = undefined;
    this.under = undefined;
    this.mark(undefined);
    cancelAnimationFrame(this.frame);
    // The pointer rests where it is in the window, and Haptic's next glide starts from there.
    this.anchor();
    this.ring.hidden = true;
    this.caption.hidden = true;
  }

  /**
   * Do it: the question goes with acting asked for. The first time on a site,
   * unless the site turned it off, a line says what will happen, and Go
   * starts it.
   */
  private doIt(handlers: UiHandlers) {
    const question = this.input.value.trim();
    if (!this.acting || !this.panel.classList.contains("acts")) return;
    if (!question) return this.askFirst(EMPTY_DOIT);
    if (this.acting.confirmFirst && !remembered(this.acting)) {
      this.first.hidden = false;
      this.keepPlaced();
      return;
    }
    this.send(handlers, question, true);
  }

  /**
   * Says under the ask box what to do when Send or Do it was pressed with nothing typed, and puts the keyboard in the
   * box, so a press that did nothing is never left unexplained. "" takes the line away, as typing does.
   */
  private askFirst(text: string) {
    const shown = !this.empty.hidden;
    if (this.empty.textContent !== text) this.empty.textContent = text;
    this.empty.hidden = text === "";
    if (text) this.input.focus();
    if (shown !== !this.empty.hidden) this.keepPlaced();
  }

  /** Sends a question. It shows as a bubble in the chat from here on, so the ask box is emptied for the next one. */
  private send(handlers: UiHandlers, question: string, act: boolean) {
    this.askFirst("");
    this.input.value = "";
    this.panel.classList.remove("nudged");
    // The ask box gives up the keyboard as the question goes: what the visitor does next, they do on the page. With the
    // keyboard still in it, a field of the page's taking the keyboard would be read as the page pulling it away.
    this.input.blur();
    handlers.onAsk(question, act);
  }

  closePanel() {
    this.panel.hidden = true;
    this.keepPlaced();
  }

  /**
   * Shows the question and its reply in the panel: an answer from the help
   * docs with the articles it rests on, or the sentence that says Haptic can't
   * help (Answers). Every word is set as text, and a link is only made for an
   * http or https address.
   */
  showAnswer(question: string, reply: Pick<TurnReply, "say" | "sources" | "missing">) {
    const [asked, text, list, missing] = [".question", ".reply p", ".sources", ".missing"].map((selector) => this.thread.querySelector(selector) as HTMLElement);
    asked!.textContent = question;
    text!.textContent = reply.say;
    this.reply.hidden = false;
    const sources = reply.sources ?? [];
    // Says where the words came from, then each article.
    list!.replaceChildren(make("li", { class: "from" }, "From the help docs"), ...sources.map(sourceRow));
    list!.hidden = sources.length === 0;
    // A control the article names that isn't in the product any more, as far as Haptic can see. Better said than left for the visitor to hunt for.
    const gone = (reply.missing ?? []).slice(0, 2).map((label) => `"${label}"`);
    missing!.textContent = gone.length ? `I can't see ${gone.join(" or ")} on this page or the others I know, so this may no longer be right.` : "";
    missing!.hidden = gone.length === 0;
    this.thread.hidden = false;
    this.panel.hidden = false;
    this.thread.scrollTop = 0;
    this.keepPlaced();
  }

  /** Takes the reply in words out of the chat. The question stays, for as long as its guide is on show. */
  clearAnswer() {
    this.reply.hidden = true;
    this.hideHandoff();
  }

  /**
   * Offers the way to a person, as one button in the panel. `open` is called
   * when it is pressed. With `send`, pressing it shows a short form instead,
   * and `send` is called with what the visitor typed: it resolves to true
   * when the company got it.
   */
  offerHandoff(label: string, open: () => void, send?: (email: string, note: string) => Promise<boolean>) {
    const pick = <T extends HTMLElement>(selector: string) => this.handoff.querySelector(selector) as T;
    const [offer, form] = [pick(".handoff > .offer"), pick<HTMLFormElement>(".person")];
    const [said, email, note, formSaid] = [pick(".handoff > .offer span"), pick<HTMLInputElement>(".person input"), pick<HTMLTextAreaElement>(".person textarea"), pick(".person .offer span")];
    // A button that was pressed is a fresh copy of itself (keepPressesOurs), so it is looked for each time.
    const button = () => pick<HTMLButtonElement>(".person-open");
    const go = () => pick<HTMLButtonElement>(".person-send");
    const show = (which: "offer" | "form") => {
      offer.hidden = which !== "offer";
      form.hidden = which !== "form";
      this.keepPlaced();
    };
    button().textContent = label;
    button().hidden = false;
    said.textContent = "";
    formSaid.textContent = "";
    show("offer");
    let sending = false;
    const submit = async () => {
      if (!send || sending || !email.reportValidity()) return;
      sending = true;
      go().disabled = true;
      formSaid.textContent = "Sending…";
      const sent = await send(email.value.trim(), note.value.trim()).catch(() => false);
      sending = false;
      go().disabled = false;
      if (!sent) return void (formSaid.textContent = "That didn't send. Try again.");
      // It is with a person now, and the widget says so: from here on they are not talking to the AI about this.
      email.value = note.value = "";
      show("offer");
      button().hidden = true;
      said.textContent = "Sent to the team. A person will reply by email.";
    };
    this.onHandoff = {
      open: () => {
        if (!send) return open();
        show("form");
        email.focus();
      },
      cancel: () => show("offer"),
      send: () => void submit(),
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      void submit();
    };
    this.handoff.hidden = false;
    this.panel.hidden = false;
    this.keepPlaced();
    // The dock grew. A caption with no target sits above it, so it moves up too.
    this.placeSaid();
  }

  hideHandoff() {
    this.handoff.hidden = true;
    this.onHandoff = undefined;
  }

  /**
   * The visitor clicked what the pointer was on. The ring and the pointer dip
   * like a pressed button and come back, where they are, even if the click
   * took the control off the page, and then go. Everything else is put away
   * at once, as `clear` does. Nothing is played under reduced motion.
   */
  press() {
    const playing = !this.cursor.hidden && !lessMotion();
    const ringShown = !this.ring.hidden;
    this.clear();
    if (!playing) return;
    this.cursor.hidden = false;
    this.ring.hidden = !ringShown;
    for (const part of [this.cursor, this.ring]) {
      part.classList.remove("press");
      // Read back so the dip plays again if it has only just played.
      void part.offsetWidth;
      part.classList.add("press");
    }
    this.pressing = setTimeout(() => {
      this.endPress();
      this.ring.hidden = true;
      this.cursor.hidden = true;
    }, PRESS_MS);
  }

  /** Ends a press that is still playing, without taking the pointer away: it is about to be sent somewhere, or hidden. */
  private endPress() {
    clearTimeout(this.pressing);
    this.pressing = undefined;
    this.cursor.classList.remove("press");
    this.ring.classList.remove("press");
  }

  /** Move the pointer to an element and show the caption beside it. With no text yet, the pointer goes alone. */
  pointAt(el: Element, text: string) {
    this.endPress();
    this.caption.classList.remove("said");
    this.saying = false;
    this.lost = false;
    this.backInView();
    if (el !== this.pointed) {
      // A control the page drew again, in the same place, is the same control: the caption stays off what it opened.
      const same = !!this.pointedBox && sameBox(this.pointedBox, el.getBoundingClientRect());
      this.pointed = el;
      this.pointedTime = performance.now();
      this.chatWanted = false;
      this.held = undefined;
      this.tip = undefined;
      if (!same) {
        this.captionAbove = false;
        this.under = undefined;
        this.captionAvoid = [];
      }
      this.aim(el);
    }
    this.captionText.textContent = text;
    this.caption.hidden = text === "";
    this.cursor.hidden = false;
    // Paint once at the old spot so the transition has somewhere to start from.
    this.cursor.style.transform = `translate(${this.at.x - this.tipIn.x}px, ${this.at.y - this.tipIn.y}px)`;
    // The ring goes round the control now, and is not left for the next frame as the pointer's glide is. On a machine
    // that draws slowly the next frame is a while off, and a guide that says it is pointing has its ring up.
    const target = this.target;
    this.anchor();
    if (target?.isConnected && target.getClientRects().length) this.ringAt(target.getBoundingClientRect());
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.track);
  }

  /**
   * Holds our element where the control pointed at is held, so the ring, the
   * pointer and the caption go with it however the page moves. Each frame puts
   * them back on the control, but the page can move with none of ours running:
   * a Mac's trackpad pulls the page past its top and lets it spring back with
   * its scroll position still 0, and the browser scrolls between two of our
   * frames. Held to the window, they stayed where the control had been: on
   * Northpine's Issue a card the ring went round Cardholder's label.
   *
   * For a control that moves with the page, our element is held to the page:
   * it is put on the page where the window is, the window's size, so every
   * place in it is still a place in the window, and moving it does not make
   * the page any longer. It stays in the top layer, above the page, and what
   * of ours is fixed to the window, the launcher and the chat, stays there.
   * For anything else, with nothing pointed at, and while the control is out
   * of the window and its caption waits at the window's edge (`offView`), it
   * is fixed to the window.
   */
  private anchor() {
    const parts = [this.ring, this.cursor, this.caption];
    const host = this.host.style;
    if (!this.target || !this.withPage || this.outOfView) {
      if (!this.onPage) return;
      this.onPage = false;
      for (const name of ["position", "inset", "left", "top", "width", "height", "overflow"]) host.removeProperty(name);
      for (const part of parts) part.style.removeProperty("position");
      return;
    }
    if (!this.onPage) {
      this.onPage = true;
      this.pageOffset = { x: 0, y: 0 };
      host.setProperty("position", "absolute");
      host.setProperty("inset", "auto");
      // Cut off at the window's edge, as the window cuts off what is fixed to it: the pointer next to a row at the foot or
      // the side of the page would otherwise make the page longer or wider. Clip, where the browser has it, so nothing
      // can scroll our element; hidden where it has not.
      host.setProperty("overflow", "hidden");
      host.setProperty("overflow", "clip");
      for (const part of parts) part.style.setProperty("position", "absolute");
    }
    // The window's size without its scroll bars, as `inset: 0` gives when fixed, so it never reaches past the page.
    const page = document.documentElement;
    host.setProperty("left", `${window.scrollX + this.pageOffset.x}px`);
    host.setProperty("top", `${window.scrollY + this.pageOffset.y}px`);
    host.setProperty("width", `${page.clientWidth}px`);
    host.setProperty("height", `${page.clientHeight}px`);
  }

  /** Puts the ring round a box of the page, or puts it away when the box is not in the window, and says which. */
  private ringAt(rect: DOMRect): boolean {
    const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.width + rect.height > 0;
    this.ring.hidden = !onScreen;
    if (!onScreen) return false;
    // In presentation mode the ring is thicker, and stands further out so it does not cover the control's edge.
    const pad = this.present ? 10 : 4;
    this.ring.style.left = `${rect.left - pad}px`;
    this.ring.style.top = `${rect.top - pad}px`;
    this.ring.style.width = `${rect.width + pad * 2}px`;
    this.ring.style.height = `${rect.height + pad * 2}px`;
    return true;
  }

  /** Show text with nothing to point at, above the launcher. */
  say(text: string) {
    this.clearPointer();
    this.captionText.textContent = text;
    this.caption.classList.add("said");
    this.caption.hidden = false;
    this.saying = true;
    this.placeSaid();
    this.showAsked();
  }

  /**
   * Reopens the ask box with "Did this help?" above it. The caption keeps to
   * one sentence and no buttons, so the question lives in the panel.
   * `answer` is called once, if they tap Yes or No.
   */
  askIfHelped(answer: (helped: boolean) => void) {
    this.onHelped = answer;
    this.helped.replaceChildren(...this.helpedRow());
    this.helped.hidden = false;
    this.panel.hidden = false;
    this.showActs();
    this.keepPlaced();
    // The dock grew. A caption with no target sits above it, so it moves up too.
    this.placeSaid();
  }

  private helpedRow(): Node[] {
    const yes = make("button", { type: "button" }, "Yes");
    const no = make("button", { type: "button" }, "No");
    yes.dataset.helped = "yes";
    no.dataset.helped = "no";
    return [make("span", {}, "Did this help?"), yes, no];
  }

  /** Yes or No, pressed. Thanks takes the question's place for a moment, then the ask box is all that is left. */
  private answerHelped(helped: boolean) {
    if (!this.onHelped) return;
    this.onHelped(helped);
    this.onHelped = undefined;
    const thanks = make("span", {}, "Thanks.");
    this.helped.replaceChildren(thanks);
    setTimeout(() => this.helped.firstChild === thanks && this.hideHelped(), 1500);
  }

  private hideHelped() {
    this.helped.hidden = true;
    this.onHelped = undefined;
    // The dock is shorter by the row that went. A caption with no target sits above it, so it comes back down with it.
    this.placeSaid();
  }

  /** Places a caption with nothing to point at above the launcher, and above the panel when it is open. */
  private placeSaid() {
    if (!this.saying || this.caption.hidden) return;
    const box = this.caption.getBoundingClientRect();
    const dock = this.dock.getBoundingClientRect();
    const left = dock.right - box.width;
    this.caption.style.left = `${Math.max(12, left)}px`;
    this.caption.style.top = `${Math.max(12, Math.min(window.innerHeight - box.height - 76, dock.top - box.height - 16))}px`;
  }

  clearPointer() {
    this.endPress();
    this.saying = false;
    this.lost = false;
    this.backInView();
    this.pointed = undefined;
    this.pointedBox = undefined;
    this.captionAvoid = [];
    this.held = undefined;
    this.target = undefined;
    this.tip = undefined;
    this.under = undefined;
    this.captionAbove = false;
    this.chatWanted = false;
    this.tuck(false);
    this.dockAt(this.home);
    this.mark(undefined);
    cancelAnimationFrame(this.frame);
    // Held to the window again, where what is said with nothing to point at goes, and where a press plays out.
    this.anchor();
    this.ring.hidden = true;
    this.cursor.hidden = true;
  }

  clear() {
    this.clearPointer();
    this.caption.hidden = true;
    this.showAsked();
  }

  /**
   * Start over: everything in the chat goes, the question, its reply, Done,
   * "Did this help?", "What I did" and the way to a person, and the ask box is
   * left empty, open and with the keyboard, as before the first question.
   */
  startOver() {
    this.clear();
    this.clearAnswer();
    this.showQuestion("");
    this.hideDid();
    this.hideHelped();
    this.hideHandoff();
    this.setNote("");
    this.first.hidden = true;
    this.done.hidden = true;
    this.input.value = "";
    this.panel.classList.remove("nudged");
    this.panel.hidden = false;
    this.showActs();
    this.keepPlaced();
    this.input.focus();
  }

  /**
   * The visitor's question. In the chat it is a bubble at the top. In
   * presentation mode it is also kept on show across the page while its guide
   * runs and while its last sentence is up, so an audience that came in late
   * can read what was asked. An empty question takes both away.
   */
  showQuestion(question: string) {
    this.question = question;
    this.asked.textContent = question ? `\u201c${question}\u201d` : "";
    // In the chat it is a bubble at the top, from the moment it is asked until the next one, or until the guide is called off.
    (this.thread.querySelector(".question") as HTMLElement).textContent = question;
    this.reply.hidden = true;
    this.done.hidden = true;
    this.thread.hidden = question === "";
    this.showAsked();
  }

  /** Shows the question, or hides it, as the guide stands, and keeps it off what is pointed at and its caption. */
  private showAsked(avoid: Box[] = []) {
    const state = this.state;
    const running = state === "asking" || state === "pointing" || state === "watching" || state === "acting" || state === "paused";
    const show = this.present && this.question !== "" && (running || (state === "finished" && !this.caption.hidden));
    if (this.asked.hidden === show) this.asked.hidden = !show;
    if (!show) return;
    // At the foot of the window unless that covers what the visitor is shown, the launcher or the ask box. Then at the top.
    this.asked.classList.remove("top");
    const box = this.asked.getBoundingClientRect();
    const covered = [...avoid, this.dock.getBoundingClientRect(), ...(this.caption.hidden ? [] : [this.caption.getBoundingClientRect()])];
    if (covered.some((other) => overlaps(box, other, 8))) this.asked.classList.add("top");
  }

  /** Where the guide is. Kept as a property of our own element, beside `pointedAt`, and nowhere on the customer's page. */
  get state(): GuideState {
    return (this.host as HTMLElement & { guideState?: GuideState }).guideState ?? "idle";
  }

  setState(state: GuideState) {
    (this.host as HTMLElement & { guideState?: GuideState }).guideState = state;
    this.showStatus();
    // "asking" is the wait for the model, and the only time the glow is on the page.
    if (state === "asking") this.glowOn();
    else this.glowOff();
    this.keepPlaced();
    this.showAsked();
  }

  /**
   * Starts the glow: a band of colour comes in at the top of the page and
   * falls towards the bottom, slower the longer Haptic thinks. With reduced
   * motion on there is no glow at all.
   */
  private glowOn() {
    if (this.glow || lessMotion()) return;
    try {
      // A page that swapped out its own document took the glow's element with it. It is put back, under ours.
      if (!this.veil.isConnected) {
        document.documentElement.append(this.veil);
        this.raise(true);
      }
      const band = make("i");
      const el = make("div", { class: "glow" }, band);
      // One leaving and one new is the most there is to see at once.
      const glows = this.glass.querySelectorAll(".glow");
      for (let i = 0; i < glows.length - 1; i++) glows[i]?.remove();
      // The glow is multiplied into a light page, so the page's words stay dark and sharp through it, and screened
      // into a dark one, where multiplying would lose the colour.
      this.blend(`:host { display: block; mix-blend-mode: ${pageIsDark() ? "screen" : "multiply"}; }`);
      this.glass.append(el);
      // Drawn once above the page's top edge, so the fall has somewhere to start from.
      void band.offsetWidth;
      band.classList.add("falling");
      this.glow = el;
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  }

  /**
   * Ends the glow, the moment the thinking is over, however it ended. From
   * wherever the band is, it goes on to the bottom and off the page, fading
   * as it goes, and its element is then not displayed at all.
   */
  private glowOff() {
    const el = this.glow;
    if (!el) return;
    this.glow = undefined;
    el.classList.add("fade");
    setTimeout(() => {
      el.remove();
      // With no glow left, the element is not displayed, and the page is not blended with anything.
      if (!this.glass.querySelector(".glow")) this.blend("");
    }, GLOW_OUT_MS);
  }

  /**
   * Keeps the control the pointer is on readable from outside, as a property
   * of our own element. Nothing on the customer's page is touched. Tests and
   * the benchmark use it to act on what a visitor is being shown.
   */
  private mark(el: Element | undefined) {
    (this.host as HTMLElement & { pointedAt?: Element }).pointedAt = el;
  }

  /** Chooses what the pointer goes on for the control `el`, and says so in `pointedAt`. */
  private aim(el: Element) {
    const rect = el.getBoundingClientRect();
    this.aimed = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    this.target = partToClick(el, this.aimed);
    this.withPage = movesWithPage(this.target);
    this.mark(this.target);
    // The ring's corners follow the control's own, a little rounder for standing off it. Presentation mode has its own.
    if (!this.present) this.ring.style.setProperty("border-radius", `${Math.min((parseFloat(getComputedStyle(this.target).borderTopLeftRadius) || 6) + 4, (rect.height + 8) / 2 || 10)}px`);
  }

  /** Follows the target every frame, so scrolling and layout shifts don't strand the pointer. */
  private track = () => {
    const el = this.target;
    if (!el) return;
    this.frame = requestAnimationFrame(this.track);
    try {
      this.follow(el);
    } catch (error) {
      // Something about the page we did not expect. The pointer stays where it was, and nothing is thrown into the page.
      console.warn("[Haptic]", error);
    }
  };

  private follow(el: Element) {
    // A control that has left the page, or is no longer laid out, has nothing to point at: the pointer and its sentence
    // go with it, and nothing is left floating where it was. They come back if the page puts it back.
    if (!el.isConnected || !el.getClientRects().length) {
      this.ring.hidden = true;
      this.cursor.hidden = true;
      this.caption.hidden = true;
      this.lost = true;
      return;
    }
    if (this.lost) {
      this.lost = false;
      this.cursor.hidden = false;
      this.caption.hidden = this.captionText.textContent === "";
    }
    // Before anything is measured, so the page is laid out once a frame.
    this.anchor();
    let rect = el.getBoundingClientRect();
    if (!this.ringAt(rect)) return this.offView(rect);
    if (this.outOfView) {
      this.backInView();
      this.cursor.hidden = false;
      this.caption.hidden = this.captionText.textContent === "";
    }
    // A control pointed at while it was scrolled out of view is looked at again once it is in view.
    if (!this.aimed && this.pointed) {
      this.aim(this.pointed);
      if (this.target !== el) return;
      rect = el.getBoundingClientRect();
      this.ringAt(rect);
    }

    // As `ringAt` stands the ring off the control.
    const pad = this.present ? 10 : 4;
    this.pointedBox = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };

    this.at = this.held ?? this.tipOn(el, rect);
    this.cursor.style.transform = `translate(${this.at.x - this.tipIn.x}px, ${this.at.y - this.tipIn.y}px)`;

    // The caption goes below the control, or above it when there is no room below or when something opened below.
    // A text field is the other way round: the browser opens its own list under it, of saved addresses or of what
    // was typed there before, drawn over the page where the caption would be and where nothing here can see it.
    // In presentation mode it looks for its place another way: see `presentedCaption`.
    const box = this.caption.getBoundingClientRect();
    let left: number;
    let top: number;
    if (this.present) ({ left, top } = this.presentedCaption(rect, pad, box));
    else {
      const fitsBelow = rect.bottom + 14 + box.height < window.innerHeight;
      const fitsAbove = rect.top - box.height - 12 >= 8;
      const above = this.captionAbove !== suggestsBelow(el) ? fitsAbove || !fitsBelow : !fitsBelow;
      top = above ? Math.max(8, rect.top - box.height - 12) : rect.bottom + 14;
      left = this.captionLeft(rect, box, top);
    }
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;

    const now = performance.now();
    if (now - this.looked < 200) return;
    this.looked = now;
    // A page can fix a bar to the window once it has scrolled, or let it go. The next frame holds our element as it is held.
    this.withPage = movesWithPage(el);
    if (this.onPage) {
      // Held to the page, our element is where the window is, unless something positioned around it is not the page's corner.
      const at = this.host.getBoundingClientRect();
      if (Math.abs(at.left) > 0.5 || Math.abs(at.top) > 0.5) this.pageOffset = { x: this.pageOffset.x - at.left, y: this.pageOffset.y - at.top };
    }
    const caption = this.caption.hidden ? undefined : { left, top, right: left + box.width, bottom: top + box.height };
    this.keepLauncherOff(rect, caption);
    if (caption) this.keepCaptionOff(el, caption);
    if (this.present) this.showAsked([this.ring.getBoundingClientRect(), this.pointerBox()]);
  }

  /**
   * The control is out of the window. The pointer and its caption are drawn
   * over the window, not the page, so left where they were they would point
   * at whatever scrolled under them. The pointer is put away, and the caption
   * waits at the edge of the window the control went off, led by a button
   * that brings it back, until the control is in the window again. Just after
   * the guide pointed at a control out of the window, while its own scroll
   * brings it in, neither shows. A point Haptic is about to press, while it
   * acts, is where it is in the window whatever the control does, and stays.
   */
  private offView(rect: DOMRect) {
    if (this.held) return;
    const way = rect.bottom <= 0 ? "up" : rect.top >= window.innerHeight ? "down" : undefined;
    const arriving = !this.aimed && performance.now() - this.pointedTime < ARRIVE_MS;
    const where = this.caption.querySelector<HTMLElement>(".where")!;
    this.cursor.hidden = true;
    if (!way || arriving || this.captionText.textContent === "") {
      // Not yet in, or nowhere to say it is: nothing is left floating over the page meanwhile.
      this.outOfView = "unseen";
      this.anchor();
      this.caption.hidden = true;
      where.hidden = true;
      return;
    }
    if (this.outOfView !== way) {
      this.outOfView = way;
      // The caption now belongs to the window's edge, not the page: it stays there however the page moves.
      this.anchor();
      const label = way === "up" ? "Scroll up to it" : "Scroll down to it";
      where.setAttribute("aria-label", label);
      where.title = label;
      where.classList.toggle("down", way === "down");
      // What lay under the caption beside the control says nothing about what lies under it at the edge, or once it is back.
      if (!this.under?.moved) this.under = undefined;
    }
    where.hidden = false;
    this.caption.hidden = false;
    const box = this.caption.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - box.width - margin);
    const top = way === "up" ? margin : window.innerHeight - box.height - margin;
    this.caption.style.left = `${left}px`;
    this.caption.style.top = `${top}px`;
    const now = performance.now();
    if (now - this.looked < 200) return;
    this.looked = now;
    this.keepLauncherOff(rect, { left, top, right: left + box.width, bottom: top + box.height });
  }

  /** The control is in the window again, or the pointer has moved on: the caption's way back to it goes. */
  private backInView() {
    this.outOfView = undefined;
    const where = this.caption.querySelector<HTMLElement>(".where");
    if (where) where.hidden = true;
  }

  /** The caption's button: scrolls the control it is about back into the window, where the pointer and ring come back to it. */
  private bringBack() {
    const el = this.target;
    if (!el?.isConnected) return;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: lessMotion() ? "auto" : "smooth" });
  }

  /** The box the pointer is drawn in, round its tip, at the size it is drawn. */
  private pointerBox(): Box {
    const scale = this.present ? PRESENT_SCALE : 1;
    return { left: this.at.x - 4, top: this.at.y - 4, right: this.at.x + 18 * scale, bottom: this.at.y + 20 * scale };
  }

  /**
   * Where the caption goes in presentation mode, where it is large: above the
   * control first, then to its left, to its right, and below it last, the
   * first place that fits in the window and keeps off the control, the
   * pointer that hangs from it, every list, menu or calendar open over the
   * page (the whole of one the control is in, so a choice's caption does not
   * hide the other choices), and every place something opened over since.
   * Above comes first because what a control opens, a list, a menu or a
   * calendar, opens below it, and in a form the next field is below it too.
   */
  private presentedCaption(rect: DOMRect, pad: number, box: DOMRect): { left: number; top: number } {
    const gap = 14;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ring = { left: rect.left - pad - 6, top: rect.top - pad - 6, right: rect.right + pad + 6, bottom: rect.bottom + pad + 6 };
    const pointer = this.pointerBox();
    const open = openLayers(this.host, this.target);
    // Round the control, its pointer, and the list it is a choice in, if it is in one.
    const near = [ring, pointer, ...(open.around ? [open.around] : [])];
    const all = { left: Math.min(...near.map((b) => b.left)), top: Math.min(...near.map((b) => b.top)), right: Math.max(...near.map((b) => b.right)), bottom: Math.max(...near.map((b) => b.bottom)) };
    const clampX = (x: number) => Math.min(Math.max(12, x), width - box.width - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), height - box.height - 12);
    const middle = clampY(rect.top + rect.height / 2 - box.height / 2);
    const places: { left: number; top: number }[] = [];
    for (const round of open.around ? [ring, all] : [ring]) {
      const bottom = Math.max(round.bottom, pointer.bottom);
      const right = Math.max(round.right, pointer.right);
      places.push(
        { left: clampX(rect.left), top: round.top - gap - box.height },
        { left: clampX(rect.right - box.width), top: round.top - gap - box.height },
        { left: round.left - gap - box.width, top: middle },
        { left: right + gap, top: middle },
        { left: clampX(rect.left), top: bottom + gap },
        { left: clampX(rect.right - box.width), top: bottom + gap },
      );
    }
    const fits = (place: { left: number; top: number }) => place.left >= 12 && place.top >= 12 && place.left + box.width <= width - 12 && place.top + box.height <= height - 12;
    // The launcher and the chat in their corner too, so they never move up the window for the caption alone.
    const dock = this.dockHome(rect);
    const avoid = [ring, pointer, ...this.captionAvoid, ...open.boxes, ...(dock ? [dock] : [])];
    const free = (place: { left: number; top: number }) =>
      !avoid.some((other) => overlaps({ left: place.left, top: place.top, right: place.left + box.width, bottom: place.top + box.height }, other, 0));
    return places.find((place) => fits(place) && free(place)) ?? places.find(fits) ?? { left: clampX(rect.left), top: clampY(ring.bottom + gap) };
  }

  /**
   * Where the tip goes: in the control's lower right corner, so the pointer
   * hangs off it and never covers its label. Something else can lie on that
   * corner, like a panel's resize handle, so the tip moves in until it is on
   * the control itself.
   */
  private tipOn(el: Element, rect: DOMRect): { x: number; y: number } {
    const box = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    if (this.tip?.box !== box) {
      const right = rect.width - Math.min(10, rect.width * 0.2);
      const spots = [
        [right, rect.height - Math.min(7, rect.height * 0.25)],
        [right, rect.height / 2],
        [rect.width / 2, rect.height / 2],
      ] as const;
      const [dx, dy] = spots.find(([x, y]) => onIt(el, rect.left + x, rect.top + y)) ?? spots[2];
      this.tip = { box, dx, dy };
    }
    return { x: rect.left + this.tip.dx, y: rect.top + this.tip.dy };
  }

  /**
   * Keeps the caption off what the control opens. A list, a menu or a
   * calendar opens beside the control, usually right where the caption is. If
   * something new comes up under the caption, it moves to the other side, once.
   * In presentation mode the caption is large, and what lies under it is
   * looked at in six places across it rather than at its middle; what opened
   * is kept clear from then on, and the caption looks for its place again, a
   * few times at most.
   */
  private keepCaptionOff(el: Element, caption: Box) {
    const across = this.present ? [0.15, 0.5, 0.85] : [0.5];
    const down = this.present ? [0.25, 0.75] : [0.5];
    const hits: (Element | null)[] = [];
    for (const fy of down) {
      for (const fx of across) {
        const x = caption.left + (caption.right - caption.left) * fx;
        const y = caption.top + (caption.bottom - caption.top) * fy;
        const hit = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight ? document.elementFromPoint(x, y) : null;
        hits.push(hit && hit !== this.host ? hit : null);
      }
    }
    if (!this.under) {
      this.under = { els: hits, moved: false };
      return;
    }
    if (this.under.moved) return;
    const under = this.under;
    const now = hits.find((hit, index) => cameUp(hit, under.els[index] ?? null, el));
    if (!now) return;
    if (this.present) {
      this.captionAvoid.push(layerOf(now).getBoundingClientRect(), caption);
      this.under = this.captionAvoid.length >= 6 ? { els: [], moved: true } : undefined;
      return;
    }
    this.captionAbove = !this.captionAbove;
    this.under = { els: [], moved: true };
  }

  /**
   * Where the caption starts across the window, below or above the control:
   * under the control's left edge, unless that runs it under the launcher and
   * the chat in their corner. Then it moves left, as far as it must to clear
   * them, and no further than to end at the control's right edge, where the
   * pointer hangs. A long caption under a button just left of the chat, like
   * a dialog's last button, used to run on under the chat, and the chat
   * jumped up the window for it and dropped back on the next step, for a
   * control it never covered. When moving left can't clear them, the caption
   * stays under the left edge and the dock moves up out of its way for the
   * step (see `keepLauncherOff`).
   */
  private captionLeft(rect: DOMRect, box: DOMRect, top: number): number {
    const fit = (x: number) => Math.min(Math.max(8, x), window.innerWidth - box.width - 8);
    const left = fit(rect.left);
    const dock = this.dockHome(rect);
    const at = (x: number): Box => ({ left: x, top, right: x + box.width, bottom: top + box.height });
    if (!dock || !overlaps(at(left), dock, 4)) return left;
    const over = fit(Math.min(left, Math.max(rect.right - box.width, dock.left - CLEAR - box.width)));
    return overlaps(at(over), dock, 4) ? left : over;
  }

  /**
   * The box the launcher and the open chat take in their own place, for the
   * caption to keep off, so they never move up the window for the caption
   * alone. None when the control pointed at is in it: they move for the
   * control anyway, to above it and its caption.
   */
  private dockHome(rect: DOMRect): Box | undefined {
    const home = boxAt(this.home, this.dockSizes().whole);
    // As `keepLauncherOff` keeps them off the control: 4px round it, and 4px more.
    return overlaps(home, rect, 8) ? undefined : home;
  }

  /**
   * The room the launcher takes alone, and with the open chat above it. The
   * chat's size is the last it showed, so a chat tucked away for the step
   * keeps its room for when it comes back.
   */
  private dockSizes(): { alone: { w: number; h: number }; chat?: { w: number; h: number }; whole: { w: number; h: number } } {
    const launch = this.dock.querySelector(".launch")!.getBoundingClientRect();
    const alone = { w: launch.width, h: launch.height };
    if (!this.panel.hidden && !this.dock.classList.contains("tucked")) {
      const shown = this.panel.getBoundingClientRect();
      this.chatSize = { w: shown.width, h: shown.height + DOCK_GAP };
    }
    const chat = this.panel.hidden ? undefined : this.chatSize;
    return { alone, chat, whole: chat ? { w: Math.max(alone.w, chat.w), h: alone.h + chat.h } : alone };
  }

  /**
   * Keeps the launcher, and the chat above it, off the control being pointed
   * at and off its caption. They stay on the right of the window: while they
   * would cover them they move up it, to just above, and they come back down
   * when the step is over. The caption keeps off them where it can (see
   * `captionLeft`), so it is nearly always the control they move for. When
   * the open chat has no room above the control, it is tucked away for the
   * step and the launcher alone goes up, unless the visitor opened it during
   * the step. The caption's × still stops the guide, and the launcher brings
   * the chat back.
   */
  private keepLauncherOff(rect: DOMRect, caption?: Box) {
    const inWay = [{ left: rect.left - 4, top: rect.top - 4, right: rect.right + 4, bottom: rect.bottom + 4 }, ...(caption ? [caption] : [])];
    const { alone, chat, whole } = this.dockSizes();
    const spot = freeUp(this.home.y, whole, inWay, window.innerHeight - whole.h - 8);
    if (spot || !chat || this.chatWanted) {
      this.tuck(false);
      this.dockAt(spot ?? this.home);
      return;
    }
    this.tuck(true);
    this.dockAt(freeUp(this.home.y, alone, inWay, window.innerHeight - alone.h - 8) ?? this.home);
  }

  /** Puts the chat out of sight while it would cover the control pointed at, or brings it back. It stays open underneath. */
  private tuck(on: boolean) {
    this.dock.classList.toggle("tucked", on);
  }

  /** Puts the launcher, and the ask box above it, at a height on the right of the window. */
  private dockAt(spot: Spot) {
    // Set through the element's style object, which a page's policy on inline style does not reach.
    this.dock.style.setProperty("bottom", `${spot.y}px`);
  }
}

/** The pointer's glide, as `.cursor`'s transition sets it. */
const GLIDE_MS = 550;

function lessMotion(): boolean {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Gives our shadow root its styles as a stylesheet object, which a page's
 * policy on inline style does not reach. A browser without stylesheet objects
 * gets a <style> element instead, which works wherever the page allows inline style.
 */
export function adoptStyles(root: ShadowRoot, css: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    return;
  } catch {
    // No stylesheet objects in this browser.
  }
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style);
}

/**
 * Gives the glow's shadow root its styles, and a second stylesheet that is
 * empty until a glow starts. Returns how to write that second one: it says
 * whether the element shows and how it is blended into the page. Being a
 * stylesheet and not an attribute, nothing on the page changes when it is written.
 */
function adoptVeil(root: ShadowRoot, css: string): (rule: string) => void {
  try {
    const [base, mode] = [new CSSStyleSheet(), new CSSStyleSheet()];
    base.replaceSync(css);
    root.adoptedStyleSheets = [base, mode];
    return (rule) => mode.replaceSync(rule);
  } catch {
    // No stylesheet objects in this browser.
  }
  const [base, mode] = [document.createElement("style"), document.createElement("style")];
  base.textContent = css;
  root.append(base, mode);
  return (rule) => (mode.textContent = rule);
}

/**
 * Whether the page is dark where the glow will fall, going by the first
 * background that is not see-through behind three spots on it. A page that
 * gives nothing to go on is taken to be light.
 */
function pageIsDark(): boolean {
  const spots: [number, number][] = [[0.5, 0.12], [0.5, 0.5], [0.2, 0.8]];
  let dark = 0;
  let known = 0;
  for (const [x, y] of spots) {
    let el: Element | null = document.elementFromPoint(window.innerWidth * x, window.innerHeight * y);
    for (let depth = 0; el && depth < 16; el = el.parentElement, depth++) {
      const colour = /^rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
      const [r = 0, g = 0, b = 0, alpha = 1] = (colour?.[1] ?? "").split(/[\s,/]+/).filter(Boolean).map(Number);
      if (!colour || alpha < 0.5) continue;
      known++;
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 110) dark++;
      break;
    }
  }
  return known > 0 && dark * 2 > known;
}

/** One of our elements, with its attributes and what goes in it. Text goes in as text, never as markup. */
export function make<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

/** Words that are read as text and by screen readers, and not drawn. */
function unseen(text: string): HTMLSpanElement {
  return make("span", { class: "unseen" }, text);
}

/** One of our icons: a single path on a 24 by 24 grid. */
function icon(path: string, attributes: Record<string, string> = {}): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

/** Where the visitor's "I've seen the first-use line" is kept: this browser only, for this site. */
const seenKey = (acting: UiActing) => `haptic.acting.seen.${acting.site}`;

/** Whether this visitor has pressed Go on this site before. Storage that fails counts as no: the line simply shows again. */
function remembered(acting: UiActing): boolean {
  try {
    return localStorage.getItem(seenKey(acting)) === "1";
  } catch {
    return false;
  }
}

function remember(acting: UiActing | undefined) {
  if (!acting) return;
  try {
    localStorage.setItem(seenKey(acting), "1");
  } catch {
    // Not kept. The line shows again next time.
  }
}

/** Whether an element is in the page and drawn. */
function shown(el: Element): boolean {
  if (!el.isConnected || !el.getClientRects().length) return false;
  return typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true });
}

/** The browser's own modal dialog that is open on top, if any. Everything outside it is inert. */
export function topModal(): Element | undefined {
  let found: Element | undefined;
  try {
    document.querySelectorAll("dialog:modal").forEach((el) => (found = el));
  } catch {
    // :modal unsupported. Then there is no such dialog to be in.
  }
  return found;
}

/**
 * The open dialog that shuts out the rest of the page, if there is one: the
 * browser's own modal dialog, a dialog that says it is modal, or one drawn
 * with a backdrop over the whole window. The innermost of several wins.
 */
function blockingDialog(ignore: Element): Element | undefined {
  let native: Element | undefined;
  try {
    document.querySelectorAll("dialog:modal").forEach((el) => (native = el));
  } catch {
    // :modal unsupported. ARIA modals below still work.
  }
  let found = native;
  document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => {
    // Outside the browser's own modal dialog, everything is inert anyway.
    if (ignore.contains(el) || !shown(el) || (native && !native.contains(el))) return;
    if (el.getAttribute("aria-modal") === "true" || hasBackdrop(el, ignore)) found = el;
  });
  return found;
}

/** Whether a dialog is drawn over a backdrop that covers the window: what lies at its middle, if not the dialog, is a layer as big as the window, beside the dialog or pinned round it. */
function hasBackdrop(dialog: Element, ignore: Element): boolean {
  const top = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).find((el) => !ignore.contains(el) && el !== ignore);
  if (!top || dialog.contains(top) || top === document.body || top === document.documentElement) return false;
  const cover = top.getBoundingClientRect();
  if (cover.width < window.innerWidth * 0.95 || cover.height < window.innerHeight * 0.95) return false;
  return !top.contains(dialog) || getComputedStyle(top).position === "fixed";
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Whether `now`, under a part of the caption where `was` lay before, is
 * something that came up there: not the control `el` or what holds it, not
 * what was there, and, inside what was there, only a box drawn over it. Text
 * that scrolls under the caption is not.
 */
function cameUp(now: Element | null, was: Element | null, el: Element): boolean {
  if (!now || now === was || now.contains(el) || el.contains(now) || (was && now.contains(was))) return false;
  return !(was?.contains(now) && !drawnOver(now, was));
}

/** The box drawn over the page that `el` sits in: a list, a menu, or anything positioned on its own. `el` itself when there is none. */
function layerOf(el: Element): Element {
  for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
    if (at.matches('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [role="tooltip"], [popover]')) return at;
    const position = getComputedStyle(at).position;
    if (position === "absolute" || position === "fixed") return at;
  }
  return el;
}

/** What a control opens, by its role: a list, a menu, a tree, a grid of days, or a dialog. */
const OPENS = '[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [popover]';

/**
 * The boxes of the lists, menus and calendars open over the page now: each
 * one's box drawn over the page, when it is shown, and `around`, the one the
 * control is in, if it is in one. A dialog the control is in is where the
 * caption has to go, and is not one of them.
 */
function openLayers(ignore: Element, target: Element | undefined): { boxes: Box[]; around?: Box } {
  const found: Box[] = [];
  let around: Box | undefined;
  const seenLayers = new Set<Element>();
  for (const el of document.querySelectorAll(OPENS)) {
    if (ignore.contains(el) || el === ignore || seenLayers.size > 20) continue;
    let layer: Element | null = el;
    while (layer && layer !== document.body && !isLayer(layer)) layer = layer.parentElement;
    if (!layer || layer === document.body || seenLayers.has(layer)) continue;
    seenLayers.add(layer);
    if (typeof layer.checkVisibility === "function" ? !layer.checkVisibility({ visibilityProperty: true }) : !layer.getClientRects().length) continue;
    const box = layer.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const share = (box.width * box.height) / (window.innerWidth * window.innerHeight);
    // A dialog, or anything as big, with the control in it: the caption goes inside it.
    if (target && layer.contains(target) && (layer.matches('[role="dialog"], dialog') || share > 0.4)) continue;
    // A dialog that shuts out the page, or fills a good part of it, is where the visitor is working, not something a control opened.
    if (el.matches('[role="dialog"], dialog') && (el.getAttribute("aria-modal") === "true" || share > 0.25 || isModal(el))) continue;
    found.push(box);
    if (target && layer.contains(target)) around = box;
  }
  return { boxes: found, ...(around ? { around } : {}) };
}

/** Whether an element is the browser's own modal dialog. */
function isModal(el: Element): boolean {
  try {
    return el.matches("dialog:modal");
  } catch {
    return false;
  }
}

/**
 * Whether an element moves with the page as a whole: it is in the page
 * itself, not a frame, and neither it nor anything it is drawn inside is
 * fixed to the window, on the top layer (a modal dialog, an open popover) or
 * sticky. A sticky bar counts as held to the window: once it has stuck it
 * stays put while the page scrolls under it, which happens far more often
 * than the page springing back past its top.
 */
function movesWithPage(el: Element): boolean {
  if (el.ownerDocument !== document) return false;
  // Up the boxes it is drawn in: through the slot it is shown in, and out of a shadow root to its host.
  for (let at: Element | null = el; at; at = at.assignedSlot ?? at.parentElement ?? ((at.getRootNode() as ShadowRoot).host || null)) {
    const position = getComputedStyle(at).position;
    if (position === "fixed" || position === "sticky") return false;
  }
  return true;
}

/** Whether an element is drawn over the page on its own: positioned against the window or a box, or on the top layer. */
function isLayer(el: Element): boolean {
  if (el.hasAttribute("popover")) {
    try {
      return el.matches(":popover-open");
    } catch {
      // No popovers in this browser: it is drawn where its position puts it.
    }
  }
  const position = getComputedStyle(el).position;
  return position === "absolute" || position === "fixed";
}

/** Whether two boxes are the same, to the pixel. */
function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.right - b.right) < 1 && Math.abs(a.bottom - b.bottom) < 1;
}

/** How bright a six-digit hex colour is, from 0 for black to 1 for white, as contrast is worked out from. */
function luminance(hex: string): number {
  const light = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
  return 0.2126 * light(r) + 0.7152 * light(g) + 0.0722 * light(b);
}

/** The words and mark on a launcher of this colour: Paper or Ink, whichever is easier to read on it. */
export function inkOn(hex: string): string {
  const fill = luminance(hex);
  const onPaper = (luminance("#fafaf9") + 0.05) / (fill + 0.05);
  const onInk = (fill + 0.05) / (luminance("#1c1917") + 0.05);
  return onPaper >= onInk ? "#fafaf9" : "#1c1917";
}

/**
 * The site's accent for presentation mode: dark enough to stand out from far
 * away on a light page, at least 6 to 1 against white, darkened in small
 * steps with its hue kept. An accent that is not a six-digit hex colour is
 * used as it is.
 */
function strongAccent(accent: string): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(accent.trim())?.[1];
  if (!hex) return accent;
  let [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
  const light = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const contrast = () => 1.05 / (0.2126 * light(r) + 0.7152 * light(g) + 0.0722 * light(b) + 0.05);
  for (let step = 0; step < 40 && contrast() < 6; step++) [r, g, b] = [r * 0.95, g * 0.95, b * 0.95];
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** Whether `el` sits in a box drawn over the page, inside `within`: a list, a menu, or anything positioned on its own. */
function drawnOver(el: Element, within: Element): boolean {
  for (let at: Element | null = el; at && at !== within; at = at.parentElement) {
    if (at.matches('[role="listbox"], [role="menu"], [role="tree"], [role="grid"], [role="dialog"], [role="tooltip"], [popover]')) return true;
    const position = getComputedStyle(at).position;
    if (position === "absolute" || position === "fixed") return true;
  }
  return false;
}

function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
}

/** Where the launcher sits: how far up from the bottom of the window. It is always EDGE in from the right. */
interface Spot {
  y: number;
}

/** The launcher's own distance from the window's edges, in its corner. */
const EDGE = 20;
/** The room kept between the launcher and a control of the page's it moved off. */
const CLEAR = 12;
/** The room kept above the launcher for the ask box, which opens above it. */
const BOX_ROOM = 220;

/** The space between the chat and the launcher under it, as `.dock` sets it. */
const DOCK_GAP = 10;

const CORNER: Spot = { y: EDGE };

/** The box the launcher would take at a place, for a launcher of this size. */
function boxAt(spot: Spot, size: { w: number; h: number }): Box {
  const left = window.innerWidth - EDGE - size.w;
  const bottom = window.innerHeight - spot.y;
  return { left, right: left + size.w, top: bottom - size.h, bottom };
}

/** The highest the launcher goes up its side, so the ask box above it still fits in the window. */
const highest = (size: { h: number }) => window.innerHeight - size.h - BOX_ROOM;

/**
 * The lowest free place up the right side of the window, from `from` up: that
 * place, or just above whatever is in the way there, as many times as it
 * takes. Never along the bottom and never to the other side. None when there
 * is no free place below `top`.
 */
function freeUp(from: number, size: { w: number; h: number }, blocked: Box[], top: number): Spot | undefined {
  let y = from;
  for (let tries = 0; tries < 40 && y <= top; tries++) {
    const box = boxAt({ y }, size);
    const inWay = blocked.filter((control) => overlaps(box, control, 4));
    if (!inWay.length) return { y };
    // Clear of all of them at once: just above the highest.
    y = Math.ceil(Math.max(...inWay.map((control) => window.innerHeight - control.top + CLEAR)));
  }
  return undefined;
}

/** The most controls read when the launcher's place is looked for: a few milliseconds' work on the longest pages. */
const MAX_READ = 3000;

/** What a visitor can use on a page, as far as the launcher's place goes. */
const USABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], [role="combobox"], [tabindex]:not([tabindex="-1"])';

/**
 * The boxes of the page's controls that the launcher would cover for good
 * in the lower part of the window where it can go: those that stay put as
 * the page scrolls, where they are now, and the others where they will be
 * once the part they scroll in is at its end. A control that scrolling
 * takes out from under the launcher is not in the way. Read once, when the
 * place is looked for, and never watched.
 */
function lastingControls(ignore: Element, size: { w: number; h: number }): Box[] {
  const height = window.innerHeight;
  const from = height - highest(size) - size.h - CLEAR;
  const page = document.scrollingElement ?? document.documentElement;
  const pageLeft = Math.max(0, page.scrollHeight - page.clientHeight - page.scrollTop);
  const inBand = (top: number, bottom: number) => bottom > from && top < height;
  const found: Box[] = [];
  const all = document.querySelectorAll(USABLE);
  // On a very long page only the last controls are read: the foot of the page, and what scripts add at its end, like a chat button.
  for (let index = all.length - 1; index >= Math.max(0, all.length - MAX_READ); index--) {
    const el = all[index]!;
    if (ignore.contains(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.right <= 0 || rect.left >= window.innerWidth) continue;
    const now = inBand(rect.top, rect.bottom);
    if (!now && !inBand(rect.top - pageLeft, rect.bottom - pageLeft)) continue;
    // A box as big as a good part of the window holds controls rather than being one: covering a corner of it hides nothing.
    if (rect.width * rect.height > (window.innerWidth * height) / 3) continue;
    if (!seen(el)) continue;
    if (pinned(el)) {
      if (now) found.push(rect);
      continue;
    }
    const left = scrollLeftUnder(el, page, pageLeft);
    if (inBand(rect.top - left, rect.bottom - left)) found.push({ left: rect.left, right: rect.right, top: rect.top - left, bottom: rect.bottom - left });
  }
  return found;
}

/** Whether an element can be seen: drawn, not see-through, not hidden. */
function seen(el: Element): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/** The parent of a node, or the element that holds its shadow root. */
const up = (node: Node): Node | null => node.parentNode ?? (node as ShadowRoot).host ?? null;

/** Whether an element, or a box it sits in, stays put on screen when the page scrolls. */
function pinned(el: Element): boolean {
  for (let at: Node | null = el; at; at = up(at)) {
    if (!(at instanceof Element)) continue;
    const position = getComputedStyle(at).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

/**
 * How much further up an element goes once the part it scrolls in is
 * scrolled to its end: the nearest box around it that scrolls, or the page.
 */
function scrollLeftUnder(el: Element, page: Element, pageLeft: number): number {
  for (let at = el.parentElement; at && at !== page && at !== document.body; at = at.parentElement) {
    if (at.scrollHeight <= at.clientHeight + 1) continue;
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return Math.max(0, at.scrollHeight - at.clientHeight - at.scrollTop);
  }
  return pageLeft;
}

/** Input types a browser offers its own suggestions under: saved addresses and logins, and what was typed there before. */
const SUGGESTED = new Set(["text", "email", "tel", "url", "search", "password", "number"]);

/**
 * Whether the browser may open its list of suggestions under this field, over
 * the page. The page cannot see that list, nor stop it: Chrome fills
 * addresses into an email field whatever its autocomplete says.
 */
function suggestsBelow(el: Element): boolean {
  return el instanceof HTMLInputElement && SUGGESTED.has(el.type) && !el.readOnly && !el.disabled;
}

/** Whether a click at this point would land on `el`. A point off the screen cannot be tested and counts. */
function onIt(el: Element, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return true;
  const hit = document.elementFromPoint(x, y);
  if (!hit || el.contains(hit)) return true;
  // A control inside a shadow root is hit as the element that hosts it.
  for (let at: Node | null = el; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === hit) return true;
  return false;
}

const FRAMES = "iframe, frame, object, embed";

/**
 * The part of a control the pointer should go on. Usually the control
 * itself. Two kinds are not:
 * - A field drawn as a speck under its label, as styled tick boxes and some
 *   pickers are. The label is what shows and what takes the click, and
 *   pointing at the speck would cover the row instead. A see-through field
 *   of full size, like a select's input under the words of its value, is
 *   where the visitor clicks, and stays the target.
 * - A large box whose middle is a frame. A click there goes into the frame,
 *   and the page never hears it. What names the box, or its first part that
 *   is not a frame, takes the click instead. This needs the box on screen,
 *   where what lies at its middle can be seen: `canLook`.
 */
function partToClick(el: Element, canLook: boolean): Element {
  const rect = el.getBoundingClientRect();
  const typed = takesText(el);
  if (rect.width < 4 || rect.height < 4 || (typed && rect.width < 8)) {
    // Clicking the label of a field that is typed into only puts the cursor in
    // it. Its list, if it has one, opens on a press on the box it is drawn in.
    const part = (typed ? frameOf(el) : undefined) ?? shownLabelOf(el);
    if (part) return part;
  }
  if (!canLook || rect.width < 120 || rect.height < 80 || el.matches(FRAMES)) return el;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const middle = document.elementFromPoint(Math.min(x, window.innerWidth - 1), Math.min(Math.max(y, 0), window.innerHeight - 1));
  if (!middle?.matches(FRAMES) || !el.contains(middle)) return el;
  const named = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id) : null))
    .find((part): part is HTMLElement => !!part && el.contains(part) && hasBox(part));
  if (named) return named;
  return Array.from(el.children).find((part) => !part.matches(FRAMES) && !part.contains(middle) && hasBox(part)) ?? el;
}

function hasBox(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

/** A field text is typed into, or a combobox: clicking its label puts the cursor in it and does nothing more. */
function takesText(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color", "hidden"].includes(el.type);
  return el.matches('[role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable]:not([contenteditable="false"])');
}

/**
 * The box a field is drawn in, when the field itself is a speck inside it: a
 * search input between the chips of a multiple select is a few pixels wide,
 * and the box round the chips is what a visitor sees and presses. It is the
 * nearest box around the field with a border, a shadow or a background of its
 * own, holding no other field and not the field's label.
 */
function frameOf(el: Element): Element | undefined {
  const labels = [...Array.from((el as HTMLInputElement).labels ?? []), ...(el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null))].filter(
    (label): label is HTMLElement => !!label,
  );
  let around = el.parentElement;
  for (let depth = 0; around && around !== document.body && depth < 5; depth++, around = around.parentElement) {
    const box = around;
    if (labels.some((label) => box.contains(label))) return undefined;
    if (Array.from(box.querySelectorAll('input:not([type="hidden"]), select, textarea')).some((field) => field !== el)) return undefined;
    const rect = box.getBoundingClientRect();
    if (rect.width * rect.height >= 60_000) return undefined;
    if (hasBox(box) && drawsBox(box)) return box;
  }
  return undefined;
}

/** Whether an element draws a box of its own: a border, a shadow, or a background that can be seen. */
function drawsBox(el: Element): boolean {
  const style = getComputedStyle(el);
  const seen = (color: string) => !/^(?:transparent|rgba\(.*,\s*0\))$/.test(color.trim());
  const border = ["top", "right", "bottom", "left"].some((side) => {
    const kind = style.getPropertyValue(`border-${side}-style`);
    return (parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0) > 0 && kind !== "none" && kind !== "hidden" && seen(style.getPropertyValue(`border-${side}-color`));
  });
  return border || style.boxShadow !== "none" || seen(style.backgroundColor);
}

/** The label a visitor sees for a field that is itself hidden or tiny: its own label, what names it, or a small box around it. */
function shownLabelOf(el: Element): Element | undefined {
  const labels = Array.from((el as HTMLInputElement).labels ?? []);
  const named = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null));
  const found = [...labels, el.closest("label"), ...named].find((part): part is HTMLElement => !!part && hasBox(part));
  if (found) return found;
  let around = el.parentElement;
  for (let depth = 0; around && around !== document.body && depth < 3; depth++, around = around.parentElement) {
    const rect = around.getBoundingClientRect();
    if (hasBox(around) && rect.width * rect.height < 60_000) return around;
  }
  return undefined;
}

/** One article under an answer: its title, linked when it has an address, and when it was last changed. */
function sourceRow(source: Source): HTMLElement {
  const row = document.createElement("li");
  const title = document.createElement(webAddress(source.url) ? "a" : "span");
  title.className = "title";
  title.textContent = source.title;
  if (title instanceof HTMLAnchorElement) Object.assign(title, { href: source.url, target: "_blank", rel: "noopener noreferrer" });
  row.append(title);
  const changed = source.updated ? new Date(`${source.updated}T00:00:00`) : undefined;
  if (changed && !Number.isNaN(changed.getTime())) {
    const day = changed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    row.append(source.stale ? `Updated ${day}. It may be out of date.` : `Updated ${day}`);
  }
  return row;
}

function webAddress(url: string | undefined): boolean {
  try {
    return /^https?:$/.test(new URL(url ?? "").protocol);
  } catch {
    return false;
  }
}

/**
 * Whether a menu or a panel moves the focus as it opens or closes: only when a
 * key did it, or a screen reader, which Base UI counts as keys. After a click
 * the focus is left where it is.
 *
 * Safari, and Firefox on a Mac, never give a clicked button the focus, so they
 * draw focus that a script moves after a click as if the keyboard had moved it,
 * with the blue ring. Base UI moves it back to the menu's button once the menu
 * has faded out, so choosing a page from the menu in the bar left the ring on
 * the bar's button, a moment after the new page was showing, and there it
 * stayed. A panel put it on its Close button as it slid in. From the keyboard
 * the focus has to move, so nobody loses their place, and the ring belongs.
 */
export function byKeyboard(interaction: string): boolean {
  return interaction === "keyboard";
}

// What a teaching link carries, apart from everything else about Teach
// Haptic (src/shared/teach.ts), so the widget's first file can find a link
// and the session a tab already holds without loading teach mode itself.

/** The name of the token in the address's fragment: #haptic-teach=<token>. */
export const TEACH_FRAGMENT = "haptic-teach";
/** A token or a claim: 32 random bytes in base64url. */
export const TEACH_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** Where a tab keeps its teaching (sessionStorage), so it carries on across page loads. */
export const TEACH_KEY = "haptic.teach";

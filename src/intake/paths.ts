import { normalizePath } from "../shared/types.ts";

// How the intake names a page and decides whether a link may be followed.
// Both readers use these, and the browser reader runs some of it inside the
// page, so nothing here may use Node.

/** Addresses that are files, not pages. */
export const NOT_PAGES = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|tar|csv|xlsx?|docx?|pptx?|css|js|json|xml|txt|rss|atom|mp3|mp4|webm|woff2?|ttf|eot)$/i;

/**
 * The page an address leads to, in the form the widget gives the model as the
 * visitor's path: ids collapsed to ":id", the route after "#/" kept for apps
 * that live behind one address, and the query only where it says which page
 * this is ("?action=history"). Path parameters such as ";jsessionid=…" are
 * dropped: a server that adds the session to every link would otherwise make
 * each link look like a different page.
 */
export function pageKey(address: string): string {
  const url = new URL(address);
  const path = normalizePath(url.pathname.replace(/;[^/]*/g, ""));
  const route = url.hash.startsWith("#/") ? normalizePath(url.hash.slice(1).split("?")[0] ?? "") : "";
  return path + whichPage(url.searchParams) + (route && route !== "/" ? `#${route}` : "");
}

/**
 * The part of a query that names a page: wordlike values only, so ids, tokens
 * and search text stay out. The widget keeps values of up to 30 letters; here
 * they may be longer, because some apps tell their pages apart only by a long
 * one ("?selectedItem=com.atlassian.jira.jira-projects-plugin:report-page"),
 * and the reader would otherwise take them all for one page.
 */
function whichPage(params: URLSearchParams): string {
  const kept: string[] = [];
  for (const [key, value] of params) {
    if (kept.length === 2) break;
    if (!/^[A-Za-z][\w-]{0,15}$/.test(key) || !/^[A-Za-z][A-Za-z_:.-]{0,59}$/.test(value)) continue;
    kept.push(`${key}=${value}`);
  }
  return kept.length ? `?${kept.join("&")}` : "";
}

/** The page one level up, for counting how many pages of one kind have been read. */
export function parentKey(key: string): string {
  const [path = "", route] = key.split("#");
  const up = (part: string) => part.replace(/\?.*$/, "").replace(/\/[^/]*$/, "") || "/";
  return route ? `${path}#${up(route)}` : up(path);
}

/**
 * Words that, in an address, mean loading it does something rather than shows
 * something. A reader that loads such an address could sign the account out,
 * delete a record or send a message, so it is never loaded. Following fewer
 * links costs little: a link that is not followed still appears in the map on
 * the page that has it.
 */
const ACTION_WORDS = [
  "log-?out", "sign-?out", "log-?off", "sign-?off", "logout", "signout", "logoff", "exit", "end-?session",
  "delete", "remove", "destroy", "drop", "purge", "erase", "trash", "wipe", "reset", "clear", "clean", "initiali[sz]e", "shut-?down", "start-?up", "restart",
  "revoke", "cancel", "approve", "reject", "deny", "decline", "accept", "confirm", "verify", "disable", "enable", "activate", "deactivate", "suspend",
  "subscribe", "unsubscribe", "vote", "unvote", "watch", "unwatch", "follow", "unfollow", "like", "unlike", "star", "unstar", "bookmark", "flag", "report-?abuse",
  "share", "snapshot", "shorten", "shortener", "short-?url", "export", "download", "print", "install", "uninstall", "upgrade", "execute", "trigger", "run", "rerun", "retry",
  "publish", "unpublish", "purchase", "buy", "donate", "archive", "unarchive", "restore", "rollback", "revert", "undo",
  "lock", "unlock", "block", "unblock", "impersonate", "switch-?user", "sudo", "toggle", "merge", "close", "reopen", "resolve", "redeem",
  "move", "copy", "clone", "duplicate", "import", "upload", "sync", "refresh", "deploy", "invite", "join", "leave-?group", "mark", "dismiss", "rotate",
];
/**
 * Words that name a form. The page that shows an empty form is safe to load and
 * worth having in the map ("/pim/addEmployee"), so these are allowed as the
 * last part of a path with no query. Anywhere else they are taken as the form
 * being sent: "/cart/add/12", "?add-to-cart=12", "/save?name=x".
 */
const FORM_WORDS = ["new", "create", "add", "edit", "update", "apply", "assign", "claim", "set", "save", "submit", "send", "generate", "transfer", "pay", "payment", "checkout"];
const asWord = (words: string[]) => new RegExp(`(?:^|[^a-z])(?:${words.join("|")})(?:$|[^a-z])`, "i");
const ACTION = asWord(ACTION_WORDS);
const FORM = asWord(FORM_WORDS);
/** Query keys that carry a token or a signature: such a link does something, or works only once. */
const TOKEN_KEY = /token|csrf|xsrf|nonce|sesskey|signature|^sig$|^auth|secret|^key$|otp|^code$|^hash$|^state$/i;
/** Labels of links that sign in, sign up or sign out. A sign-in page adds nothing to the map, and the others must not be loaded. */
const ACCOUNT_LABEL = /\b(log ?in|log ?out|sign ?in|sign ?out|sign ?up|register|log ?off)\b/i;
const ACCOUNT_PATH = /(?:^|[^a-z])(?:log-?in|sign-?in|sign-?up|register|auth)(?:$|[^a-z])/i;

/**
 * Why a link must not be loaded, or "" when it may be. `skip` holds patterns
 * the person running the intake gave for parts of the site to leave alone.
 */
export function reasonNotToFollow(address: string, label: string, skip: RegExp[] = []): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "not an address";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "not a web page";
  if (NOT_PAGES.test(url.pathname)) return "a file, not a page";
  const words = (text: string) => {
    try {
      return decodeURIComponent(text).replace(/([a-z])([A-Z])/g, "$1-$2");
    } catch {
      return text;
    }
  };
  for (const pattern of skip) if (pattern.test(url.href) || pattern.test(label)) return `matches ${pattern}`;
  if (ACCOUNT_LABEL.test(label)) return "signs in, up or out";
  if (url.pathname.split("/").some((segment) => ACCOUNT_PATH.test(words(segment)))) return "signs in, up or out";
  const segments = url.pathname.split("/").filter(Boolean);
  const hasQuery = [...url.searchParams].length > 0;
  for (const [index, segment] of segments.entries()) {
    const text = words(segment.replace(/;.*$/, ""));
    if (ACTION.test(text)) return "its address names an action";
    // "/cart/add/12" sends a form; "/claim/viewClaimModule" is a section that happens to be named like one.
    const next = segments[index + 1];
    const sends = index === segments.length - 1 ? hasQuery : next !== undefined && normalizePath(`/${next.replace(/;.*$/, "")}`) === "/:id";
    if (FORM.test(text) && sends) return "its address sends a form";
  }
  for (const [key, value] of url.searchParams) {
    if (TOKEN_KEY.test(key)) return "its address carries a token";
    if (ACTION.test(words(key)) || ACTION.test(words(value))) return "its address names an action";
    if (FORM.test(words(key)) || FORM.test(words(value))) return "its address sends a form";
  }
  // An app that lives behind one address keeps its own path after "#/", and the same rules apply to it.
  if (/^#!?\//.test(url.hash)) {
    const route = new URL(url.hash.replace(/^#!?/, ""), "https://route.invalid");
    if (route.pathname !== "/" || route.search) return reasonNotToFollow(route.href, "", []);
  }
  return "";
}

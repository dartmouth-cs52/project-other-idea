// No extension on this import: the website imports this file too, and its settings refuse one.
import { questionKey } from "./types";

// Whether a visitor's question asks for the same task as one someone taught
// Haptic (src/shared/teach.ts). A taught route is a whole procedure, so a
// route used for the wrong task leads the visitor through the wrong thing
// step by step. Corrections match questions loosely, by shared words
// (`similarQuestion`): "delete a budget" is like "add a budget" there. Here
// the task has to agree:
//
// - the action: add or create, delete or remove, change or edit, view or
//   find, pay, invite, export, approve and the rest, each a class of verbs,
//   in English and the common words of the other languages the widget
//   reads, so "crear un budget" is "add a budget";
// - the thing acted on: the head of what follows the action, the last word
//   before a preposition, so "add a marketing budget" and "add a budget for
//   marketing" are about a budget, and "add a budget owner" is about an owner;
// - and neither asks what not to do: a question with "not", "don't",
//   "can't", "without" and the like never matches.
//
// When any of that cannot be read, the questions do not match: no action
// word, two different actions, a word that could be either ("set" alone is
// create or change), or no thing acted on. The same question, word for word
// once made comparable and plurals made singular, always matches.

/** The kinds of task, by what is done. */
export type Action =
  | "create"
  | "delete"
  | "change"
  | "view"
  | "pay"
  | "invite"
  | "export"
  | "upload"
  | "send"
  | "approve"
  | "reject"
  | "stop"
  | "start"
  | "explain";

/** Single words, folded (lower case, no accents), for each action. Forms a person types: the base, -s, -ing, -ed. */
const VERBS: Record<Exclude<Action, "explain">, string> = {
  create:
    "add adding added adds create creating created creates make making makes new issue issuing register build generate request " +
    "crear crea creo anadir anade agregar agrega nuevo nueva creer cree ajouter ajoute nouveau nouvelle erstellen erstelle anlegen hinzufugen neu neue neues neuen " +
    "criar adicionar novo nova creare aggiungere aggiungi nuovo nuova maken aanmaken toevoegen nieuw nieuwe",
  delete:
    "delete deleting deleted deletes remove removing removed removes erase archive archiving discard trash destroy " +
    "eliminar elimina borrar borra quitar supprimer supprime effacer retirer loschen losche entfernen excluir apagar remover eliminare cancellare rimuovere verwijderen",
  change:
    "change changing changed changes edit editing edited edits update updating updated updates modify modifying rename renaming raise raising increase " +
    "increasing lower lowering decrease reduce adjust move switch replace correct reassign assign categorize categorise recategorize " +
    "cambiar cambia editar modificar modifica actualizar modifier changer andern bearbeiten aktualisieren alterar cambiare modificare wijzigen aanpassen bewerken",
  view:
    "view viewing see find show list look check search track review browse compare " +
    "ver buscar encontrar mostrar voir trouver afficher chercher anzeigen finden sehen suchen vedere trovare bekijken vinden",
  pay: "pay paying paid pays payment settle buy buying purchase pagar pago payer paiement bezahlen zahlen pagare betalen",
  invite: "invite inviting invited invites invitar inviter einladen convidar invitare uitnodigen",
  export: "export exporting download downloading exportar descargar exporter telecharger exportieren herunterladen baixar scaricare exporteren downloaden",
  upload: "upload uploading import importing attach attaching subir importar importer hochladen importieren carregar caricare uploaden",
  send: "send sending sent submit submitting email share sharing enviar envoyer senden schicken inviare versturen",
  approve: "approve approving approved accept accepting aprobar approuver genehmigen aprovar approvare goedkeuren",
  reject: "reject rejecting decline declining deny rechazar rejeter ablehnen rejeitar rifiutare afwijzen",
  stop: "cancel cancelling canceling stop stopping disable disabling deactivate freeze freezing close closing pause suspend block lock unsubscribe cancelar desactivar annuler desactiver kundigen deaktivieren sperren",
  start: "enable enabling activate unfreeze unlock resume reopen restore activar reactivar activer aktivieren entsperren",
};

/** Two words that make one action: "set up" is create, "get rid of" is delete. Checked before single words. */
const PHRASES: [string[], Action][] = [
  [["set", "up"], "create"],
  [["sign", "up"], "create"],
  [["get", "rid"], "delete"],
  [["turn", "off"], "stop"],
  [["switch", "off"], "stop"],
  [["turn", "on"], "start"],
  [["switch", "on"], "start"],
  [["look", "up"], "view"],
  [["look", "at"], "view"],
  [["mark", "as"], "change"],
];

/** Words that could mean more than one task. A question whose only action word is one of these is not read. */
const AMBIGUOUS = new Set(["set", "do", "get", "manage", "handle", "use", "work", "go", "put", "start", "open", "fix", "sort", "configure", "setup"]);

/** Words that say the question is about not doing something. */
const NEGATIONS = new Set(["not", "dont", "doesnt", "didnt", "cant", "cannot", "wont", "never", "without", "no", "nothing", "unable", "except", "instead", "nicht", "kein", "keine", "pas", "nunca", "jamais", "nao", "niet", "geen"]);

/** Words of a question that say nothing about the task. */
const FILLER = new Set([
  "a", "an", "the", "and", "or", "i", "me", "my", "mine", "we", "our", "us", "you", "your", "it", "its", "this", "that", "these", "those", "there", "here",
  "how", "what", "where", "which", "who", "when", "why", "can", "could", "do", "does", "did", "should", "would", "will", "is", "are", "was", "be", "am",
  "please", "want", "need", "like", "help", "way", "able", "allowed", "possible", "some", "any", "one", "another", "all", "just", "also", "again", "now", "then",
  "pls", "plz", "asap", "quickly", "quick", "fast", "today", "soon", "yet", "still", "already", "really", "thanks", "thank", "thx", "ok", "okay", "hi", "hello", "hey",
  "un", "una", "uno", "unos", "el", "la", "los", "las", "le", "les", "des", "du", "mi", "mis", "mon", "ma", "mes", "ein", "eine", "einen", "einem", "der", "die", "das",
  "den", "dem", "mein", "meine", "o", "os", "as", "um", "uma", "meu", "minha", "il", "lo", "gli", "het", "een", "mijn", "como", "comment", "wie",
  "puedo", "je", "ich", "yo", "eu", "io", "ik", "kann", "peux", "posso", "kan",
]);

/** Words that start what is said about the thing acted on: everything after one is a detail, not the thing itself. */
const PREPOSITIONS = new Set([
  "for", "to", "in", "on", "at", "with", "of", "from", "by", "into", "onto", "about", "under", "over", "than", "per", "via", "as", "so", "if", "because", "before", "after",
  "para", "por", "en", "con", "de", "del", "al", "pour", "dans", "avec", "sur", "au", "aux", "fur", "zu", "zum", "zur", "im", "mit", "von", "vom", "auf", "voor", "naar", "met", "van", "op", "per", "da", "di", "nel", "nella", "sul",
]);

/** What a question is read as: its actions, the thing acted on, and whether it is about not doing something. */
export interface TaskReading {
  actions: Action[];
  /** The head of what is acted on, stemmed: "budget" for "a marketing budget for Q1". */
  object?: string;
  negated: boolean;
}

const ACTION_OF = new Map<string, Action>();
for (const [action, words] of Object.entries(VERBS) as [Action, string][]) for (const word of words.split(/\s+/)) ACTION_OF.set(word, action);

/** A question's words, made comparable and with accents taken off: "Crée un budget" is "cree un budget". */
function wordsOf(question: string): string[] {
  return questionKey(question)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    // "don't" is "don t" once punctuation is gone: put it back together, so it reads as one word.
    .replace(/\b(don|doesn|didn|can|won|isn|aren|shouldn|couldn|wouldn) t\b/g, "$1t")
    .split(" ")
    .filter(Boolean);
}

/** A word as it is compared: plurals made singular. "policies" is "policy", "budgets" is "budget". */
export function stemWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/** True for a question that asks what something is or how it works, rather than to do something. */
function asksToExplain(words: string[]): boolean {
  const [first, second] = words;
  if ((first === "what" || first === "whats") && (second === "is" || second === "are" || second === "does" || second === "s" || second === "do" || first === "whats")) return true;
  if (words.includes("explain") || words.includes("meaning") || words.includes("difference")) return true;
  if (first === "why") return true;
  return words.includes("work") && (first === "how" || first === "does" || first === "do");
}

/** Reads a question as a task. Undefined parts are what could not be read. */
export function readTask(question: string): TaskReading {
  const words = wordsOf(question);
  const actions = new Set<Action>();
  /** Where each action word is, so the thing acted on can be found after it. */
  const marked = new Set<number>();
  for (let at = 0; at < words.length; at++) {
    const phrase = PHRASES.find(([parts]) => parts.every((part, offset) => words[at + offset] === part));
    if (phrase) {
      actions.add(phrase[1]);
      phrase[0].forEach((_, offset) => marked.add(at + offset));
      at += phrase[0].length - 1;
      continue;
    }
    const action = ACTION_OF.get(words[at]!);
    if (action) {
      actions.add(action);
      marked.add(at);
    }
  }
  const negated = words.some((word) => NEGATIONS.has(word));
  if (!actions.size && asksToExplain(words)) actions.add("explain");
  // A question that only asks what something is, with an action word inside ("what does archive do"), is about the word.
  if (asksToExplain(words) && words[0] !== "why") {
    actions.clear();
    actions.add("explain");
  }
  // "Adding a teammate" is inviting one.
  const object = objectOf(words, marked);
  if (actions.has("create") && object && PEOPLE.has(object)) {
    actions.delete("create");
    actions.add("invite");
  }
  return { actions: [...actions].sort(), ...(object ? { object } : {}), negated };
}

/** Heads that are people: adding one of them is inviting them. */
const PEOPLE = new Set(["user", "teammate", "member", "person", "people", "employee", "colleague", "coworker", "admin", "approver", "collaborator"]);

/**
 * The head of what is acted on: the content words after the first action
 * word, up to a preposition, and the last of them. A language that puts the
 * verb last ("budget erstellen") has them before it instead.
 */
function objectOf(words: string[], marked: Set<number>): string | undefined {
  const content = (at: number) => {
    const word = words[at]!;
    return !marked.has(at) && !FILLER.has(word) && !NEGATIONS.has(word) && !AMBIGUOUS.has(word) && word.length > 1 && !/^\d+$/.test(word) && !/^\[(?:email|number)\]$/.test(word);
  };
  const firstAction = [...marked].sort((a, b) => a - b)[0];
  const phrase: string[] = [];
  if (firstAction !== undefined) {
    for (let at = firstAction + 1; at < words.length; at++) {
      if (PREPOSITIONS.has(words[at]!) && phrase.length) break;
      if (PREPOSITIONS.has(words[at]!) || marked.has(at)) continue;
      if (content(at)) phrase.push(words[at]!);
    }
    if (!phrase.length) {
      // The verb comes last: what is acted on is just before it, after any detail with a preposition.
      for (let at = firstAction - 1; at >= 0; at--) {
        if (PREPOSITIONS.has(words[at]!)) break;
        if (content(at)) phrase.unshift(words[at]!);
      }
    }
  } else {
    for (let at = 0; at < words.length; at++) {
      if (PREPOSITIONS.has(words[at]!) && phrase.length) break;
      if (content(at)) phrase.push(words[at]!);
    }
  }
  const head = phrase[phrase.length - 1];
  return head ? stemWord(head) : undefined;
}

/**
 * True when a visitor's question asks for the same task as the question a
 * route was taught for. Unsure is no.
 */
export function sameTask(taught: string, asked: string): boolean {
  const [a, b] = [wordsOf(taught), wordsOf(asked)];
  if (!a.length || !b.length) return false;
  if (a.map(stemWord).join(" ") === b.map(stemWord).join(" ")) return true;
  const [x, y] = [readTask(taught), readTask(asked)];
  if (x.negated || y.negated) return false;
  if (!x.actions.length || x.actions.length !== y.actions.length || x.actions.some((action, index) => action !== y.actions[index])) return false;
  if (x.actions.includes("explain")) return false;
  return !!x.object && x.object === y.object;
}

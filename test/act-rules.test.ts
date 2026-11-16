import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAction,
  isDismissName,
  classAsked,
  dateLike,
  grounded,
  isForwardName,
  isSearchName,
  isSecretField,
  isTypeToConfirm,
  LANGUAGES,
  namesADay,
  pickChoice,
  readAddress,
  readName,
  safeWordsFor,
  wordsFor,
  type CommitClass,
  type Language,
} from "../src/shared/act-rules.ts";
import { pressLeftToVisitor } from "../src/server/check.ts";
import { actingAllowedAt, actionsAllowed, ACTS, type SnapElement, type Snapshot, type TurnReply } from "../src/shared/types.ts";

// The pure half of acting's safety gate: the word tables in every shipped
// language, grounding of values in the visitor's own words, and the check every
// act reply passes. Each table below is checked row by row, and a failure
// lists every row that went wrong, not only the first.

/** Runs `check` on every row and fails once with all the rows it did not hold for. */
function rows<T>(list: T[], check: (row: T) => string | undefined) {
  const wrong = list.map(check).filter((problem): problem is string => !!problem);
  assert.deepEqual(wrong, [], `${wrong.length} of ${list.length} rows are wrong:\n${wrong.join("\n")}`);
}

const CLASSES: CommitClass[] = ["destroy", "money", "session", "send", "save", "dataOut", "secret"];

// The tables -----------------------------------------------------------------

for (const language of LANGUAGES) {
  test(`every ${language} commit word reads as its class on a button`, () => {
    const all = CLASSES.flatMap((commit) => wordsFor(language, commit).map((word) => ({ commit, word })));
    assert.ok(all.length >= 40, `only ${all.length} commit words for ${language}`);
    rows(all, ({ commit, word }) => {
      const verdict = readName(word);
      return verdict.commit === commit ? undefined : `"${word}" should be ${commit}, read ${JSON.stringify(verdict)}`;
    });
  });

  test(`every ${language} dialog word commits in a dialog and nowhere else`, () => {
    const words = wordsFor(language, "dialog");
    assert.ok(words.length >= 3);
    rows(words, (word) => {
      const inDialog = readName(word, { dialog: true });
      const outside = readName(word);
      if (!inDialog.commit) return `"${word}" does not commit in a dialog`;
      if (outside.commit === "dialog") return `"${word}" commits outside a dialog`;
      return undefined;
    });
  });

  test(`every ${language} safe word is safe and commits nothing`, () => {
    const words = safeWordsFor(language);
    assert.ok(words.length >= 15, `only ${words.length} safe words for ${language}`);
    rows(words, (word) => {
      const verdict = readName(word);
      return verdict.safe && !verdict.commit ? undefined : `"${word}" read ${JSON.stringify(verdict)}`;
    });
  });
}

test("the verbs the design names first, in each language, commit with the right class", () => {
  const named: [Language, string, CommitClass][] = [
    ["es", "Eliminar", "destroy"], ["es", "Borrar", "destroy"], ["es", "Guardar", "save"], ["es", "Enviar", "send"], ["es", "Pagar", "money"], ["es", "Emitir tarjeta", "save"], ["es", "Aprobar", "save"], ["es", "Cerrar sesión", "session"],
    ["fr", "Supprimer", "destroy"], ["fr", "Enregistrer", "save"], ["fr", "Envoyer", "send"], ["fr", "Payer", "money"], ["fr", "Valider", "save"], ["fr", "Se déconnecter", "session"],
    ["de", "Löschen", "destroy"], ["de", "Speichern", "save"], ["de", "Senden", "send"], ["de", "Bezahlen", "money"], ["de", "Abmelden", "session"], ["de", "Konto löschen", "destroy"],
    ["pt", "Excluir conta", "destroy"], ["pt", "Salvar", "save"], ["pt", "Enviar", "send"], ["pt", "Pagar", "money"], ["pt", "Sair", "session"],
    ["it", "Elimina", "destroy"], ["it", "Salva", "save"], ["it", "Invia", "send"], ["it", "Paga", "money"], ["it", "Esci", "session"],
    ["nl", "Verwijderen", "destroy"], ["nl", "Opslaan", "save"], ["nl", "Versturen", "send"], ["nl", "Betalen", "money"], ["nl", "Uitloggen", "session"],
    ["ja", "削除", "destroy"], ["ja", "保存する", "save"], ["ja", "送信", "send"], ["ja", "支払う", "money"], ["ja", "ログアウト", "session"], ["ja", "カード番号を表示", "secret"],
    ["zh", "删除", "destroy"], ["zh", "保存", "save"], ["zh", "发送", "send"], ["zh", "付款", "money"], ["zh", "退出登录", "session"], ["zh", "导出", "dataOut"],
    ["en", "Delete workspace", "destroy"], ["en", "Issue card", "save"], ["en", "Place order", "money"], ["en", "Log out", "session"], ["en", "Copy link", "dataOut"], ["en", "Reveal card number", "secret"], ["en", "Save draft", "save"], ["en", "Send invite", "send"],
  ];
  rows(named, ([language, name, commit]) => {
    const verdict = readName(name);
    return verdict.commit === commit ? undefined : `${language} "${name}" should be ${commit}, read ${JSON.stringify(verdict)}`;
  });
});

test("cancel and close are safe alone or with a word for the screen, and end something with a noun of their own, in every language", () => {
  const ends = ["Cancel order", "Cancel subscription", "Close ticket", "Cancelar pedido", "Cerrar ticket", "Annuler la commande", "Fermer le ticket", "Vorgang abbrechen", "Ticket schließen", "Cancelar pedido", "Fechar ticket", "Annulla ordine", "Chiudi ticket", "Bestelling annuleren", "Ticket sluiten", "注文をキャンセル", "チケットを閉じる", "取消订单", "关闭工单", "Cancel all"];
  const safe = ["Cancel", "Close", "Close dialog", "Close menu", "Cerrar", "Cerrar ventana", "Annuler", "Fermer la fenêtre", "Abbrechen", "Dialog schließen", "Cancelar", "Fechar janela", "Annulla", "Chiudi finestra", "Annuleren", "Venster sluiten", "キャンセル", "ダイアログを閉じる", "取消", "关闭对话框"];
  rows(ends, (name) => (readName(name).commit === "destroy" ? undefined : `"${name}" should end something, read ${JSON.stringify(readName(name))}`));
  rows(safe, (name) => {
    const verdict = readName(name);
    return verdict.safe && !verdict.commit ? undefined : `"${name}" should be safe, read ${JSON.stringify(verdict)}`;
  });
});

test("a choice in a list is stopped only by words that destroy, spend, sign in or out, take data out or reveal; a button, or a link, by any commit word", () => {
  // A choice's words are the page's own value ("Approved", "Send later"). A link's are a verb, as a button's are: a script can make
  // "<a href="#">Send invite</a>" send, and a page can act on the visit itself, so a link is read as a button is.
  const choice: [string, CommitClass | undefined][] = [
    ["Issue card", undefined], ["Send invite", undefined], ["Create bill", undefined], ["Save view", undefined], ["Request a card", undefined],
    ["Delete", "destroy"], ["Pay bill", "money"], ["Sign out", "session"], ["Export", "dataOut"], ["Download statement", "dataOut"], ["Reveal card number", "secret"], ["Copy link", "dataOut"],
  ];
  rows(choice, ([name, commit]) => {
    const asChoice = readName(name, { choice: true }).commit;
    const asButton = readName(name).commit;
    if (asChoice !== commit) return `choice "${name}" read ${asChoice}, wanted ${commit}`;
    if (!asButton) return `button "${name}" does not commit`;
    return undefined;
  });
});

test("a link's address commits as a button's words do: its path, its query and a route after #/", () => {
  const addresses: [string, CommitClass | undefined][] = [
    ["/expenses/7/approve", "save"], ["/expenses/:id/approve", "save"], ["/invites/3/resend", "send"], ["/posts/9/publish", "send"], ["/account/delete", "destroy"],
    ["/logout", "session"], ["/orders/5/cancel", "destroy"], ["/admin?action=delete&id=4", "destroy"], ["/#/expenses/7/approve", "save"], ["/approveExpense?id=7", "save"],
    ["/approve_expense/7", "save"], ["https://shop.test/unsubscribe/abc123", "destroy"], ["/team/send-invite", "send"],
    ["/team", undefined], ["/team/members", undefined], ["/expenses/7", undefined], ["/expenses?status=approved", undefined], ["/cards/new", undefined], ["/settings/notifications", undefined], ["/orders", undefined], ["/", undefined],
  ];
  rows(addresses, ([address, commit]) => (readAddress(address).commit === commit ? undefined : `"${address}" read ${JSON.stringify(readAddress(address))}, wanted ${commit}`));
  assert.equal(readAddress("/rooms/12/book-a-room", ["book a room"]).marked, true);
});

test("a control that opens a menu or dialog is stopped only by words that destroy, spend, sign in or out, or reveal", () => {
  const opener: [string, CommitClass | undefined][] = [["Share", undefined], ["Export", undefined], ["Invite people", undefined], ["Save as", undefined], ["Delete", "destroy"], ["Buy", "money"], ["Sign out", "session"], ["Show card number", "secret"]];
  rows(opener, ([name, commit]) => (readName(name, { opener: true }).commit === commit ? undefined : `"${name}" read ${JSON.stringify(readName(name, { opener: true }))}`));
});

test("dialog words commit only in a dialog", () => {
  for (const word of ["OK", "Yes", "Done", "Continue", "Sí", "Oui", "Ja", "Sim", "Doorgaan", "はい", "继续"]) {
    assert.ok(readName(word, { dialog: true }).commit, `"${word}" in a dialog`);
    assert.notEqual(readName(word).commit, "dialog", `"${word}" outside a dialog`);
  }
  // "Weiter" is German for Next outside a dialog, and Continue inside one.
  assert.equal(readName("Weiter").safe, true);
  assert.equal(readName("Weiter", { dialog: true }).commit, "dialog");
});

test("the names of a button that only puts a dialog away, in the shipped languages", () => {
  for (const name of ["Cancel", "Close", "Dismiss", "Not now", "Cerrar", "Annuler", "Schließen", "Fechar", "Chiudi", "Sluiten", "キャンセル", "关闭", "×"]) assert.equal(isDismissName(name), true, name);
  for (const name of ["Show details", "Continue", "Delete", "Cancel card", "Close account", "OK"]) assert.equal(isDismissName(name), false, name);
});

test("an icon names a control only when it has no words: a labelled Close with an X icon may be pressed, an icon-only trash may not", () => {
  const snapshot = (element: SnapElement) => ({ path: "/", title: "", headings: [], text: [], elements: [element], truncated: false });
  const reply = (target: string): TurnReply => ({ target, do: "click", commits: false, status: "continue", say: "Closing it.", mode: "act" });
  assert.equal(checkAction(reply("e1"), { goal: "close this", snapshot: snapshot({ id: "e1", role: "button", label: "Close", icon: "x" }) }).withheld, undefined);
  assert.equal(checkAction(reply("e1"), { goal: "tidy up", snapshot: snapshot({ id: "e1", role: "button", label: "", icon: "trash-2" }) }).withheld, "words");
});

test("icon names count: trash, log-out, power, send, save, download", () => {
  const icons: [string, CommitClass][] = [["trash-2", "destroy"], ["log-out", "session"], ["power", "session"], ["send", "send"], ["save", "save"], ["floppy-disk", "save"], ["download", "dataOut"]];
  rows(icons, ([icon, commit]) => (readName(` ${icon}`).commit === commit ? undefined : `icon ${icon} read ${JSON.stringify(readName(icon))}`));
});

test("words for a filter change the view, not the data; the same verbs on data still commit", () => {
  for (const name of ["Remove filter", "Reset filters", "Apply filters", "Clear selection", "Quitar filtros", "Réinitialiser les filtres", "Filter zurücksetzen"]) assert.equal(readName(name).commit, undefined, name);
  for (const name of ["Remove member", "Reset password", "Apply changes", "Delete filter"]) assert.ok(readName(name).commit, name);
});

test("a site's own commit words are marked", () => {
  assert.deepEqual(readName("Book now", { extra: ["Book"] }), { commit: "save", marked: true, safe: false });
  assert.deepEqual(readName("Lodge claim", { extra: ["Lodge claim"] }), { commit: "save", marked: true, safe: false });
  assert.equal(readName("Lodge details", { extra: ["Lodge claim"] }).marked, undefined);
  // The site's words stop even a choice.
  assert.equal(readName("Book a room", { choice: true, extra: ["book a room"] }).marked, true);
});

test("show words with a secret's noun reveal; show alone and show details do not", () => {
  for (const name of ["Show card number", "View full number", "Show API key", "Show password", "Mostrar número de tarjeta", "Afficher le numéro de carte", "Kartennummer anzeigen", "Mostrar senha", "Mostra numero di carta", "Toon wachtwoord", "カード番号を表示", "显示卡号", "Reveal", "Unmask"]) {
    assert.equal(readName(name).commit, "secret", name);
  }
  for (const name of ["Show", "Show details", "Show more", "View all", "Ver más"]) assert.equal(readName(name).commit, undefined, name);
});

test("a name that is not wholly safe is not safe", () => {
  for (const name of ["New bill", "Add member", "Back to cards", "Next", "Go back"]) {
    const verdict = readName(name);
    assert.equal(verdict.safe, ["Next", "Go back"].includes(name), `${name}: ${JSON.stringify(verdict)}`);
  }
  assert.equal(readName("Next →").safe, true);
  assert.equal(readName("Next chevron-right").safe, true);
});

test("the visitor's words ask for a class in every language, and a question about something else asks for none", () => {
  const asked: [CommitClass, string][] = [
    ["destroy", "delete the old workspace"], ["destroy", "please remove Sam from the team"], ["destroy", "cancel my subscription"], ["destroy", "close my account"], ["destroy", "borra la tarjeta de Sam"], ["destroy", "supprimer mon compte"], ["destroy", "Konto löschen"], ["destroy", "excluir a fatura"], ["destroy", "elimina il progetto"], ["destroy", "verwijder de kaart"], ["destroy", "カードを削除して"], ["destroy", "删除这张卡"],
    ["money", "pay the Acme bill"], ["money", "make a payment to Acme"], ["money", "buy more seats"], ["money", "paga la factura"], ["money", "payer la facture"], ["money", "Rechnung bezahlen"], ["money", "pagar a conta"], ["money", "betaal de factuur"], ["money", "請求書を支払う"], ["money", "付款给供应商"],
    ["session", "how do I log out"], ["session", "sign me in"], ["session", "cerrar sesión"], ["session", "se déconnecter"], ["session", "abmelden"], ["session", "ログアウトしたい"], ["session", "退出登录"],
    ["secret", "show me my card number"], ["secret", "reveal the API key"], ["secret", "what is my card's CVC"], ["secret", "muestra el número de tarjeta"], ["secret", "カード番号を表示"],
  ];
  rows(asked, ([commit, words]) => (classAsked(commit, words) ? undefined : `"${words}" should ask for ${commit}`));
  const question = "Can you issue Malika Cummerata a virtual card called Ads with a $500 monthly limit?";
  rows(["destroy", "money", "session", "secret"] as CommitClass[], (commit) => (classAsked(commit, question) ? `the card question asks for ${commit}` : undefined));
});

test("a button that moves a form on is named so in every language, and nothing else is", () => {
  rows(["Next", "Next →", "Next step", "Continue", "Siguiente", "Continuar", "Suivant", "Weiter", "Próximo", "Avanti", "Volgende", "次へ", "下一步", "继续"], (name) => (isForwardName(name) ? undefined : `"${name}" moves a form on`));
  rows(["Back", "Next page of results", "Save and continue", "Cancel", "Issue card", "次へ進む前に保存"], (name) => (isForwardName(name) ? `"${name}" is not only a forward button` : undefined));
});

// Fields ---------------------------------------------------------------------

test("fields Haptic never types into, in every language", () => {
  const secret = [
    "Password", "Current password", "new-password", "current-password", "one-time-code", "cc-number", "cc-csc", "cc-exp", "Card number", "CVC", "CVV", "Security code", "Expiry date", "IBAN", "Routing number", "Account number", "SSN", "PIN", "One-time code", "Verification code", "API key", "Client secret", "Access token", "secretKey", "api_key",
    "Contraseña", "Número de tarjeta", "Código de seguridad", "Mot de passe", "Numéro de carte", "Passwort", "Kartennummer", "Senha", "Número do cartão", "Password attuale", "Numero di carta", "Wachtwoord", "Kaartnummer", "パスワード", "カード番号", "密码", "卡号", "验证码",
    "Type DELETE to confirm", "Escribe ELIMINAR para confirmar", "Tapez SUPPRIMER pour confirmer", "Geben Sie LÖSCHEN ein, um zu bestätigen", "Digite EXCLUIR para confirmar", "Digita ELIMINA per confermare", "Typ VERWIJDEREN om te bevestigen", "To confirm, type the workspace name", "確認のため「削除」と入力", "输入 删除 以确认",
  ];
  const plain = ["Card name", "Spending limit", "Name", "Email", "Notes", "Search people", "Memo", "Nombre de la tarjeta", "Nom de la carte", "Kartenname", "Promo code", "Postal code", "Description"];
  rows(secret, (words) => (isSecretField(words) ? undefined : `"${words}" should be a field Haptic never types into`));
  rows(plain, (words) => (isSecretField(words) ? `"${words}" is not secret` : undefined));
  assert.equal(isTypeToConfirm("Type DELETE to confirm"), true);
  assert.equal(isTypeToConfirm("Confirm the amount"), false);
});

test("search boxes are named in every language", () => {
  rows(["Search", "Search people", "Filter by name", "Find a card", "Buscar", "Rechercher", "Suchen", "Pesquisar", "Cerca", "Zoeken", "検索", "搜索"], (name) => (isSearchName(name) ? undefined : `"${name}" is a search box`));
  rows(["Card name", "Amount", "Memo"], (name) => (isSearchName(name) ? `"${name}" is not a search box` : undefined));
});

// Grounding --------------------------------------------------------------------

const CARD_QUESTION = "Can you issue Malika Cummerata a virtual card called Ads with a $500 monthly limit?";

test("a value is grounded only by the visitor's own words", () => {
  const cases: [value: string, words: string, expected: boolean][] = [
    ["Ads", CARD_QUESTION, true],
    ["Malika Cummerata", CARD_QUESTION, true],
    ["Malika", CARD_QUESTION, true],
    ["Maya", CARD_QUESTION, false],
    ["Marketing", CARD_QUESTION, false],
    // Numbers compare by their digits, whatever the currency sign and grouping marks.
    ["500", CARD_QUESTION, true],
    ["$500", CARD_QUESTION, true],
    ["500.00", CARD_QUESTION, true],
    ["5000", CARD_QUESTION, false],
    ["50", CARD_QUESTION, false],
    ["1500", "set the limit to $1,500", true],
    ["1,500", "set the limit to 1500", true],
    ["1500", "Limit auf 1.500,00 € setzen", true],
    ["1500", "limite de 1 500 €", true],
    ["15", "a limit of 1.5", false],
    ["4.5", "a rating of 4,5", true],
    // Small words do not count; a word counts when one starts the other and both have four letters or more.
    ["Per month", CARD_QUESTION, true],
    ["Per month", "with $500 a month", true],
    ["Per day", CARD_QUESTION, false],
    ["Monthly", "500 each month", true],
    ["For someone else", CARD_QUESTION, false],
    // Emails compare whole.
    ["sam@acme.com", "invite sam@acme.com as an admin", true],
    ["finance@evil.example", "send it to finance", false],
    ["sam@acme.co", "invite sam@acme.com", false],
    // Accents and case are folded.
    ["José Núñez", "give jose nunez a card", true],
    ["Zoë", "card for ZOE", true],
    ["Müller", "Karte für Herrn Muller", true],
    // Other languages, and their small words.
    ["Por mes", "con un límite de 500 al mes", true],
    ["Par mois", "avec une limite de 500 par mois", true],
    ["広告", "広告という名前のカードを作って", true],
    ["営業", "広告という名前のカードを作って", false],
    // A value that is only small words is grounded only when written whole.
    ["the", "give the card", true],
    ["a", "no such word here", false],
  ];
  rows(cases, ([value, words, expected]) => (grounded(value, words) === expected ? undefined : `"${value}" in "${words}" should be ${expected}`));
});

test("an ISO date is grounded by the same date in the visitor's words, in figures, by name or by a day word", () => {
  const cases: [iso: string, words: string, expected: boolean][] = [
    ["2026-12-01", "on 2026-12-01", true],
    ["2026-12-01", "on 1 December", true],
    ["2026-12-01", "on December 1st", true],
    ["2026-12-01", "on Dec 1", true],
    ["2026-12-01", "le 1er décembre", true],
    ["2026-12-01", "am 1. Dezember", true],
    ["2026-12-01", "el 1 de diciembre", true],
    ["2026-12-01", "on 12/1/2026", true],
    ["2026-12-01", "on 1.12.2026", true],
    ["2026-12-01", "12月1日に", true],
    ["2026-12-01", "tomorrow", true],
    ["2026-12-01", "next friday", true],
    ["2026-12-02", "on 1 December", false],
    ["2026-11-01", "on 1 December", false],
    ["2026-12-01", "on 12/1/2025", false],
    ["2026-12-01", "set the limit", false],
    ["2026-05-01", "you may do it", false],
  ];
  rows(cases, ([iso, words, expected]) => (grounded(iso, words) === expected ? undefined : `${iso} in "${words}" should be ${expected}`));
});

test("a choice is found by exact words, then by its start, then by its words; two at once is ambiguous", () => {
  assert.equal(pickChoice("Per month", ["Per day", "Per week", "Per month"]), 2);
  assert.equal(pickChoice("per MONTH", ["Per day", "Per month"]), 1);
  assert.equal(pickChoice("Malika", ["Malika Cummerata", "Mal Jones"]), 0);
  assert.equal(pickChoice("Monthly", ["Per day", "Per month"]), 1);
  assert.equal(pickChoice("Maya", ["Maya Lee", "Maya Chen"]), "ambiguous");
  assert.equal(pickChoice("Yearly", ["Per day", "Per month"]), -1);
  assert.equal(pickChoice("", ["Per day"]), -1);
});

test("a date is written in the pattern a field shows", () => {
  const date = { year: 2026, month: 12, day: 1 };
  assert.equal(dateLike("MM-DD-YYYY", date), "12-01-2026");
  assert.equal(dateLike("dd/mm/yyyy", date), "01/12/2026");
  assert.equal(dateLike("YYYY.MM.DD", date), "2026.12.01");
  assert.equal(dateLike("d/m/yy", date), "1/12/26");
  assert.equal(dateLike("Pick a date", date), undefined);
});

test("a calendar's names for its days are read as days, and other words with numbers are not", () => {
  for (const name of ["Friday, November 20th, 2026", "Today, Monday, November 16th, 2026", "20 nov. 2026", "vendredi 20 novembre 2026", "2026-11-20", "20/11/2026"]) assert.ok(namesADay(name), name);
  for (const name of ["20", "November 2026", "Step 3 of 4", "Expenses 19", "$1,500.00", "May I help"]) assert.ok(!namesADay(name), name);
});

// The check on a reply ------------------------------------------------------------

const element = (id: string, role: string, label: string, extra: Partial<SnapElement> = {}): SnapElement => ({ id, role, label, ...extra });
const PAGE: Snapshot = {
  path: "/cards/new",
  title: "Issue a card",
  headings: ["Issue a card"],
  text: [],
  truncated: false,
  elements: [
    element("e1", "link", "Issue card", { href: "/cards/new" }),
    element("e2", "button", "Next"),
    element("e3", "button", "Issue card"),
    element("e4", "textbox", "Card name"),
    element("e5", "textbox", "Spending limit"),
    element("e6", "combobox", "Limit interval", { options: ["Per day", "Per week", "Per month"] }),
    element("e7", "radio", "For someone else"),
    element("e8", "switch", "Lock to one merchant"),
    element("e9", "textbox", "Password"),
    element("e10", "link", "Help center", { href: "external:help.example.com" }),
    element("e11", "searchbox", "Search people"),
    element("e12", "button", "Delete workspace"),
    element("e13", "slider", "Limit"),
    element("e14", "button", "Save", { state: ["disabled"] }),
    element("e15", "button", "Share", { state: ["opens a menu"] }),
    element("e16", "button", "Book"),
    element("e17", "select", "Country", { options: ["France", "Germany"] }),
    element("e18", "option", "Sign out"),
    element("e19", "option", "Per month"),
    element("e20", "menuitemradio", "Compact"),
    element("e21", "treeitem", "Marketing"),
    element("e22", "link", "Cards", { href: "/cards" }),
    element("e23", "link", "Send invite", { href: "/team" }),
    element("e24", "link", "Publish"),
    element("e25", "link", "Expense 7", { href: "/expenses/:id/approve" }),
    element("e26", "link", "Book a room", { href: "/rooms" }),
  ],
};
const ask = (reply: Partial<TurnReply>, goal = CARD_QUESTION, snapshot = PAGE) =>
  checkAction({ target: null, status: "continue", say: "Doing it.", mode: "act", ...reply }, { goal, snapshot }, { commitWords: ["Book"] });

test("a reply that may be done keeps its do and its value", () => {
  const kept: Partial<TurnReply>[] = [
    { target: "e22", do: "click" },
    { target: "e2", do: "click" },
    { target: "e4", do: "type", enter: "Ads" },
    { target: "e5", do: "type", enter: "500" },
    { target: "e6", do: "choose", enter: "Per month" },
    { target: "e6", do: "choose", enter: "Monthly" },
    { target: "e7", do: "click" },
    { target: "e7", do: "check" },
    { target: "e8", do: "check" },
    { target: "e8", do: "uncheck" },
    { target: "e11", do: "press_enter" },
    { target: "e15", do: "click" },
    { target: "e19", do: "click" },
  ];
  rows(kept, (reply) => {
    const { reply: out, withheld } = ask(reply);
    if (withheld || out.do !== reply.do) return `${JSON.stringify(reply)} was withheld: ${withheld}`;
    if ((reply.do === "type" || reply.do === "choose") && out.enter !== reply.enter) return `${JSON.stringify(reply)} lost its value`;
    if (out.withheld) return `${JSON.stringify(reply)} carries withheld`;
    return undefined;
  });
});

test("every reply that may not be done loses its do and says why", () => {
  const withheld: [Partial<TurnReply>, string][] = [
    // A do on the commit is the hand-over, whatever the model called it.
    [{ target: "e3", do: "click", commits: true }, "contradiction"],
    [{ target: "e3", do: "click", commits: false }, "words"],
    [{ target: "e12", do: "click" }, "words"],
    [{ target: "e16", do: "click" }, "marked"],
    [{ target: "e18", do: "click" }, "words"],
    [{ target: "e10", do: "click" }, "leaves"],
    // A link is read as a button is, and its address too: whatever the model calls it, Haptic never presses a link that sends, saves or approves.
    [{ target: "e1", do: "click" }, "words"],
    [{ target: "e23", do: "click", commits: false }, "words"],
    [{ target: "e24", do: "click" }, "words"],
    [{ target: "e25", do: "click" }, "words"],
    [{ target: "e26", do: "click" }, "marked"],
    [{ target: "e9", do: "type", enter: "hunter2" }, "secret"],
    [{ target: "e4", do: "type", enter: "Marketing" }, "ungrounded"],
    [{ target: "e4", do: "type", enter: "" }, "ungrounded"],
    [{ target: "e4", do: "type" }, "ungrounded"],
    [{ target: "e5", do: "type", enter: "5000" }, "ungrounded"],
    [{ target: "e6", do: "choose", enter: "Per day" }, "ungrounded"],
    [{ target: "e17", do: "choose", enter: "Germany" }, "ungrounded"],
    [{ target: "e4", do: "type", enter: "x".repeat(401) }, "cap"],
    [{ target: "e4", do: "press_enter" }, "enter"],
    [{ target: "e2", do: "type", enter: "Ads" }, "unfit"],
    [{ target: "e4", do: "click" }, "unfit"],
    [{ target: "e7", do: "uncheck" }, "unfit"],
    [{ target: "e13", do: "click" }, "unfit"],
    [{ target: "e14", do: "click" }, "unfit"],
    [{ target: "e2", do: "drag" as never }, "unfit"],
    [{ target: "e99", do: "click" }, "changed"],
    [{ target: null, do: "click" }, "changed"],
  ];
  rows(withheld, ([reply, why]) => {
    const { reply: out, withheld: reason } = ask(reply);
    if (reason !== why) return `${JSON.stringify(reply)} gave ${reason}, wanted ${why}`;
    if (out.do || out.enter) return `${JSON.stringify(reply)} kept ${out.do} ${out.enter}`;
    if (out.withheld !== why) return `${JSON.stringify(reply)} does not carry withheld`;
    // Which act was removed is said too, when it is one of Haptic's.
    if (out.removed !== ((ACTS as readonly string[]).includes(reply.do ?? "") ? reply.do : undefined)) return `${JSON.stringify(reply)} says it removed ${out.removed}`;
    if (reply.commits !== undefined && out.commits !== reply.commits) return `${JSON.stringify(reply)} changed commits`;
    return undefined;
  });
});

test("acts that mean the same on a control are done as the one that fits it: choosing a radio, a menu radio, an option or a tree item is a click", () => {
  // Seen live: "choose" on the radio "For someone else" and on the option "Per month" of an open list, removed as unfit, and the visitor told Haptic could not do it.
  const same: [Partial<TurnReply>, string][] = [
    [{ target: "e7", do: "choose", enter: "For someone else" }, "click"],
    [{ target: "e7", do: "choose", enter: null }, "click"],
    [{ target: "e7", do: "check" }, "check"],
    [{ target: "e7", do: "click" }, "click"],
    [{ target: "e19", do: "choose", enter: "Per month" }, "click"],
    [{ target: "e19", do: "choose", enter: "Monthly" }, "click"],
    [{ target: "e20", do: "choose", enter: "Compact" }, "click"],
    [{ target: "e20", do: "check" }, "check"],
    [{ target: "e21", do: "choose", enter: "Marketing" }, "click"],
  ];
  rows(same, ([reply, act]) => {
    const { reply: out, withheld } = ask(reply);
    if (withheld) return `${JSON.stringify(reply)} was withheld: ${withheld}`;
    if (out.do !== act) return `${JSON.stringify(reply)} became ${out.do}, wanted ${act}`;
    // The control itself is what is picked: a value that came with it is not kept to be typed anywhere.
    if (out.enter != null) return `${JSON.stringify(reply)} kept ${out.enter}`;
    if (out.removed) return `${JSON.stringify(reply)} says it removed ${out.removed}`;
    return undefined;
  });
  // What does not mean the same is still removed: a radio is never cleared, an option is not typed into, and an option's own words still stop it.
  assert.equal(ask({ target: "e7", do: "uncheck" }).withheld, "unfit");
  assert.equal(ask({ target: "e19", do: "type", enter: "Per month" }).withheld, "unfit");
  assert.equal(ask({ target: "e19", do: "check" }).withheld, "unfit");
  assert.deepEqual([ask({ target: "e18", do: "choose", enter: "Sign out" }).withheld, ask({ target: "e18", do: "choose", enter: "Sign out" }).reply.removed], ["words", "choose"]);
});

test("the server never makes a link that sends, saves or approves Haptic's click: its act check refuses it as a button, and a press left to the visitor stays theirs", () => {
  // Found in review: the act check let a click on link "Send invite" through, and the server made the model's
  // "Click Send invite to send it." with "do" null into Haptic's own click.
  const team: Snapshot = {
    path: "/team",
    title: "Team",
    headings: ["Team"],
    text: [],
    truncated: false,
    elements: [
      element("e1", "link", "Send invite", { href: "/team" }),
      element("e2", "button", "Send invite"),
      element("e3", "link", "Delete workspace", { href: "/x" }),
      element("e4", "link", "Publish"),
      element("e5", "link", "Expense 7", { href: "/expenses/:id/approve" }),
      element("e6", "link", "Members", { href: "/team/members" }),
    ],
  };
  const request = { goal: "invite dana to the team", snapshot: team };
  for (const target of ["e1", "e2", "e3", "e4", "e5"]) {
    const checked = checkAction({ target, do: "click", enter: null, commits: false, status: "continue", say: "Clicking." }, request);
    assert.deepEqual([target, checked.reply.do, checked.withheld], [target, null, "words"]);
  }
  const left = (target: string, say: string) => pressLeftToVisitor(request, { target, do: null, enter: null, commits: false, status: "continue", say, mode: "act" });
  assert.equal(left("e1", "Click Send invite to send it."), undefined);
  assert.equal(left("e2", "Click Send invite to send it."), undefined);
  assert.equal(left("e4", "Click Publish to post it."), undefined);
  assert.equal(left("e5", "Click Expense 7 to approve it."), undefined);
  // A link that only leads somewhere is still pressed for the visitor.
  assert.equal(left("e6", "Click Members to go on.")?.say, "Clicking Members to go on.");
});

test("a reply with no do keeps the server's reason, and loses a value nothing uses", () => {
  const handedOver = ask({ target: "e3", status: "done", commits: true, say: "Ready. Click Issue card." });
  assert.equal(handedOver.withheld, undefined);
  assert.equal(handedOver.reply.commits, true);
  // The widget runs the same check on a reply the server already checked.
  const again = ask({ target: "e3", do: null, enter: null, withheld: "words" });
  assert.equal(again.reply.withheld, "words");
  assert.equal(ask({ target: "e2", do: "click", enter: "Ads" }).reply.enter, null);
  assert.equal(ask({ target: "e2", enter: "Ads" }).reply.enter, null);
  // A do that survives carries no reason.
  assert.equal(ask({ target: "e2", do: "click", withheld: "words" }).reply.withheld, undefined);
});

test("a commit word in a dialog's footer stops a click there only in a dialog", () => {
  const dialog: Snapshot = { ...PAGE, dialog: "Leave without saving?", elements: [element("e1", "button", "Continue"), element("e2", "button", "Cancel")] };
  assert.equal(ask({ target: "e1", do: "click" }, CARD_QUESTION, dialog).withheld, "words");
  assert.equal(ask({ target: "e2", do: "click" }, CARD_QUESTION, dialog).withheld, undefined);
  assert.equal(ask({ target: "e1", do: "click" }, CARD_QUESTION, { ...dialog, dialog: undefined }).withheld, undefined);
});

test("the shared limits: actions between 1 and 40, paths by prefix", () => {
  assert.equal(actionsAllowed(undefined), 25);
  assert.equal(actionsAllowed({ maxActions: 10 }), 10);
  assert.equal(actionsAllowed({ maxActions: 400 }), 40);
  assert.equal(actionsAllowed({ maxActions: 0 }), 1);
  assert.equal(actionsAllowed({ maxActions: Number.NaN }), 25);
  assert.equal(actingAllowedAt(undefined, "/anything"), true);
  assert.equal(actingAllowedAt({ paths: [] }, "/anything"), true);
  assert.equal(actingAllowedAt({ paths: ["/cards"] }, "/cards"), true);
  assert.equal(actingAllowedAt({ paths: ["/cards/"] }, "/cards/new"), true);
  assert.equal(actingAllowedAt({ paths: ["/cards"] }, "/cardsharing"), false);
  assert.equal(actingAllowedAt({ paths: ["/cards"] }, "/people"), false);
  assert.deepEqual([...ACTS], ["click", "type", "choose", "check", "uncheck", "press_enter"]);
});

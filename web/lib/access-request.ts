// The rules for a request access form entry. The form and the Worker both use
// this file, so the page and the server always agree on what a good entry is.

export interface AccessRequest {
  email: string;
  company: string;
  firstName: string;
  lastName: string;
  /** The one field a person may leave empty. */
  details: string;
}

export type AccessField = keyof AccessRequest;
export type AccessErrors = Partial<Record<AccessField, string>>;

/** The fields each step of the form asks for, in order. */
export const STEP_FIELDS: Record<1 | 2, AccessField[]> = {
  1: ["email", "company"],
  2: ["firstName", "lastName", "details"],
};

const MAX: Record<AccessField, number> = { email: 254, company: 200, firstName: 100, lastName: 100, details: 2000 };

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** A web address in a name is a sign of spam, not of a person. */
const LINK = /:\/\/|www\./i;

/** What is wrong with an email address, if anything. The sign-in page uses it too, so both forms say the same thing. */
export function emailProblem(email: string): string | null {
  if (!email) return "Enter your work email.";
  return EMAIL.test(email) ? null : "Enter a full email address, like name@company.com.";
}

/** Trims every field and cuts it to length. Anything that is not text counts as empty. */
export function cleanRequest(input: { [Name in AccessField]?: unknown }): AccessRequest {
  const text = (name: AccessField) => {
    const value = input[name];
    return typeof value === "string" ? value.trim().slice(0, MAX[name]) : "";
  };
  return { email: text("email").toLowerCase(), company: text("company"), firstName: text("firstName"), lastName: text("lastName"), details: text("details") };
}

/** Says what is wrong with each field, if anything. Pass `only` to check one step of the form. */
export function checkRequest(request: AccessRequest, only?: AccessField[]): AccessErrors {
  const errors: AccessErrors = {};
  const checks: Record<AccessField, () => string | null> = {
    email: () => emailProblem(request.email),
    company: () => (!request.company ? "Enter your company." : LETTER_OR_DIGIT.test(request.company) && request.company.length >= 2 ? null : "Enter your company's name."),
    firstName: () => (!request.firstName ? "Enter your first name." : LETTER.test(request.firstName) && !LINK.test(request.firstName) ? null : "Enter your first name, in letters."),
    lastName: () => (!request.lastName ? "Enter your last name." : LETTER.test(request.lastName) && !LINK.test(request.lastName) ? null : "Enter your last name, in letters."),
    details: () => null,
  };
  for (const name of only ?? (Object.keys(checks) as AccessField[])) {
    const message = checks[name]();
    if (message) errors[name] = message;
  }
  return errors;
}

/** The part of an email address after the @. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

const PERSONAL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "hey.com",
  "fastmail.com",
]);

/** True for a free mailbox such as Gmail. These are accepted, and marked in the copy the team gets. */
export function isPersonalEmail(email: string): boolean {
  return PERSONAL.has(emailDomain(email));
}

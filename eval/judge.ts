import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// A model that reads an answer and says whether it is right. Two things about
// an answer can't be scored by comparing fields: whether it says what a right
// answer says, and whether everything in it is in the help articles it cites.
//
// Model judges are accurate on average and differ a great deal from each
// other in how lenient they are, and rewording a judge's prompt can reverse a
// ranking. So there is one judge, with one prompt, asked yes-or-no questions,
// and it is checked against answers a person has labelled before its scores
// are believed (npm run eval:answers -- --check-judge). Change the model or a
// word of the prompt and that check has to be run again.

/** The one judge. Not the model being tested, and the same for every run that is to be compared. */
export const JUDGE_MODEL = "claude-opus-5-5";

const Verdict = z.object({
  correct: z.boolean().describe("The answer agrees with the reference on what the visitor asked, and contradicts none of it"),
  supported: z.boolean().describe("Every factual claim in the answer is stated in the help articles shown"),
});
export type Verdict = z.infer<typeof Verdict>;

const INSTRUCTIONS = `You check answers given by a support assistant inside a web app. You are given the visitor's question, a reference that says what a right answer contains, the help articles the assistant cited, and the assistant's answer.

Answer two questions, each yes or no.

"correct": Does the answer tell the visitor what the reference says they need to know, without saying anything that contradicts the reference? A shorter answer is still correct if it answers what was asked. An answer that leaves out the one thing the visitor asked for is not correct. An answer that is right but adds a detail the reference does not mention is still correct, unless that detail contradicts it.

"supported": Is every factual claim in the answer stated in the help articles shown, or does it follow directly from them? Judge this from the articles alone and ignore the reference. A claim that is true but not in the articles is not supported. If no articles are shown, nothing is supported.

Judge only what is written. Do not give credit for what the assistant probably meant.`;

export interface Judged {
  question: string;
  reference: string;
  /** The help articles the answer cited, in full. */
  articles: { title: string; text: string }[];
  answer: string;
}

let client: Anthropic | undefined;

/** Asks the judge about one answer. It costs a model call. */
export async function judge(item: Judged, model = JUDGE_MODEL): Promise<Verdict> {
  client ??= new Anthropic();
  const articles = item.articles.length ? item.articles.map((article) => `<article title="${article.title.replace(/"/g, "'")}">\n${article.text}\n</article>`).join("\n\n") : "(none)";
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Verdict) },
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: `<question>\n${item.question}\n</question>\n\n<reference>\n${item.reference}\n</reference>\n\n<help_articles>\n${articles}\n</help_articles>\n\n<answer>\n${item.answer}\n</answer>` }],
  });
  const response = await stream.finalMessage();
  if (!response.parsed_output) throw new Error(`The judge's verdict couldn't be read (stop reason: ${response.stop_reason}).`);
  return response.parsed_output;
}

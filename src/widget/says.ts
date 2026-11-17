// The widget's own sentences while acting. They live apart from the gate
// (gate.ts) because the guide shows some of them, and the guide is in the
// first file the script tag loads, while the gate and the engine that acts
// are in the second, loaded only on a site with acting on (acting-code.ts).

/** The widget's own sentences while acting. English in this version. `name` is the control as the visitor sees it. */
export const SAYS = {
  secret: "I don't type passwords, payment details or confirmations. Fill this in and I'll carry on.",
  leaves: (name: string) => `This opens somewhere else, so I'll leave it to you. Click ${name} and I'll carry on.`,
  unknown: (name: string) => `I can't tell what ${name} does, so I'll leave it to you. Click it and I'll carry on.`,
  commits: (name: string, does: string) => `I'll leave ${name} to you: it ${does}. Click it and I'll carry on.`,
  writes: (name: string) => `I'll leave ${name} to you: it sends something to the site. Click it and I'll carry on.`,
  styled: (name: string) => `I'll leave ${name} to you: the page marks it as dangerous. Click it and I'll carry on.`,
  live: (name: string) => `This may save as soon as it changes, so I'll leave it to you. Set ${name} and I'll carry on.`,
  ungrounded: "You'll need to fill this one in: I only enter what you told me.",
  covered: (name: string) => `Something is in the way, so I'll leave this one to you. Click ${name} and I'll carry on.`,
  off: (name: string) => `I'll leave this one to you. Use ${name} and I'll carry on.`,
  unfit: (name: string) => `I can't do this one myself. Use ${name} and I'll carry on.`,
  date: (name: string) => `I don't pick dates yet, so I'll leave this one to you. Pick ${name} and I'll carry on.`,
  confirmation: "The page is asking you to confirm. Read it and choose.",
  class: (name: string, does: string) => `I stopped before ${name}: it ${does}, and you didn't ask for that.`,
  cap: "That's as far as I'll go on my own. Here's what I did.",
  tripwire: "That may have been saved straight away. Check it before going on.",
  pressSent: (name: string) => `Pressing ${name} sent something to the site, so I've stopped. Check that nothing was saved before going on.`,
  failed: (name: string) => `I couldn't do this one. Click ${name} yourself and I'll carry on.`,
  handover: (name: string) => `Click ${name} when it looks right.`,
  actingOff: "I'll show you the way instead.",
  moved: "You moved to another page, so I stopped doing it. Ask again to carry on.",
  tookOver: "You took over, so I've paused.",
  answered: "You answered the page's question, so I've stopped.",
} as const;

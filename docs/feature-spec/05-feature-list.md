# Feature Spec

Haptic is an assistant that companies add to their websites with a small installation snippet. Users ask questions in plain language, get answers about the company or product, and receive step-by-step guidance through the website. Companies use it to reduce repetitive support and HR questions while helping people complete tasks on their own.

A company administrator registers a site, installs Haptic, and supplies approved information. A customer or employee opens the assistant where they are already working. Haptic answers their question or points to the next action, follows their progress across pages, and stops when the task is complete or it cannot reliably continue.

The first release targets websites the customer can modify. A company using a third-party HR platform would need that platform to support installation.

## Feature list

### Primary features

* 🔥 In-page questions and guided tasks. Users ask how to do something, and Haptic points to the next control with a short written instruction. It waits for the user's action and follows tasks across menus, dialogs, and pages. Users can ask follow-up questions or stop at any time. Useful to all four companies, especially Northstar and Harbor.
* 🔥 Simple installation and site management. Administrators create an account, register a website, configure allowed domains, and install a snippet. They can check installation, choose basic appearance settings, and manage each site's information. Useful to RelayCloud and Northstar.
* 🔥 Company-specific answers. Administrators supply approved notes and FAQs so Haptic can explain company terminology and procedures alongside website guidance. It admits when the available information does not answer the question. Useful to Cedar and Harbor.
* 🔥 Guidance that follows the current website. Haptic uses visible controls and learned navigation to find the next step. Administrators can inspect learned information and exclude unwanted labels. If a task stalls or a control is unavailable, Haptic stops instead of repeating the same instruction. Useful to RelayCloud and Northstar.
* 🔥 User control and accessible help. Guidance includes written instructions, keyboard access, readable contrast, and reduced-motion support. Users perform consequential actions themselves. Haptic does not read form values, and administrators can disable site learning. Useful to Harbor and Cedar.

### Secondary features

* 💼 A maintained company knowledge library. Administrators add approved documents or help-center pages, replace outdated material, and remove sources. Answers link to the source used. Useful to Cedar and Northstar.
* 💼 A route to human help. Users can reach the company's designated support or HR contact when guidance is insufficient. They review any question or conversation summary before sharing it. Useful to Cedar, Harbor, and Northstar.
* 💼 Support insights and feedback. Administrators see common questions, user feedback, and where guides stop so they can improve documentation and confusing workflows. Reports focus on product problems rather than ranking employees. Useful to Maya at Northstar and Priya at RelayCloud.

### Stretch features

* 🏹 Permission-aware assistance. Companies connect roles and access rules so users receive only the information they are authorized to see. Useful to Cedar and RelayCloud.
* 🏹 Voice and multilingual help. Users can speak questions and receive guidance in supported languages, with typing always available. Useful to Harbor.
* 🏹 Actions with explicit approval. For selected supported tasks, Haptic prepares an action, shows exactly what will change, and asks the user to approve it before execution. Useful to Harbor and RelayCloud.

## Scope and priorities

The existing prototype provides installation, typed guidance, company notes, learned navigation, appearance settings, and basic activity reporting. The course project will refine and validate those flows, including accessibility, then expand the assistant's company knowledge. Document ingestion, source-linked answers, human handoff, richer insights, and the stretch features are planned work. Voice code exists but is currently disabled because recognition was not reliable enough.

For the first release, success means a user can complete a supported task from their own question, the company can install and configure help without authoring each tour, and Haptic stops honestly when it cannot help. We will prioritize those outcomes before adding autonomous actions.

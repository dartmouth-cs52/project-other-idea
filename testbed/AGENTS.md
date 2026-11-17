# Working on the Northpine test app

Northpine is a made-up spend management product: corporate cards, expenses, reimbursements, approvals, bill pay, accounting, reports, budgets, people and settings. It exists to test Haptic. It should feel like a real B2B dashboard, and it deliberately includes every UI pattern that has made a pointing guide fail somewhere. It's also the live demo, so it has to look good.

It's a client-only React app. There's no backend. Data comes from a seeded generator, changes are kept in localStorage, and "network" delays come from the test panel.

## Commands

```bash
cd testbed
npm install
npm run dev        # http://localhost:4200
npx tsc --noEmit   # typecheck
npm run build
```

Haptic loads from `http://localhost:4000/widget.js` with site `site_testbed`. Run the Haptic server from the repo root (`npm run dev`) to try it. Add `?lab.widget=0` to load the app without it.

## Layout

- `src/data/types.ts`: every record type. `seed.ts` builds the company from a seed number. `store.ts` holds it, with `useCollection`, `useRow`, `useIndex`, `upsert`, `patch`, `remove`, `newId` and `simulate`.
- `src/lab/`: the test panel (bottom left, or Ctrl+Shift+L). Role, plan, latency, failure rate, nav variant, language, theme, native dialogs, live feed, chat bubble, banner. Every setting can be set from the URL: `?lab.role=employee&lab.nav=rail`.
- `src/lib/access.ts`: `useCan(action)` for roles and `useFeature(feature)` for plans.
- `src/ui/`: the component kit. Use it rather than writing new primitives.
  - `button.tsx`: `Button`, `IconButton` (pass `named={false}` for an icon button with no accessible name), `Tooltip`.
  - `form.tsx`: `Input`, `Textarea`, `NativeSelect`, `Select` (custom, portaled), `Field`, `Checkbox`, `Switch`, `RadioCards`, `RadioList`.
  - `inputs.tsx`: `Combobox`, `MultiSelect`, `DatePicker`, `DateRangePicker`, `FileDrop`, `InlineEdit`.
  - `overlay.tsx`: `Modal` (Radix, or native `<dialog>` when the test panel says so), `Sheet`, `ConfirmDialog` (with `confirmText` for type-to-confirm), `Menu` (with submenus), `ContextMenu`, `Popover`.
  - `display.tsx`: `PageHeader`, `Breadcrumbs`, `LinkTabs`, `Tabs`, `Card`, `Stat`, `Badge`, `StatusBadge`, `Avatar`, `Person`, `EmptyState`, `ErrorState`, `LoadingBlock`, `Progress`, `DescriptionList`, `Callout`, `Kbd`.
  - `data-table.tsx`: `DataTable` with sorting, column picker, selection with bulk actions, hover row actions, expandable rows and virtualization.
  - `flow.tsx`: `Stepper`, `SaveBar`, `UnsavedGuard`, `RoleGate`, `PlanGate`, `Loader`, `useSimulatedLoad`, `act` (runs a change with latency, then toasts, with optional Undo).
  - `rich-text.tsx`: `RichText`, a ProseMirror editor.
- `src/app/`: the shell, sidebar, top bar, command palette, shortcuts and router.
- `src/modules/<area>/`: one folder per area. Each exports `routes` from `routes.tsx`. Pages use paths relative to the shell (`"cards/:id"`, not `"/cards/:id"`).
- `src/tasks/`: benchmark tasks, one file per area, collected in `index.ts`.

`src/modules/home/HomePage.tsx` is the reference for how a page is put together.

## Rules

- Build it like a real product. Every page has a header, real-looking data, loading skeletons (wrap the body in `Loader`), empty states and error states. Actions go through `act()` so they take time and can fail.
- Respect roles and plans. A person without the role sees the button disabled with a reason (`RoleGate`), not a missing button. A plan-gated section shows `PlanGate`.
- Make each trap on purpose. When a pattern is there to test Haptic, say so in a one-line comment, like `// Icon-only with no accessible name, on purpose.`
- Keep labels distinct where a real app would, and duplicated where a real app would. "Export" on two pages is fine. Two "Save" buttons on one page should be in different sections.
- Never show a full card number, account number, tax ID or secret unless the person presses Reveal. Show them masked by default.
- Link between areas with real paths: a transaction links to its card, a card to its holder, a bill to its vendor.
- No em dashes in UI copy or comments. Use a period or a comma.

## Things a guide has to cope with

Use these names in a task's `covers` list.

| Name | What |
|---|---|
| `nav-sidebar`, `nav-collapsed-group`, `nav-rail`, `nav-renamed` | Sidebar links, a folded group, the icon-only rail, renamed labels |
| `nav-breadcrumb`, `nav-tabs`, `nav-command-palette`, `nav-entity-switcher`, `nav-account-menu` | Other ways to move around |
| `nav-deep-route`, `nav-full-reload`, `nav-redirect` | `/x/:id/y`, links that reload the page, old paths that redirect |
| `overlay-modal`, `overlay-native-dialog`, `overlay-nested-modal`, `overlay-drawer` | Dialogs and side panels |
| `overlay-dropdown`, `overlay-submenu`, `overlay-context-menu`, `overlay-popover` | Menus and popovers, all portaled |
| `overlay-tooltip-only`, `overlay-toast-undo`, `overlay-type-to-confirm` | A label only in a tooltip, an Undo toast, typing DELETE |
| `form-wizard`, `form-validation`, `form-conditional` | Multi-step forms, errors, fields that appear |
| `form-combobox`, `form-multiselect`, `form-native-select`, `form-custom-select`, `form-radio-cards`, `form-switch` | Kinds of choice |
| `form-date`, `form-date-range`, `form-upload`, `form-rich-text`, `form-inline-edit` | Other inputs |
| `form-autosave`, `form-save-bar`, `form-unsaved-guard` | How changes are saved |
| `data-virtual`, `data-sort`, `data-filter`, `data-columns`, `data-bulk`, `data-hover-actions`, `data-expand` | Table features |
| `data-pagination`, `data-infinite`, `data-kanban`, `data-tree`, `data-empty`, `data-loading`, `data-error` | Other data shapes and states |
| `viz-canvas`, `viz-svg` | Charts drawn on canvas or SVG |
| `layout-sticky`, `layout-fixed-bar`, `layout-nested-scroll`, `layout-horizontal-scroll`, `layout-covered` | Things that hide or cover controls |
| `layout-iframe`, `layout-shadow-dom`, `layout-chat-bubble`, `layout-banner`, `layout-mobile` | Content from elsewhere, and small screens |
| `ambiguity-duplicate-label`, `ambiguity-icon-only`, `ambiguity-div-button`, `ambiguity-disabled-reason`, `ambiguity-link-as-button` | Hard-to-name controls |
| `access-role`, `access-plan` | Gated by role or plan |
| `async-latency`, `async-optimistic`, `async-live`, `async-job-progress` | Timing |
| `privacy-email`, `privacy-card`, `privacy-phone`, `privacy-tax-id`, `privacy-secret-once`, `privacy-bank` | Data Haptic must mask or never read |
| `danger-delete`, `danger-irreversible` | Actions a guide should point at only when asked, and never press |
| `cant-do` | The right answer is "I can't do that here" |

## Tasks

Each area has `src/tasks/<area>.ts` exporting a `Task[]` (see `src/tasks/types.ts`). A task is a question a real user would type, the path to start on, and for each step the controls that are right and what a visitor would do next. The act is a Playwright selector. Prefer `role=button[name="Issue card"]` or `text=Next` over CSS classes.

Good tasks are the ones a confused user would actually ask: "how do I freeze my card", "where do I upload a receipt for the Uber charge", "change who approves meals over $150". Include tasks that start on the wrong page, tasks that need the role or plan changed (`lab`), and tasks whose right answer is that it can't be done here (`cant-do`, with a `note`).

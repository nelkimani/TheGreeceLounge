# UI/UX Phase 3 - office shell (17" office computer and accountant's laptop)

No database changes and no new npm packages. Terminals (`?t=T1`, `T2`, `T3`) are unchanged.

## What changed (office only: `?t=OFFICE`)
- **Left sidebar grouped by job:** Sales, Stock, Money, Reports, Admin, plus Home. Each person sees only the screens their permissions allow. One click switches screens; the current screen is highlighted. `[` collapses it to icons (remembered per computer).
- **Top bar:** the trading date (long form) and the status of the trading day:
  Open / Provisional close / Close awaiting approval / Close returned / Closed.
  The status comes from the day-close record, which only people with Reconciliation access can read; everyone else just sees the date. Between midnight and 05:00 it says the day is still last night's. Also shows Online / OFFLINE, NOT SENT count, clock, theme, who is signed in, Sign out.
- **Full width:** screens that used a narrow centred column now fill the space next to the sidebar. The payment keypad screen stays narrow on purpose.
- **Home** in the office is the tile screen, grouped like the sidebar. The in-screen "Home" buttons are hidden in the office (the sidebar does that job) and still shown on terminals.

## Keyboard
| Key | Does |
|---|---|
| Ctrl + K, or `/` | Go to any screen: type to search, Up/Down, Enter to open, Esc to close |
| `[` | Collapse / expand the sidebar |
| `?` | Shortcut list |
| Tab / Shift + Tab | Normal order: "Skip to content" link, sidebar, top bar, then the screen |
| Up / Down | Move along the sidebar |
| Enter | Confirms in "Are you sure?" dialogs (a held key does not repeat-confirm) |
| Esc | Cancels any dialog; on the payment screen the first Esc leaves the box you are typing in, the next goes back to the bill |

After switching screens the keyboard focus moves into the screen, not back to the top of the sidebar. Single-key shortcuts are ignored while you are typing in a box.

## Files
- New: `src/OfficeShell.tsx`, `src/nav.ts` (one list of screens + who may open them, shared by terminal tiles and the sidebar), `src/tradingDay.ts`, `src/keys.ts`
- Changed: `src/App.tsx`, `src/ui.tsx` (HomeBtn), `src/feedback.tsx` (Enter), `src/Pay.tsx` (Esc), `src/icons.tsx`, `src/index.css`, and a one-line Home-button swap in each screen.

## Not in this phase
- Per-screen keyboard shortcuts beyond Enter/Esc (for example row-by-row navigation in the reconciliation tables).
- Accountant data tables and charts (Phases 4-5 of the UI plan).
- Verified with `tsc --noEmit` and a Tailwind compile. The full `vite build` could not be run in the build environment (the committed `node_modules` holds macOS binaries), so run `npm run dev` once on your machine and click through as manager and as accountant.

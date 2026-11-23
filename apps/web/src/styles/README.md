# Learner styles

Every learner-screen rule lives here. `main.tsx` imports `index.css` only, and
the build makes one stylesheet from it (no CSS file per lazy route, and no
inline `<style>`: the CSP is `style-src 'self'`).

## Order

`index.css` imports the files in cascade order. A later file wins over an
earlier one at the same specificity, so a file's place in the list matters.

1. `@nihongo/browser/styles.css`: Tailwind and the components shared with the
   admin app.
2. `1-foundation/`: variables and language rules every screen uses.
3. `2-layout/`: the frame around every screen.
4. `3-components/`: parts that appear on more than one screen.
5. `4-screens/`: one file (or folder) per screen.
6. `5-motion/`: `@keyframes`, then `reduced-motion.css` last.

## Map

- Colors and sizes: start from `1-foundation/tokens.css`.
- `animation:` lines stay in each part's file; only the `@keyframes` go in
  `5-motion/`.

| Folder       | File                                 | What                                            |
| ------------ | ------------------------------------ | ----------------------------------------------- |
| 1-foundation | tokens.css                           | Learner color and size variables (`:root`)      |
|              | typography.css                       | Japanese font and line breaking by language     |
| 2-layout     | app-shell.css                        | Top bar, logo, page frame                       |
| 3-components | button.css                           | Shared button shape                             |
|              | stamp-board.css                      | My page stamp board                             |
|              | menu.css                             | Language and account menus                      |
|              | maru.css                             | Maru pictures and Maru's stamp                  |
|              | manuscript.css                       | Manuscript paper: progress squares, grade marks |
| 4-screens    | home/home.css, home/daily.css        | Home; today's question                          |
|              | practice-setup.css                   | Practice setup                                  |
|              | session.css                          | Solve screen                                    |
|              | passage-audio.css                    | Passage read-aloud bar and reading word (#1183) |
|              | result.css                           | Result screen                                   |
|              | rush/entry.css, play.css, result.css | Kanji rush                                      |
|              | my-goal.css                          | Study goal                                      |
|              | omikuji/button-sheet.css, slip.css   | Omikuji                                         |
|              | account.css                          | My page, nickname                               |
|              | auth.css                             | Sign-up check, guest gate, login                |
|              | operations.css                       | Terms and operations documents                  |
|              | wrong-note/center.css, list.css      | Wrong notes: center, question list              |
|              | wrong-note/detail.css                | Wrong notes: one question                       |
|              | my/settings.css                      | My page: settings, menu, two-step dialog        |
|              | my/study.css                         | My page: my study                               |
|              | bookmark/bookmark.css                | Bookmarks                                       |
|              | bookmark/report.css                  | Question report dialog                          |
| 5-motion     | keyframes-\*.css                     | `@keyframes` only, by the part that uses them   |
|              | reduced-motion.css                   | Every `prefers-reduced-motion` override         |

`1-foundation/base.css`, `2-layout/grid.css` and more `3-components/` files
come later, as the Tailwind utilities in the screens move into CSS.

## Rules

- The first line of every file says what it holds in one line.
- Class names are `screen-part`; a state is `.is-…` (`omikuji-button`,
  `rush-box.is-ng`).
- Keep design notes (issue numbers, design references) next to their rules.
- Split a file once it passes about 300 lines.
- An `animation:` line stays in its part's rule. `5-motion/` holds only
  `@keyframes` and the reduced-motion overrides; moving `animation:` there
  would put it after the screen rules and change which rule wins.
- `5-motion/reduced-motion.css` also holds `animation: none` lines.
- Utilities moved out of the markup go inside `@layer utilities { }` in the
  file they move to, so they stay as weak as the utilities they replace.
- A moved utility keeps the value the build gives it. `text-brand`,
  `border-brand` and `outline-brand` are redefined in
  `@nihongo/browser/styles.css`, so copy that value, not Tailwind's.
- To hide overflow use `overflow: clip`, not `hidden` (hidden makes a scroll
  box, and focus can scroll it).
- No layout sizes worked out from other pixel sizes; use flex, grid and
  `clamp()`.

## Adding a rule

Put it in the file for its screen or part, after the rules it should beat.
A new file goes into `index.css` within its folder's group. A new reduced
motion override goes into `5-motion/reduced-motion.css`.

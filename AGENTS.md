# Working on BlueNoise

Conventions for anyone — human or agent — changing this codebase. They exist
because the expensive mistakes here are not syntax errors; they are quiet
product regressions: a filter that starts flagging innocent posts, a permission
that shows up in a store review, a selector that breaks on a Tuesday.

## Quality gate

`pnpm verify` is the only gate that matters: lint + format, typecheck (app **and**
tests), unit tests, then a production build. It runs automatically on `pre-push`
(`pnpm install` points `core.hooksPath` at `.githooks/`) and in CI. Do not push
past a red gate with `--no-verify` unless you are shipping a hotfix and say so.

Tests are part of `tsconfig.json`, so test code is typechecked. Keep it that way.

## Where things live

| Area | Path | Rule |
| --- | --- | --- |
| Content script entry | `entrypoints/content.ts` | Wiring only. New behaviour goes into a module under `src/content/` and is instantiated here. |
| X's DOM contract | `src/content/selectors.ts` | The **only** place allowed to name a `data-testid` for a tweet. |
| Filtering decisions | `src/content/evaluation.ts` | Pure-ish: takes options, returns a verdict. No timers, no observers. |
| How a filtered row looks | `src/content/marking.ts` | Owns its DOM (`bluenoise-*` classes, attributes, placeholder). |
| Matching primitives | `src/domain/` | No DOM, no storage. Anything in here should be trivially testable. |
| Settings shape | `src/contracts/config.ts` | Adding a setting means touching contracts + defaults + UI + tests. |

## Invariants that must not regress

These are product promises, not preferences:

1. **Only the opened post is exempt; replies are fair game.** `isMainTweetArticle`
   decides this. Never filter the post a user deliberately opened.
2. **A whitelist always wins.** Account or keyword. The Jev second pass must not
   see a whitelisted author either.
3. **Nothing is hidden without a mark first.** Content is dimmed, collapsed, or
   made inert — never deleted from the DOM, and `⌘Z`-style recovery must keep
   working by turning the feature off.
4. **No account actions, no background requests to X.** The extension reads what
   the page already loaded. The only extra network traffic is the opt-in
   community lists and the user's own model endpoint.
5. **The scan stays inside its frame budget.** Work is sliced by
   `drainWithinBudget`; a slow rule may not block the page, and one item always
   makes progress.
6. **A verdict is never paid for twice.** `ai-second-pass.ts` remembers text
   fingerprints for the session and the worker caches durably. Preserving the
   cached signature when a verdict lands is what prevents a re-ask loop.
7. **Teardown is total.** When the context is invalidated, every observer, timer,
   and listener goes. A half-dead instance that keeps touching `chrome.*` throws
   on the user's page.

## Changing the keyword list

`data/keywords.txt` is the shipped list. Any change must:

1. Add or move cases in `tests/corpus/cases.json` that justify it — a phrase that
   is removed needs a `clean` case showing why, a phrase that is added needs a
   `spam` case.
2. Run `pnpm corpus:report` and commit `tests/corpus/metrics.json`. The diff is
   the argument: precision and recall must not move for unexplained reasons.
3. Keep `fp` at zero for scored cases. If a new false positive is unavoidable,
   record it as `known_limitation` with a note naming the fix path — never by
   lowering the floor.

Quoting and metadiscussion (people reporting spam by quoting it) is the known
weak spot. It is recorded, not hidden.

## Tests

Behaviour over text. A test that reads a source file and asserts on its
characters breaks on reformatting and proves nothing; a test that renders the
component against a fake `chrome` and clicks the switch proves the behaviour.

- DOM logic: `// @vitest-environment happy-dom` at the top of the file.
- Extension APIs: `tests/helpers/chrome-mock.ts`. Extend the mock rather than
  stubbing globals ad hoc — an unimplemented call should fail loudly.
- Assert on what the user can observe (text, roles, attributes, storage writes),
  not on internal names.

## Privacy and permissions

`docs/privacy-policy.md` is a contract with store reviewers and users. Any new
`host_permissions`, upload field, or third-party origin must be added there in the
same commit. Prefer `optional_host_permissions` requested at runtime for anything
that is off by default.

Debug logs are copied into issue reports: log counts, rule names, and shapes —
never post text, never credentials. `scan-report.ts` exists to keep that boundary
testable.

## Commits

One logical change per commit, in English, imperative mood:

```
refactor(content): extract the evaluator from the content script
fix(marking): keep collapse placeholder above the post
feat(settings): request the model origin at runtime
```

The body should say what a user can observe. `pnpm push`, releases, and store
uploads happen only when explicitly asked for.

## Internal notes

Deployment topology, hosting costs, and user research live outside the repo.

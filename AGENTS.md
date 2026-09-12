# AGENTS.md

Guidance for agents working in this repository.

## What this is

An OpenCode V2 plugin (`goal.ts`) that sets a per-session stopping condition and
judges it at the end of each turn. No build step, no dependencies, MIT.

## Local development

```sh
bun test
cp goal.ts ~/.config/opencode/plugins/goal.ts
touch ~/.config/opencode/plugins/goal.ts
```

Check the server log when something is off:

```sh
grep goal ~/.local/share/opencode/log/opencode.log | tail
```

## Hard constraints

- Do not import `@opencode/plugin`. Export a plain `{ id, setup }` object.
- Keep the plugin dependency-free.
- Plugin `console` output is not visible to users. Prefer state the model can
  read, and throw only from commands when a message must reach the user.
- Never post a synthetic message for a notice; it starts a model turn.

## API notes

- Subscribe with `ctx.event.subscribe({ signal })` and return an abort cleanup
  from `setup`.
- The reliable turn-end event is `session.execution.succeeded`, whose data
  carries `sessionID`. `session.execution.failed` and `.interrupted` end a turn
  too. `session.idle` is in the manifest but did not fire in testing.
- `ctx.generate.text({ model, prompt })` makes the judge call without touching
  the conversation.
- State lives in `ctx.storage` under `goal/<sessionID>`.

## Layout

- `parseVerdict` and `decide` - pure helpers, exported for tests.
- `judgePrompt` - builds the judge instruction.
- `evaluateGoal` and `handleEvent` - the turn-end path, exported for tests.
- `setup` - registers the command and subscribes to events.
- `goal.test.ts` - tests for the helpers and the turn-end path.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.

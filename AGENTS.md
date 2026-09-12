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
  the conversation. It failed on OpenCode Go with `Request is missing
  x-opencode-session` in testing, so `GOAL_MODEL` overrides the judge model; it
  defaults to the session model.
- A judge verdict that is not a clear `MET: yes` or `MET: no` stops the goal
  with status `givenup`. Never continue on an unknown verdict.
- State lives in `ctx.storage` under `goal/<sessionID>`.

## Layout

- `parseVerdict` and `decide` - pure helpers, exported for tests.
- `judgePrompt` - builds the judge instruction.
- `evaluateGoal` and `handleEvent` - the turn-end path, exported for tests.
- `setup` - registers the command and subscribes to events.
- `goal.test.ts` - tests for the helpers and the turn-end path.

## Command output

A plugin command has no output channel. `/goal` and `/goal status` surface the
status by throwing, which the client shows as a command error. Do not post the
status with `ctx.session.prompt`: that starts a turn, and the watcher would then
judge it, which can advance or end the goal.

## Event location

`session.execution.succeeded` carries an optional `location`. The watcher skips
events whose location differs from the plugin instance. A location-less event is
processed by every instance, which is a duplicate-nudge risk; real events were
observed to carry a location, and the in-flight guard covers one instance.

## Releasing

- Semantic commit messages. Changes through a feature branch and a PR.
- Keep `NOTICE` accurate.

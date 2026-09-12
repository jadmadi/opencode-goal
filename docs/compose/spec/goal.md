---
feature: goal
status: in-progress
updated: 2026-09-12
branch: feat/goal
commits:
---

# Goal and Stop Condition

## Report

## [S1] Problem

An agent stops when it believes it is done. There is no independent check, so
autonomous runs stop early or stop wrong. MiMoCode's `/goal` sets a stopping
condition, and a separate judge model decides whether the condition is met
before the agent is allowed to finish.

## [S2] Design

A command sets a condition, and a judge decides when it is met.

- `/goal <condition>` stores the condition per session in `ctx.storage` under
  `goal/<sessionID>`. `/goal` with no argument prints it. `/goal clear` removes
  it.
- A watcher follows the session event stream. When a turn ends, the plugin
  reads the recent conversation with `ctx.session.context` and asks a judge
  model, through `ctx.generate.text`, whether the condition is met. The judge
  answers met or not met, with one sentence of reason.
- When the condition is not met and the continuation count is under a cap, the
  plugin resumes work with `ctx.session.prompt` and a short nudge that names the
  unmet condition and the judge's reason.
- A cap stops the loop and reports the impasse, so a bad condition cannot run
  forever.
- `/goal status` prints the condition, the continuation count, and the last
  judge reason.

Risk: the exact stop signal needs a spike. The first task proves which event, or
hook, marks the end of a turn.

## [S3] Out of Scope

- Multiple goals per session.
- A goal that spans sessions.
- Automatic goal creation.
- A TUI panel.

## Tasks

- [x] T0: spike the turn-end signal - acceptance: a note in the spec records the
      event or hook that fires when a turn ends, or states that none exists and
      gives the fallback (covers: S2)

      Result: subscribe to `ctx.event.subscribe`. `session.execution.succeeded`
      carries `sessionID` and fires when a turn completes; `session.execution.failed`
      and `session.execution.interrupted` cover the other endings. `session.idle`
      exists in the event manifest but did not fire in a one-shot run, so the
      signal is `session.execution.succeeded`, not `session.idle`. There is no
      turn-end session hook.
- [ ] T1: the /goal command family with per-session storage - acceptance:
      set, print, and clear each round-trip in a fake-context test (covers: S2)
- [ ] T2: the judge call and its output parsing - acceptance: a test supplies a
      stub result and parses met or not met, with a reason (covers: S2;
      depends: T1)
- [ ] T3: the continuation loop with a cap and an impasse report - acceptance: a
      test drives not-met three times and confirms the loop stops at the cap
      (covers: S2; depends: T2)
- [ ] T4: README and tests for the whole path - acceptance: README documents
      /goal and the tests pass (covers: S2; depends: T3)

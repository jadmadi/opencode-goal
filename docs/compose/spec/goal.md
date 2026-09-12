---
feature: goal
status: delivered
updated: 2026-09-12
branch: feat/goal
commits: 01b3b8e..e3a9248
---

# Goal and Stop Condition

## Report

**What was built** - A single-file OpenCode V2 plugin that sets a per-session
stopping condition. On `session.execution.succeeded`, a judge model called
through `ctx.generate.text` decides whether the condition is met. On an explicit
`MET: no` the plugin posts a short nudge and continues, up to `GOAL_MAX`
(default 5). Any other verdict stops the goal with status `givenup`.
`GOAL_MODEL` overrides the judge model. The `/goal` command sets, shows, or
clears the condition, and the watcher is scoped by event location and serialized
per session.

**Verification** - `bun test`: 20 pass, 0 fail, 38 assertions. Live on the
DeepSeek platform: a goal was set, one turn ran, and the status became `met`
with the verdict "The assistant's response was the single word BANANA." Live on
OpenCode Go: `ctx.generate.text` failed with `Request is missing
x-opencode-session`, so the goal stopped at `givenup` with 1/5 continuations and
no nudge, and the message count held at 3 across 70s and 90s. An earlier live
run looped; three causes were fixed. Two review rounds covered five findings,
all fixed and re-reviewed as resolved. `/goal status` returns as a command error
with no session message.

**Journey log**

1. The first live test looped with dozens of nudges: the in-flight guard was set
   after an await, every plugin instance processed every event, and an
   unparseable judge verdict continued. All three are fixed.
2. `ctx.generate.text` fails on OpenCode Go's gateway with MissingSessionID, so
   the judge cannot run there. `GOAL_MODEL` points the judge at a working
   provider.
3. Showing status with a session message made the watcher judge its own status
   turn. Status now throws, which the client shows without starting a turn.

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
- [x] T1: the /goal command family with per-session storage - acceptance:
      set, print, and clear each round-trip in a fake-context test (covers: S2)
- [x] T2: the judge call and its output parsing - acceptance: a test supplies a
      stub result and parses met or not met, with a reason (covers: S2;
      depends: T1)
- [x] T3: the continuation loop with a cap and an impasse report - acceptance: a
      test drives not-met three times and confirms the loop stops at the cap
      (covers: S2; depends: T2)
- [x] T4: README and tests for the whole path - acceptance: README documents
      /goal and the tests pass (covers: S2; depends: T3)

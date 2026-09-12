# opencode-goal

An OpenCode V2 plugin that adds a judged stop condition for a session.

Set a goal, and when the agent finishes a turn an independent judge model
decides whether the goal is met. If it is not, the plugin resumes work with a
short nudge. A cap stops the loop and reports the impasse, so a bad condition
cannot run forever.

## Install

```sh
mkdir -p ~/.config/opencode/plugins
curl -fsSL \
  https://raw.githubusercontent.com/jadmadi/opencode-goal/main/goal.ts \
  -o ~/.config/opencode/plugins/goal.ts
```

For one project, put it in `.opencode/plugins/`. Tested against OpenCode
`0.0.0-beta-19425`.

## Use

| Command            | Effect                                             |
| ------------------ | -------------------------------------------------- |
| `/goal <condition>`| Set the stopping condition for this session        |
| `/goal` or `/goal status` | Show the condition, the continue count, and the last verdict |
| `/goal clear`      | Remove the goal                                    |

Status has no normal output channel in a plugin command, and a session message
would start a turn that the watcher then judges, so status is surfaced as a
command error message. It never changes the goal.

When a turn ends, the plugin asks the session's model to answer `MET: yes` or
`MET: no` with a short reason. On `no` it continues, up to the cap. The cap
defaults to 5 and is set with `GOAL_MAX` (a number).

If the judge answer is missing or unparseable, the goal stops with status
`givenup`. A bad judge can never loop.

## Judge model

The judge uses the session's model by default. Some providers do not support
transient generation: OpenCode Go returned `Request is missing x-opencode-session`
for the judge call in testing. Set `GOAL_MODEL` to a working judge, for example:

```sh
GOAL_MODEL=deepseek/deepseek-flash
```

The value is a `provider/model` ref, the same form `opencode2 models` prints.

## Notes

- The turn-end signal is `session.execution.succeeded` from the plugin event
  stream. `session.idle` exists in the event manifest but did not fire in
  testing, so it is not used.
- The judge runs through `ctx.generate.text`, a transient call that does not
  join the conversation.
- State is per session, in `ctx.storage` under `goal/<sessionID>`.

## Tests

```sh
bun test
```

## Attribution

Inspired by MiMoCode's goal and stop condition. See `NOTICE`.

## License

MIT

# Contributing

Thanks for helping improve opencode-goal.

## Setup

```sh
git clone https://github.com/jadmadi/opencode-goal
cd opencode-goal
bun test
```

Bun is a deliberate exception to the global no-bun rule here: the plugin runs
inside OpenCode, which embeds Bun.

## Rules

- Import `{ Plugin } from "@opencode/plugin"` and export
  `Plugin.define({ id, setup })`. The host provides the module at runtime; do
  not add it as a package dependency. Tests stub it in `test-preload.ts`.
- Keep the turn-end signal on `session.execution.succeeded` unless a new signal
  is verified live.
- Add a test for any behavior you change.

## Reporting a bug

Open an issue with your OpenCode version from `opencode2 --version`, the goal
you set, and the observed continuation behavior.

## Sending a change

1. Branch: `git checkout -b fix/short-description`.
2. Make the change and add tests.
3. Run `bun test`.
4. Use a semantic commit message.
5. Open a pull request against `main`.

## License

By contributing, you agree that your work is released under the AGPL-3.0-only License.

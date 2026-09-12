import { describe, expect, test } from "bun:test"
import plugin, { decide, handleEvent, judgePrompt, parseVerdict } from "./goal.ts"

function makeCtx(options: { verdict?: string; model?: any; location?: string } = {}) {
  const store = new Map<string, unknown>()
  const prompts: any[] = []
  const generateCalls: any[] = []
  const commands: any[] = []
  const ctx: any = {
    location: { directory: options.location ?? "/work", project: { id: "p" } },
    storage: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      remove: async (key: string) => void store.delete(key),
    },
    session: {
      context: async () => [{ role: "user" }],
      get: async () => ({ model: options.model ?? { providerID: "test", id: "m" } }),
      prompt: async (input: any) => void prompts.push(input),
    },
    generate: {
      text: async (input: any) => {
        generateCalls.push(input)
        return { text: options.verdict ?? "MET: no\nREASON: not yet" }
      },
    },
    command: { transform: (callback: any) => callback({ add: (definition: any) => commands.push(definition) }) },
    event: { subscribe: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  }
  return { ctx, store, prompts, generateCalls, commands }
}

const goal = (overrides: Record<string, unknown> = {}) => ({
  condition: "finish the task",
  status: "active" as const,
  continuations: 0,
  max: 3,
  ...overrides,
})

describe("parseVerdict", () => {
  test("reads yes and its reason", () => {
    expect(parseVerdict("MET: yes\nREASON: all done")).toEqual({ verdict: "yes", reason: "all done" })
  })

  test("reads no and its reason", () => {
    expect(parseVerdict("MET: no\nREASON: missing tests")).toEqual({ verdict: "no", reason: "missing tests" })
  })

  test("treats anything else as unknown", () => {
    expect(parseVerdict("it is probably fine").verdict).toBe("unknown")
    expect(parseVerdict(undefined).verdict).toBe("unknown")
    expect(parseVerdict("MET: yes and MET: no").verdict).toBe("unknown")
  })
})

describe("decide", () => {
  test("stops when yes", () => {
    const outcome = decide(goal(), { verdict: "yes", reason: "done" })
    expect(outcome.action).toBe("stop")
    expect(outcome.goal.status).toBe("met")
  })

  test("continues on no under the cap", () => {
    const outcome = decide(goal(), { verdict: "no", reason: "no" })
    expect(outcome.action).toBe("continue")
    expect(outcome.goal.continuations).toBe(1)
  })

  test("gives up on no at the cap", () => {
    const outcome = decide(goal({ continuations: 2, max: 3 }), { verdict: "no", reason: "no" })
    expect(outcome.action).toBe("giveup")
    expect(outcome.goal.status).toBe("givenup")
  })

  test("gives up on an unknown verdict", () => {
    const outcome = decide(goal(), { verdict: "unknown", reason: "bad format" })
    expect(outcome.action).toBe("giveup")
    expect(outcome.goal.status).toBe("givenup")
  })
})

describe("judgePrompt", () => {
  test("names the condition and the format", () => {
    const prompt = judgePrompt("ship it", [])
    expect(prompt).toContain("ship it")
    expect(prompt).toContain("MET:")
  })
})

describe("handleEvent", () => {
  test("continues when the judge says no", async () => {
    const { ctx, store, prompts } = makeCtx({ verdict: "MET: no\nREASON: keep going" })
    store.set("goal/ses_1", goal())
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
    expect(prompts).toHaveLength(1)
    expect(prompts[0].text).toContain("not met yet")
    expect((store.get("goal/ses_1") as any).continuations).toBe(1)
  })

  test("stops when the judge says yes", async () => {
    const { ctx, store, prompts } = makeCtx({ verdict: "MET: yes\nREASON: done" })
    store.set("goal/ses_1", goal())
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
    expect((store.get("goal/ses_1") as any).status).toBe("met")
    expect(prompts).toEqual([])
  })

  test("stops on an unparseable judge answer instead of looping", async () => {
    const { ctx, store, prompts } = makeCtx({ verdict: "judge" })
    store.set("goal/ses_1", goal())
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
    expect((store.get("goal/ses_1") as any).status).toBe("givenup")
    expect(prompts).toEqual([])
  })

  test("ignores events from another location", async () => {
    const { ctx, generateCalls } = makeCtx({ location: "/work" })
    ;(ctx.storage as any).set("goal/ses_1", goal())
    await handleEvent(ctx, {
      type: "session.execution.succeeded",
      location: { directory: "/elsewhere" },
      data: { sessionID: "ses_1" },
    })
    expect(generateCalls).toEqual([])
  })

  test("evaluates one turn once even when events race", async () => {
    const { ctx, store, generateCalls } = makeCtx({ verdict: "MET: yes\nREASON: done" })
    store.set("goal/ses_1", goal())
    const event = { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
    await Promise.all([handleEvent(ctx, event), handleEvent(ctx, event), handleEvent(ctx, event)])
    expect(generateCalls).toHaveLength(1)
  })

  test("stops after the cap when the judge keeps saying no", async () => {
    const { ctx, store, prompts } = makeCtx({ verdict: "MET: no\nREASON: not yet" })
    store.set("goal/ses_1", goal({ max: 3 }))
    const event = { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
    await handleEvent(ctx, event)
    await handleEvent(ctx, event)
    await handleEvent(ctx, event)
    expect((store.get("goal/ses_1") as any).status).toBe("givenup")
    expect(prompts).toHaveLength(2)
  })

  test("processes a location-less event once", async () => {
    const { ctx, store, generateCalls } = makeCtx({ verdict: "MET: yes\nREASON: done" })
    store.set("goal/ses_1", goal())
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
    expect(generateCalls).toHaveLength(1)
  })

  test("does nothing without a goal", async () => {
    const { ctx, generateCalls } = makeCtx()
    await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_9" } })
    expect(generateCalls).toEqual([])
  })

  test("GOAL_MODEL overrides the judge model", async () => {
    process.env.GOAL_MODEL = "deepseek/deepseek-flash"
    try {
      const { ctx, store, generateCalls } = makeCtx({ verdict: "MET: yes\nREASON: done" })
      store.set("goal/ses_1", goal())
      await handleEvent(ctx, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
      expect(generateCalls[0].model).toEqual({ providerID: "deepseek", id: "deepseek-flash" })
    } finally {
      delete process.env.GOAL_MODEL
    }
  })

  test("ignores other event types", async () => {
    const { ctx, generateCalls } = makeCtx()
    await handleEvent(ctx, { type: "session.step.ended", data: { sessionID: "ses_1" } })
    expect(generateCalls).toEqual([])
  })
})

describe("setup", () => {
  test("registers the goal command and returns a cleanup", async () => {
    const { ctx, commands } = makeCtx()
    const cleanup = await (plugin as any).setup(ctx)
    expect(commands.map((entry) => entry.name)).toEqual(["goal"])
    expect(typeof cleanup).toBe("function")
  })

  test("sets, shows, and clears the goal", async () => {
    const { ctx, store, commands } = makeCtx()
    await (plugin as any).setup(ctx)
    const run = (text: string) => commands[0].execute({ sessionID: "ses_1", prompt: { text } })

    await run("pass the tests")
    expect((store.get("goal/ses_1") as any).condition).toBe("pass the tests")

    await expect(run("status")).rejects.toThrow(/pass the tests/)
    expect((store.get("goal/ses_1") as any).condition).toBe("pass the tests")

    await expect(run("")).rejects.toThrow(/pass the tests/)
    expect((store.get("goal/ses_1") as any).condition).toBe("pass the tests")

    await run("clear")
    expect(store.get("goal/ses_1")).toBeUndefined()
  })
})

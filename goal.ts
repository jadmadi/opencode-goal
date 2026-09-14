// OpenCode V2 goal plugin.
//
// Sets a per-session stopping condition. When a turn ends, an independent judge
// model decides whether the condition is met. If the judge says no, the plugin
// resumes work with a short nudge, up to a cap. Any other judge outcome stops
// the loop, so a bad condition cannot run away.
//
// Turn-end signal: `session.execution.succeeded` from ctx.event.subscribe.
// `session.idle` exists in the event manifest but did not fire in testing.
//
// The runtime does not resolve @opencode/plugin, so this file exports a plain
// { id, setup } object.

const VERSION = "0.1.2"

type Verdict = "yes" | "no" | "unknown"

interface GoalVerdict {
  verdict: Verdict
  reason: string
}

interface Goal {
  condition: string
  status: "active" | "met" | "givenup"
  continuations: number
  max: number
  lastReason?: string
}

// One evaluation per session at a time within this plugin instance.
const inflight = new Set<string>()

function maxContinuations(): number {
  const value = Number(process.env.GOAL_MAX)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5
}

function goalKey(sessionID: string): string {
  return `goal/${sessionID}`
}

async function loadGoal(ctx: any, sessionID: string): Promise<Goal | undefined> {
  const stored = await ctx.storage.get(goalKey(sessionID))
  return stored && typeof stored === "object" ? (stored as Goal) : undefined
}

async function saveGoal(ctx: any, sessionID: string, goal: Goal): Promise<void> {
  await ctx.storage.set(goalKey(sessionID), goal)
}

function judgePrompt(condition: string, messages: unknown): string {
  return [
    "You are a strict judge of a stopping condition.",
    "Reply with exactly two lines and nothing else:",
    "MET: yes",
    "REASON: <one short sentence>",
    "Use MET: no when the condition is not clearly met.",
    "",
    `Condition: ${condition}`,
    "",
    "Conversation:",
    JSON.stringify(messages ?? null).slice(-12000),
  ].join("\n")
}

function parseVerdict(text: unknown): GoalVerdict {
  const raw = typeof text === "string" ? text : ""
  const yes = /MET\s*:\s*yes\b/i.test(raw)
  const no = /MET\s*:\s*no\b/i.test(raw)
  const reasonLine = raw.split("\n").find((line) => /REASON\s*:/i.test(line))
  const reason = reasonLine ? reasonLine.replace(/^\s*REASON\s*:\s*/i, "").trim() : raw.trim().slice(0, 200)
  const verdict: Verdict = yes && !no ? "yes" : no && !yes ? "no" : "unknown"
  return { verdict, reason: reason || "no reason given" }
}

function decide(goal: Goal, verdict: GoalVerdict): { goal: Goal; action: "stop" | "giveup" | "continue" } {
  if (verdict.verdict === "yes") {
    return { goal: { ...goal, status: "met", lastReason: verdict.reason }, action: "stop" }
  }
  const continuations = goal.continuations + 1
  if (verdict.verdict === "unknown") {
    return { goal: { ...goal, status: "givenup", continuations, lastReason: verdict.reason }, action: "giveup" }
  }
  if (continuations >= goal.max) {
    return { goal: { ...goal, status: "givenup", continuations, lastReason: verdict.reason }, action: "giveup" }
  }
  return { goal: { ...goal, continuations, lastReason: verdict.reason }, action: "continue" }
}

function nudge(condition: string, reason: string): string {
  return [
    `The stopping condition is not met yet: ${condition}`,
    `Judge: ${reason}`,
    "Continue working toward it. Do not stop until it is met.",
  ].join("\n")
}

async function judge(ctx: any, model: any, condition: string, messages: unknown): Promise<GoalVerdict> {
  if (!model?.providerID || !model?.id) return { verdict: "unknown", reason: "no model available for the judge" }
  try {
    const result = await ctx.generate.text({
      model: { providerID: model.providerID, id: model.id },
      prompt: judgePrompt(condition, messages),
    })
    return parseVerdict(result?.text)
  } catch (error) {
    return { verdict: "unknown", reason: `judge call failed: ${error}` }
  }
}

// The judge defaults to the session model. GOAL_MODEL overrides it with a
// "provider/model" ref, for providers whose transient generation is limited.
function judgeModel(sessionModel: any): any {
  const override = process.env.GOAL_MODEL
  if (override) {
    const slash = override.indexOf("/")
    if (slash > 0 && slash < override.length - 1) {
      return { providerID: override.slice(0, slash), id: override.slice(slash + 1) }
    }
  }
  return sessionModel
}

async function evaluateGoal(ctx: any, sessionID: string): Promise<void> {
  if (inflight.has(sessionID)) return
  inflight.add(sessionID)
  try {
    const goal = await loadGoal(ctx, sessionID)
    if (!goal || goal.status !== "active") return
    const messages = await ctx.session.context({ sessionID }).catch(() => [])
    const info: any = await ctx.session.get({ sessionID }).catch(() => undefined)
    const model = judgeModel(info?.model ?? info?.data?.model)
    const verdict = await judge(ctx, model, goal.condition, messages)
    const outcome = decide(goal, verdict)
    await saveGoal(ctx, sessionID, outcome.goal)
    if (outcome.action === "continue") {
      await ctx.session.prompt({ sessionID, text: nudge(goal.condition, verdict.reason) })
    }
  } finally {
    inflight.delete(sessionID)
  }
}

async function handleEvent(ctx: any, event: any): Promise<void> {
  if (event?.type !== "session.execution.succeeded") return
  const sessionID = event?.data?.sessionID
  if (typeof sessionID !== "string") return
  // Each plugin instance is bound to one location. Ignore other locations so a
  // session is evaluated once, not once per loaded instance.
  const location = event?.location?.directory
  if (location && ctx.location?.directory && location !== ctx.location.directory) return
  await evaluateGoal(ctx, sessionID)
}

const plugin = {
  id: "goal",
  async setup(ctx: any) {
    await ctx.command.transform((editor: any) => {
      editor.add({
        name: "goal",
        description: "Set, show, or clear the judged stopping condition for this session",
        execute: async ({ sessionID, prompt }: any) => {
          const text = typeof prompt?.text === "string" ? prompt.text.trim() : ""
          const existing = await loadGoal(ctx, sessionID)

          if (!text || text.toLowerCase() === "status") {
            const status = existing
              ? [
                  `Goal: ${existing.condition}`,
                  `Status: ${existing.status}`,
                  `Continues: ${existing.continuations}/${existing.max}`,
                  `Last verdict: ${existing.lastReason ?? "(none)"}`,
                  `goal ${VERSION}`,
                ].join("\n")
              : `No goal set. Use /goal <condition>.\ngoal ${VERSION}`
            // Commands have no output channel, and a session message would start
            // a turn that the goal watcher would judge. Surface it as an error.
            throw new Error(status)
          }

          if (text.toLowerCase() === "clear") {
            await ctx.storage.remove(goalKey(sessionID))
            return
          }

          await saveGoal(ctx, sessionID, {
            condition: text,
            status: "active",
            continuations: 0,
            max: maxContinuations(),
          })
        },
      })
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await handleEvent(ctx, event)
          } catch (error) {
            console.error(`goal: event handling failed: ${error}`)
          }
        }
      } catch {
        // The stream closed or the plugin unloaded.
      }
    })()
    return () => controller.abort()
  },
}

export { decide, evaluateGoal, handleEvent, judgePrompt, parseVerdict, VERSION }
export default plugin

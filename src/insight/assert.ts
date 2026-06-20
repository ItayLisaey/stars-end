/**
 * assert / check / waitFor. `assert` is a boolean query + thought.
 */
import { z } from "zod";
import type { PageDriver } from "../driver/types.js";
import { AssertionError, WaitForTimeoutError } from "../errors.js";
import { callObject } from "../model/call.js";
import type { ModelTier, UIContext } from "../model/types.js";
import { ASSERT_SYSTEM_PROMPT } from "./prompts.js";

export interface CheckResult {
  pass: boolean;
  thought: string;
}

const AssertSchema = z.object({ thought: z.string(), pass: z.boolean() });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function check(
  page: PageDriver,
  tier: ModelTier,
  assertion: string,
  context?: UIContext,
): Promise<CheckResult> {
  const ctx = context ?? (await tier.buildContext(page));
  const { object } = await callObject({
    schema: AssertSchema,
    system: ASSERT_SYSTEM_PROMPT,
    userText: `Assert whether this is true based on the current screenshot: ${assertion}`,
    imageDataUrl: ctx.screenshotDataUrl,
  });
  return object;
}

export async function assert(page: PageDriver, tier: ModelTier, assertion: string): Promise<void> {
  const r = await check(page, tier, assertion);
  if (!r.pass) throw new AssertionError(assertion, r.thought);
}

export interface WaitOpt {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function waitFor(
  page: PageDriver,
  tier: ModelTier,
  assertion: string,
  opt?: WaitOpt,
): Promise<void> {
  const deadline = Date.now() + (opt?.timeoutMs ?? 15_000);
  const interval = opt?.pollIntervalMs ?? 1500;
  for (;;) {
    if ((await check(page, tier, assertion)).pass) return;
    if (Date.now() > deadline) throw new WaitForTimeoutError(assertion);
    await sleep(interval);
  }
}

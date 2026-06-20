<p align="center">
  <img src="https://raw.githubusercontent.com/ItayLisaey/stars-end/main/assets/header.jpg" alt="stars-end — a Playwright AI testing helper" width="100%" />
</p>

# stars-end

A lightweight, **Playwright-only**, **Gemini-first** library for driving a
browser with natural language. Hand it a Playwright `Page` and plain-English
instructions — it locates elements visually, performs actions, reads structured
data, and can run an autonomous planning loop to accomplish a goal.

```ts
import { chromium } from "playwright";
import { z } from "zod";
import { Agent } from "stars-end";

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto("https://example.com/shop");

const agent = new Agent(page, { model: "gemini-2.5-flash" });

// instant actions
await agent.tap('the "Add to cart" button for the backpack');
await agent.input("john@example.com", "the email field");
await agent.keyboardPress("Enter");
await agent.scroll({ direction: "down", distance: 600 }, "the product list");

// structured read
const items = await agent.query(
  z.array(z.object({ name: z.string(), price: z.number() })),
  "the cart line items",
);

// assertions
await agent.assert("the order total is $42.00");
await agent.waitFor("the success toast is visible", { timeoutMs: 10_000 });

// autonomous
const result = await agent.act("add the cheapest backpack to the cart and go to checkout");
```

## Install

```sh
pnpm add stars-end playwright
# or: npm i stars-end playwright
```

Set your model key:

```sh
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

`playwright` is a peer dependency. Model calls go through the Vercel AI SDK
(`ai` + `@ai-sdk/google`); swapping providers is mostly a one-liner because the
model tier is abstracted behind a small interface.

## Why

- **One driver, one focus.** Just Playwright and visual grounding — no Android /
  iOS / desktop surfaces, no bridge mode, no MCP servers.
- **Structured output via the AI SDK.** Schemas are passed natively to
  `generateObject`; no hand-rolled JSON repair on the happy path.
- **Deterministic, testable core.** The coordinate pipeline (normalized → image
  pixels → CSS pixels) is pure and fully unit-tested.
- **Cheap reruns.** An optional XPath-keyed locate cache makes repeated flows
  fast and deterministic.

## API

```ts
const agent = new Agent(page, {
  model: "gemini-2.5-flash",
  cache: { id: "checkout-flow" }, // optional XPath locate cache
  trace: { path: "trace.jsonl" }, // optional JSONL trace
});

// actions
await agent.tap(prompt);
await agent.rightClick(prompt);
await agent.doubleClick(prompt);
await agent.hover(prompt);
await agent.input(value, prompt?, { mode: "replace" | "clear" | "typeOnly" });
await agent.keyboardPress("Control+A");
await agent.scroll({ direction, distance }, prompt?);

// insight
const data = await agent.query(schema, demand);
await agent.assert(assertion); // throws on false
const ok = await agent.check(assertion); // non-throwing
await agent.waitFor(assertion, { timeoutMs });

// low-level + autonomous
const { x, y, rect, xpath } = await agent.locate(prompt);
const result = await agent.act(goal);

await agent.flushTrace();
```

## How it works

The one load-bearing abstraction is `locate(instruction) → { x, y }` in CSS
pixels. Everything else composes from it:

- an **instant action** is `build context → locate → one driver call`
- **planning** is `plan → resolve each action's locate → execute`, with
  replanning and a step history fed back to the model

The visual-grounding model returns a bounding box in its own normalized
coordinate space; a pure pipeline reorders, denormalizes, validates, and clamps
it down to a clickable CSS-pixel point. For dense or tiny targets there's an
optional two-stage "deep locate" that crops and upscales the region before
re-locating.

## Development

```sh
pnpm test          # run the suite
pnpm typecheck
pnpm build
pnpm lint          # oxlint
pnpm fmt           # oxfmt
```

Live model tests (under `test/live/`) require `GOOGLE_GENERATIVE_AI_API_KEY` and
are excluded from the default run.

## Acknowledgements

stars-end is **heavily influenced by [Midscene](https://github.com/web-infra-dev/midscene)**.
Several of its core mechanisms — most notably the visual-grounding **coordinate
pipeline** and the **locate / planning** approach — are **ported or adapted**
from Midscene. Midscene is a much broader project (many platforms and model
families); stars-end is a focused, Playwright-and-Gemini-only take on the parts
we use most.

Huge thanks to the Midscene authors at ByteDance for the battle-tested design
this builds on.

## License

[MIT](./LICENSE). Midscene is also MIT-licensed; its copyright notice is
included in the [LICENSE](./LICENSE) file for the ported portions.

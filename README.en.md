# dsh-deep-search

> **Stop letting your DSH agent conclude from a single search.**
> Multi-round iterative deep research · 14 platform-targeted retrievers · A/B/C/D source grading · cross-validation · misinformation heuristics.

[![npm version](https://img.shields.io/npm/v/dsh-deep-search)](https://www.npmjs.com/package/dsh-deep-search)
[![license](https://img.shields.io/npm/l/dsh-deep-search)](./LICENSE)

A one-shot `web_search` answering "has model X shipped?" — with an aggregator's clickbait headline — is how hallucinated facts get into your context.

**dsh-deep-search** makes the *plan → parallel-retrieve → parse → rewrite → verify* loop the **default behavior** of a DSH session. The intelligence is your session model; the grunt work (dedup, clustering, trust grading, rumor flags) is the plugin. Zero forced payments: no API key needed for the core platforms; quota-exhausted engines fall to the back of the chain and self-heal.

中文 README：[README.md](./README.md)

## Install

```bash
dsh plugin --profile desktop add dsh-deep-search
# restart DSH (the web profile disables HMR)
```

Then just ask: *"Has Qwen4-Max actually been released?"* — the model auto-loads the deep-research protocol and iterates until it finds A-grade official evidence or honestly reports **not found**.

## What you get

| | |
|---|---|
| 🔁 Default iteration | System-prompt injection + SKILL: time-sensitive / contested questions iterate up to 5 rounds without being asked |
| 🌐 14 platforms | GitHub · HuggingFace · ModelScope · Zhihu · Reddit · HackerNews · StackOverflow · Wikipedia · V2EX · npm · bilibili · Weibo · X (best-effort) · free general engines (Bing/DDG/SearXNG/Mojeek/Firecrawl) |
| 🧮 Trust grades | A official announcement → B official interaction → C community (needs cross-validation) → D media/unknown. Data-driven, user-extensible |
| 🕵️ Rumor detection | content-farm / clickbait / satire / single-source / date-conflict / stale flags, automatic |
| 🔗 Cross-validation matrix | Same-event clustering + independent-domain counting kills "3 reprints ≠ 3 sources" |
| 🚫 Honest degradation | X/Weibo/bilibili anti-bot failures surface as `gaps` with `unavailable/degraded` — web substitutes are never presented as X coverage |
| 📄 "Not found" discipline | When nothing confirms: coverage + graded clues + explicitly *"this does not mean it did not happen"* |
| 💸 No paid walls | Optional keyed engines (Tavily/Serper/Bocha/Exa/Firecrawl) activate only when credentials resolve; free channels cover the default flow |

## Tools

```jsonc
deep_search({ question, queries: [ "…", { q, target, timeRange } ], researchId, budgetChars })
// → results[trustRank, flags, extracted] · clusters · gaps · officialConfirmation · hint · stats
deep_search({ doctor: true })            // zero-quota readiness of every channel
research_state({ researchId, action })   // summary / close / reset — the citation matrix
verify_claims({ researchId, claims })    // evidence match + rule-suggested verdict
```

## Architecture

Four roles — the model plans/parses/rewrites/adjudicates; the plugin executes, dedups, clusters, grades, budgets, and reports honestly. See [SKILL.md](assets/skills/dsh-deep-search/SKILL.md) for the full protocol.

## Compared to

- **dsh-web-search-pro**: heavy search infra (cache/evidence-packs/browser); iteration protocol left to you.
- **dsh-free-search**: 19 keyless engines + image wall, single round.
- **dsh-zhihu-search**: single-platform official-API specialist.
- **modsearch**: keyless web/X bridge (X needs local Grok), single shot.

dsh-deep-search coexists with all of them: it never overrides the `ctx.web` seam.

## Development

```bash
pnpm install && pnpm run typecheck && pnpm test   # 98 offline tests
pnpm run build                                    # tsdown → lib/
```

## License

MIT

---

## ⭐ Found this useful?

Every feature here came from getting burned by a lazy one-shot answer. If it makes your agent citable and traceable, **a star is the cheapest way to say so** — and the best way to help the next person find it. Issues and PRs welcome.

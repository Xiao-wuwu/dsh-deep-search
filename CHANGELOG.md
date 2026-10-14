# Changelog

## 0.1.0 — 2026-10-14

Initial release.

### Added
- **Iterative deep-research protocol** as default session behavior (system-prompt injection + bundled `dsh-deep-search` skill with references: planning checklist / trust rules / output template / troubleshooting).
- **`deep_search`** tool: parallel multi-query retrieval (≤24/query call), cross-round dedupe via `researchId`, near-duplicate clustering, A/B/C/D trust grading, misinformation flags (`clickbait`/`content_farm`/`satire`/`single_source`/`date_conflict`/`stale`/`low_trust_only`), rule-extracted entities (`@accounts`/dates/versions/quoted phrases/action words), `officialConfirmation`, `gaps` with honest `degraded/unavailable` statuses (web substitutes never presented as X coverage), `hint.suggest` expand/shrink advice, hard char budget with `omitted` accounting.
- **`research_state`** tool: round history, coverage stats, cross-validation matrix (independent-domain counts per cluster), `reset` / `close`.
- **`verify_claims`** tool: offline lexical claim↔evidence matching with entity weighting; supports/contradicts/no-evidence split; rule-suggested verdict (`multi-source`/`single-source`/`conflicting`/`no-evidence`).
- **`doctor`** mode (zero-quota): per-channel readiness, missing optional credentials, cooldown state, fixes.
- **Free general engines**: Bing / DuckDuckGo (html+lite) / SearXNG (instance rotation) / Mojeek / Firecrawl keyless — no keys, no signup.
- **Optional keyed engines** (activate only with credentials in the DSH credentials store; never forced): Tavily, Serper, Bocha, Exa, Firecrawl key — all with free tiers.
- **10 stable platform adapters**: GitHub, HackerNews (Algolia), Reddit, StackOverflow, Wikipedia, V2EX, npm, Hugging Face, ModelScope, Zhihu (Open Platform Access Secret).
- **Verify/best-effort platforms**: bilibili (risk-control honest), Weibo (login-wall honest), X (three-tier endpoint → local tool → syndication HTML; failure reported as `unavailable`, never faked).
- **Engine cooldown**: quota/429 channels move to the back of the chain and self-heal (learned from modsearch); local token bucket + per-target timeouts + LRU cache (cache-before-rate-limit).
- **Honesty contracts** (learned from dsh-zhihu-search): tool `execute` never throws — structured error envelopes; optional fields omitted when upstream is silent, never zero-filled; declared-field sets guard every envelope key.
- In-memory research store with TTL (2h default) and concurrency cap (20).

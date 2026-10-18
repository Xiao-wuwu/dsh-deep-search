# Changelog

All notable changes to this project. Format loosely follows Keep a Changelog;
versions correspond to real git commits (no retro-fitted entries).

## 0.1.11 — 2026-10-17

### Fixed
- **Bundle patch row name**: `cordis.patch.yml` now inserts the row as
  `name: "@xiaowuwu/dsh-deep-search"` (was the stale unscoped `dsh-deep-search`). The loader
  resolves a row's `name` from the profile's `node_modules`; after the 0.1.9 scoped rename the
  alias directory no longer exists, so the row stayed `fiberPhase: null` (enabled but never
  mounted, no `deep_search` tool at runtime).

## 0.1.10 — 2026-10-17

### Fixed
- **Host 0.2.1-rc.2 compatibility**: widened every `@deepseek-ai/*` peer range from
  `>=0.2.0-rc.2 <0.2.1-0` to `>=0.2.0-rc.2 <0.3.0` so the bundle mounts on 0.2.1.x hosts
  (0.2.1-rc.2 previously left every row unmounted: no `deep_search` tool at runtime).
- **Client bundle id**: `build` script now wraps `lib/client.js` with the scoped package id
  `@xiaowuwu/dsh-deep-search` (was the unscoped `dsh-deep-search`), matching the
  `plugins.bundle.config` slot key the plugin-manager dispatches (`entryKey = pkg.name`).
- **Settings card key**: `BUNDLE_PACKAGE` in `src/client.ts` updated to the scoped name so the
  `alwaysSearch` toggle renders on the bundle page.

## 0.1.9 — 2026-10-16

### Changed
- Renamed to scoped package `@xiaowuwu/dsh-deep-search` (npm rejected the unscoped name as too
  similar to `dsh-deepsearch`); README badges and install snippets updated.
- Full CHANGELOG backfill for 0.1.1–0.1.9 from real commits.

## 0.1.8 — 2026-10-15

### Added
- **Client half (`./client` export)**: settings-page card so the `alwaysSearch` toggle appears in
  **Settings → Plugins → dsh-deep-search → configuration** in the DSH Web GUI.
  - Exports `name` / `inject` / `apply` / `SettingsCard` (verified against the working
    `@deepseek-ai/dsh-client-ui-plugin-manager` contract: owner passes `{ view }`, not `form`).
  - Built to `lib/client.js` + `lib/client.d.ts`; optional peer deps on
    `dsh-client-store` / `dsh-client-ui-primitives` / `-settings` / `-slots`.
- **English-first README**: English is now the primary section, Chinese follows under `## 中文说明`.

### Changed
- Package renamed to **`@xiaowuwu/dsh-deep-search`** for npm publishing
  (npm rejects `dsh-deep-search` as *too similar to existing package `dsh-deepsearch`*).
  Plugin id / tool names are unchanged (`dsh-deep-search`, `deep_search`).

## 0.1.7 — 2026-10-15

### Changed
- README reordered to English-first (superseded by the same change in 0.1.8).

## 0.1.6 — 2026-10-15

### Added
- npm publish metadata: `repository`, `author`, `homepage`, `bugs`.
- **GitHub Sponsors funding button** (`.github/FUNDING.yml`) + donate sections in both READMEs.

## 0.1.5 — 2026-10-15

### Changed
- **Payload slimming**: the `deep_search` envelope now ships only **multi-source clusters**
  (size ≥ 2). Singleton clusters carried no cross-validation signal yet accounted for ~45 % of
  the response; the full matrix is still kept in the store and returned by `research_state`.
- Default `budgetChars` lowered **9000 → 6000**.

### Added (SKILL hardening, all from a real miss)
- Mandatory **sub-event decomposition** (entity × action × timeline), driven by a live failure where
  the "Qwen4-Max and 27B releasing together" tease was only found after user correction.
- **Must-query-new-entities** rule: entities surfaced in `extracted` (versions/accounts/quotes) are
  leads, not noise — query them next round.
- **Never-blame-the-channel** rule: a failed channel (X/Weibo/…) must not be reported as
  "no information exists"; retry through a general engine with `site:` first.

## 0.1.4 — 2026-10-15

### Fixed
- **Trust grading**: UGC pages living on official domains no longer inherit grade A.
  `baike.baidu.com` was graded A in a live audit; added `officialDenyHosts`
  (baike / zhuanlan.zhihu / jingyan / wenku / tieba) + regression test.

## 0.1.3 — 2026-10-15

### Fixed
- **Host schema rejection**: `clusters[].independentDomains` was projected into the envelope but
  not declared in the output schema, so the host rejected every `deep_search` call
  (`additionalProperties: false`) after restart.

### Added
- **HOST-validator contract test** (`valueSchemaSpecToJsonSchema` + `validateJsonSchemaValue`)
  that feeds real envelopes through the host's own validator — this is the guard that would have
  caught the bug above and that a field-set comparison could not.

## 0.1.2 — 2026-10-15

### Fixed
- **Entry crash on sparse host config** (root cause of "failed to import"):
  omitted array fields arrived as `undefined` and `mergeConfig` overwrote defaults, so
  `buildEngines` threw `TypeError: cfg.enabled is not iterable` at construction time.
  `apply()` now normalises every field defensively; regression test added.
- `exports["."]` pointed at non-existent `./lib/index.js`; now `./lib/index.mjs`.

### Added
- Cold-process self-check (`scripts/selfcheck.mjs`) against the built artifact.

## 0.1.1 — 2026-10-15

### Fixed
- **Bing engine rewritten to the RSS endpoint** (`&format=rss`, anonymous, stable) instead of
  scraping HTML — learned by reading the working `dsh-web-search-pro` source.
  Real-network smoke: 8 hits / 773 ms (was 0 / flaky).
- **Hugging Face via `hf-mirror.com` first**, `huggingface.co` fallback — direct HF times out on
  CN networks. Real-network smoke: 5 hits / 1.1 s (was timeout / 0 hits).
- Smoke-driven repairs: undici manual 3xx follow + gzip/br decoding, ModelScope verified as
  `PUT /api/v1/models`, per-query hard deadline, no retry on timeout, owner-verified A grading.

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

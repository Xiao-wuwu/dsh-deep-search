/** Credential resolution: config stores only reference NAMES; secret VALUES come from the
 *  DSH credentials store. Only non-empty resolved values become entries (spec §4.6). */

/** logical channel name → credential reference name (matches spec §7 credentialRefs). */
export const CREDENTIAL_REFS: Record<string, string> = {
  tavily: "TAVILY_API_KEY",
  serper: "SERPER_API_KEY",
  bocha: "BOCHA_API_KEY",
  exa: "EXA_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  zhihu: "ZHIHU_ACCESS_SECRET",
  x: "ROLLI_API_TOKEN",
};

export type CredStore = Map<string, string>;

/** Map a raw store (keyed by ref NAME) → a logical map (keyed by channel, only present secrets). */
export function resolveCreds(store: CredStore): Map<string, string> {
  const out = new Map<string, string>();
  for (const [logical, ref] of Object.entries(CREDENTIAL_REFS)) {
    const raw = store.get(ref) ?? store.get(logical);
    if (raw && raw.trim().length > 0) {
      out.set(logical, raw.trim());
      out.set(ref, raw.trim()); // also under the ref name for engine lookups
    }
  }
  return out;
}

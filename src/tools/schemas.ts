/** Tool parameter + output schemas (dsh-tools ValueSchemaSpec DSL) AND the field sets
 *  the contract test derives from them — one source of truth so the envelope can never
 *  carry an undeclared key (zhihu v1.4.0 drift guard). */
import type { ParameterSchemaSpec, ValueSchemaSpec } from "@deepseek-ai/dsh-tools";

const str = (description?: string): ValueSchemaSpec & { required?: true } => ({ type: "string", ...(description ? { description } : {}) });
const num = (): ValueSchemaSpec => ({ type: "number" });
const bool = (): ValueSchemaSpec => ({ type: "boolean" });

/* ---------------- deep_search ---------------- */

export const deepSearchParams: ParameterSchemaSpec = {
  question: { type: "string", description: "原始问题（用于官方公告判定与状态摘要，可选）" },
  mode: { type: "string", enum: ["manual"], description: "当前仅 manual；平台定向由查询项的 target 决定" },
  queries: {
    type: "array",
    items: { type: "json" },
    required: true,
    description: '查询列表：字符串，或 {q, target?(引擎/平台id), timeRange?(day/week/month/year), maxResults?}',
  },
  researchId: { type: "string", description: "省略则新建研究；传入则续轮（自动跨轮去重）" },
  maxResultsPerQuery: { type: "number", description: "每条查询取回上限，默认 8，上限 15" },
  budgetChars: { type: "number", description: "结果信封总字符预算，默认 9000，上限 20000" },
  doctor: { type: "boolean", description: "true=零配额自检，返回各引擎/平台就绪与修复建议，不执行检索" },
};

export const deepSearchOutput: ValueSchemaSpec = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", required: true },
    researchId: { type: "string", required: true },
    round: { type: "number", required: true },
    maxRoundsReached: { type: "boolean", required: true },
    newCount: { type: "number", required: true },
    skippedDuplicates: { type: "number", required: true },
    results: {
      type: "array",
      required: true,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          title: { type: "string", required: true },
          url: { type: "string", required: true },
          snippet: { type: "string", required: true },
          target: { type: "string", required: true },
          trustRank: { type: "string", required: true, enum: ["A", "B", "C", "D"] },
          flags: { type: "array", required: true, items: { type: "string" } },
          date: { type: "string" },
          author: { type: "string" },
          clusterId: { type: "string" },
          clusterSize: { type: "number" },
          votes: { type: "number" },
          comments: { type: "number" },
          extracted: {
            type: "object", additionalProperties: false,
            properties: {
              accounts: { type: "array", required: true, items: { type: "string" } },
              dates: { type: "array", required: true, items: { type: "string" } },
              versions: { type: "array", required: true, items: { type: "string" } },
              quotes: { type: "array", required: true, items: { type: "string" } },
              actionWords: { type: "array", required: true, items: { type: "string" } },
            },
          },
        },
      },
    },
    clusters: {
      type: "array", required: true,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          clusterId: { type: "string", required: true },
          size: { type: "number", required: true },
          memberUrls: { type: "array", required: true, items: { type: "string" } },
          trustMix: { type: "json", required: true },
          topTitle: { type: "string", required: true },
          dateRange: { type: "array", items: { type: "string" } },
        },
      },
    },
    gaps: {
      type: "array", required: true,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          target: { type: "string", required: true },
          reason: { type: "string", required: true },
          status: { type: "string", required: true, enum: ["degraded", "unavailable", "failed"] },
          requestedTarget: { type: "string" },
          actualTarget: { type: "string" },
        },
      },
    },
    officialConfirmation: {
      type: "object", required: true, additionalProperties: false,
      properties: {
        status: { type: "string", required: true, enum: ["found", "none"] },
        evidence: { type: "array", required: true, items: { type: "string" } },
      },
    },
    hint: {
      type: "object", required: true, additionalProperties: false,
      properties: {
        coverage: { type: "string", required: true },
        suggest: { type: "array", required: true, items: { type: "string" } },
      },
    },
    stats: {
      type: "object", required: true, additionalProperties: false,
      properties: {
        elapsedMs: { type: "number", required: true },
        queriesRun: { type: "number", required: true },
        perTarget: { type: "json", required: true },
      },
    },
    omitted: {
      type: "object", additionalProperties: false,
      properties: {
        count: { type: "number", required: true },
        reason: { type: "string", required: true },
      },
    },
    doctor: { type: "json" },
    error: {
      type: "object", additionalProperties: false,
      properties: {
        code: { type: "string", required: true },
        message: { type: "string", required: true },
        hint: { type: "string" },
      },
    },
  },
};

/* ---------------- research_state ---------------- */

export const researchStateParams: ParameterSchemaSpec = {
  researchId: { type: "string", required: true },
  action: { type: "string", enum: ["summary", "close", "reset"], required: true },
};

export const researchStateOutput: ValueSchemaSpec = {
  type: "object", additionalProperties: false,
  properties: {
    ok: { type: "boolean", required: true },
    researchId: { type: "string", required: true },
    question: { type: "string" },
    action: { type: "string", required: true, enum: ["summary", "close", "reset"] },
    released: { type: "boolean" },
    roundCount: { type: "number", required: true },
    maxRoundsReached: { type: "boolean", required: true },
    totalNew: { type: "number", required: true },
    totalDuplicates: { type: "number", required: true },
    totalSeen: { type: "number", required: true },
    targetsOk: { type: "array", required: true, items: { type: "string" } },
    targetsFailed: { type: "array", required: true, items: { type: "string" } },
    trustMix: { type: "json", required: true },
    officialConfirmation: { type: "string", required: true, enum: ["found", "none"] },
    clusters: {
      type: "array", required: true,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          clusterId: { type: "string", required: true },
          size: { type: "number", required: true },
          memberUrls: { type: "array", required: true, items: { type: "string" } },
          trustMix: { type: "json", required: true },
          topTitle: { type: "string", required: true },
          independentDomains: { type: "number", required: true },
          dateRange: { type: "array", items: { type: "string" } },
        },
      },
    },
    rounds: { type: "array", required: true, items: { type: "json" } },
    error: {
      type: "object", additionalProperties: false,
      properties: {
        code: { type: "string", required: true },
        message: { type: "string", required: true },
        hint: { type: "string" },
      },
    },
  },
};

/* ---------------- verify_claims ---------------- */

export const verifyParams: ParameterSchemaSpec = {
  researchId: { type: "string", required: true },
  claims: {
    type: "array", required: true,
    items: { type: "json" },
    description: "待验证断言：{text, id?} 列表",
  },
};

export const verifyOutput: ValueSchemaSpec = {
  type: "object", additionalProperties: false,
  properties: {
    ok: { type: "boolean", required: true },
    researchId: { type: "string" },
    results: {
      type: "array", required: true,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          claimId: { type: "string", required: true },
          claim: { type: "string", required: true },
          supports: { type: "array", required: true, items: { type: "string" } },
          contradicts: { type: "array", required: true, items: { type: "string" } },
          independentSources: { type: "number", required: true },
          trustMix: { type: "json", required: true },
          suggestion: { type: "string", required: true, enum: ["multi-source", "single-source", "conflicting", "no-evidence"] },
        },
      },
    },
    error: {
      type: "object", additionalProperties: false,
      properties: {
        code: { type: "string", required: true },
        message: { type: "string", required: true },
        hint: { type: "string" },
      },
    },
  },
};

/* ---------- derive the declared-field sets for the contract test ---------- */

function singular(k: string): string {
  return k.endsWith("s") ? k.slice(0, -1) : k;
}

function collect(spec: ValueSchemaSpec | undefined, prefix: string, out: Set<string>): void {
  if (!spec || typeof spec !== "object") return;
  const s = spec as unknown as Record<string, unknown>;
  if (s.type === "object" && s.properties) {
    for (const [k, v] of Object.entries(s.properties as Record<string, ValueSchemaSpec>)) {
      out.add(prefix + k);
      const vn = v as unknown as Record<string, unknown>;
      if (vn.type === "object") {
        collect(v, `${prefix}${k}:`, out);
      } else if (vn.type === "array" && vn.items && (vn.items as Record<string, unknown>).type === "object") {
        collect(vn.items as unknown as ValueSchemaSpec, `${prefix}${singular(k)}:`, out);
      }
    }
  } else if (s.type === "array" && s.items) {
    collect(s.items as unknown as ValueSchemaSpec, prefix, out);
  }
}

function fieldSet(spec: ValueSchemaSpec): Set<string> {
  const out = new Set<string>();
  collect(spec, "", out);
  return out;
}

export const DEEP_SEARCH_OUTPUT_FIELDS = fieldSet(deepSearchOutput);
export const RESEARCH_STATE_OUTPUT_FIELDS = fieldSet(researchStateOutput);
export const VERIFY_OUTPUT_FIELDS = fieldSet(verifyOutput);

void str; void num; void bool; // reserved helpers for future required-annotation sugar

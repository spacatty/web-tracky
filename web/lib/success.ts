import type { SuccessRule } from "@/lib/types";

export type DraftRule = {
  status: string;
  body: "any" | "empty" | "contains";
  text: string;
  join: "and" | "or";
};

export function blankRule(): DraftRule {
  return { status: "", body: "any", text: "", join: "or" };
}

export function toDraft(rules: SuccessRule[] | null | undefined): { enabled: boolean; rules: DraftRule[] } {
  if (!rules || rules.length === 0) return { enabled: false, rules: [blankRule()] };
  return {
    enabled: true,
    rules: rules.map((rule, index) => ({
      status: String(rule.status),
      body: rule.body === "empty" || rule.body === "contains" ? rule.body : "any",
      text: rule.text ?? "",
      join: index > 0 && rule.join === "and" ? "and" : "or",
    })),
  };
}

export function compileRules(enabled: boolean, rules: DraftRule[]): { ok: true; rules: SuccessRule[] } | { ok: false; error: string } {
  if (!enabled) return { ok: true, rules: [] };
  if (rules.length === 0) return { ok: false, error: "Add at least one success rule." };
  const out: SuccessRule[] = [];
  for (const [index, rule] of rules.entries()) {
    const status = Number(rule.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return { ok: false, error: `Rule ${index + 1} needs an HTTP status from 100 to 599.` };
    }
    const text = rule.text.trim();
    if (rule.body === "contains" && text === "") {
      return { ok: false, error: `Rule ${index + 1} needs response text.` };
    }
    out.push({
      status,
      body: rule.body,
      text: rule.body === "contains" ? text : undefined,
      join: index === 0 ? undefined : rule.join,
    });
  }
  return { ok: true, rules: out };
}

export function successLabel(name: string | null | undefined, rules: SuccessRule[] | null | undefined) {
  const described = describeSuccess(rules);
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} · ${described}` : described;
}

export function describeSuccess(rules: SuccessRule[] | null | undefined) {
  if (!rules || rules.length === 0) return "2xx–3xx";
  return rules
    .map((rule, index) => {
      const clause =
        rule.body === "empty" ? `${rule.status} empty body` : rule.body === "contains" ? `${rule.status} “${rule.text ?? ""}”` : String(rule.status);
      if (index === 0) return clause;
      return `${rule.join === "and" ? "and" : "or"} ${clause}`;
    })
    .join(" ");
}

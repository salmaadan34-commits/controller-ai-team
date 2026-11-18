// The rulebook: one place that decides what agents may finish on their own
// and what must be held for the controller. Every agent action passes through evaluate().

export const JE_APPROVAL_LIMIT = 10000;

/** Revenue accounts are 4000-4199; 4900 other income (e.g. interest) is not revenue. */
export const isRevenueAccount = (acct) => /^4[01]\d\d$/.test(String(acct));

export const RULES = [
  {
    id: 1,
    name: "Anything to the IRS or a state",
    why: "Filings and payments to tax authorities are signed by a person.",
    test: (a) => a.destination === "tax_authority",
  },
  {
    id: 2,
    name: "Releasing cash",
    why: "Agents prepare payment runs; only a person releases money.",
    test: (a) => a.type === "payment",
  },
  {
    id: 3,
    name: `Journal entries ≥ $${JE_APPROVAL_LIMIT.toLocaleString("en-US")} or touching revenue`,
    why: "Material entries and anything in revenue get a second set of eyes.",
    test: (a) =>
      a.type === "journal_entry" &&
      ((a.amount ?? 0) >= JE_APPROVAL_LIMIT || (a.accounts ?? []).some((x) => isRevenueAccount(x))),
  },
  {
    id: 4,
    name: "Anything to auditors or the board",
    why: "External reporting goes out under the controller's name.",
    test: (a) => a.destination === "auditor" || a.destination === "board",
  },
  {
    id: 5,
    name: "Vendor or bank master-data changes",
    why: "Changed bank details are the #1 payment-fraud route; verify by call-back.",
    test: (a) => a.type === "master_data",
  },
];

/** Returns { held, rules } — every rule the action triggers, in rulebook order. */
export function evaluate(action) {
  const hits = RULES.filter((r) => r.test(action));
  return { held: hits.length > 0, rules: hits };
}

/** Splits a list of actions into done and held, tagging each with its rule hits. */
export function triage(actions) {
  const done = [];
  const held = [];
  for (const a of actions) {
    const r = evaluate(a);
    (r.held ? held : done).push({ ...a, rules: r.rules });
  }
  return { done, held };
}

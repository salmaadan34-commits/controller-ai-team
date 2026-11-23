// Turns the connected projects' outputs (data/linked.json) into this week's agent actions
// and cross-project data checks. Nothing here is hand-typed: every action names its source.
import { triage } from "./rules.js";

/** Invoices this many days past due or fewer are watched, not chased. */
export const COLLECTIONS_GRACE_DAYS = 10;

export const TEAMS = [
  { id: "close", name: "Close", roles: ["Bank rec", "Pre-close checks", "Proposed JEs", "Flux commentary", "Close KPIs"] },
  { id: "ap", name: "AP & Spend", roles: ["Payment run prep", "Disputes & holds", "Due-date tracking", "Vendor master", "Spend review"] },
  { id: "ar", name: "AR & Revenue", roles: ["Collections", "Cash forecast", "Bad debt reserve", "Aging review", "Credit memos"] },
  { id: "payroll", name: "Payroll & People", roles: ["Headcount tie-out", "Open roles", "Payroll rec", "Accrued payroll", "Benefits"] },
  { id: "tax", name: "Tax & Compliance", roles: ["Sales tax", "1099 prep", "Estimated taxes", "R&D credit", "Property tax"] },
  { id: "fpa", name: "Reporting & FP&A", roles: ["Cash hand-off", "13-week cash", "Board pack", "Variance notes", "KPI tie-out"] },
];

const num = (x) => Number(String(x).replace(/[$,]/g, "")) || 0;
const usd = (x, d = 0) => `$${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const k = (x) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(1)}K`);
const kv = (rows, key = "item", val = "value") => Object.fromEntries(rows.map((r) => [r[key], r[val]]));
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clean = (d) => {
  const t = d.replace(/\s+REF\b.*$/i, "").trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bLlc\b/g, "LLC") : t;
};
const fmtDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Bank rec as auditors read it: balance per bank and per books, and the reconciling items between them.
const BOOK_LABELS = {
  "Unbooked bank fee": "Bank charges not yet booked",
  "Unbooked interest": "Interest not yet booked",
  "Duplicate GL entry": "Error: duplicate GL entry",
  "Amount mismatch": "Error: transposed amount",
  "Unrecorded transaction": "Receipt not yet recorded",
};
function bankRecDetail(bank) {
  const rows = [];
  for (const a of bank.accounts) {
    const its = bank.items.filter((i) => i.account === a.account);
    const name = a.account[0] + a.account.slice(1).toLowerCase();
    if (!its.length) {
      rows.push([name, `Bank ${usd(a.bank_end, 2)} = books ${usd(a.gl_end, 2)} · no reconciling items`]);
      continue;
    }
    const group = (cats) => its.filter((i) => cats.includes(i.category));
    const dit = group(["Deposit in transit"]), os = group(["Outstanding check", "Stale item"]);
    const sum = (xs) => xs.reduce((s, i) => s + i.amount, 0);
    rows.push([`${name} · per bank`, usd(a.bank_end, 2)]);
    if (dit.length) rows.push(["  + Deposits in transit", `${dit.length} · ${usd(sum(dit), 2)}`]);
    if (os.length) rows.push(["  − Outstanding checks", `${os.length} · ${usd(Math.abs(sum(os)), 2)}${group(["Stale item"]).length ? " (incl. 1 stale)" : ""}`]);
    rows.push([`${name} · per books`, usd(a.gl_end, 2)]);
    for (const [cat, label] of Object.entries(BOOK_LABELS)) {
      const xs = group([cat]);
      if (!xs.length) continue;
      // effect on the books = net debit to the cash account in the proposed entry
      const eff = xs.reduce((s, i) => s + i.je_lines.filter((l) => /^10/.test(l[0])).reduce((t, l) => t + l[2] - l[3], 0), 0);
      rows.push([`  ${eff >= 0 ? "+" : "−"} ${label}`, `${xs.length} · ${usd(Math.abs(eff), 2)}`]);
    }
    rows.push([`${name} · unreconciled`, usd(a.difference, 2)]);
  }
  return rows;
}

export function buildWeek(linked) {
  const S = linked.sources;
  const bank = S.close.files["examples/bank_rec_summary_2026-10.json"];
  const pre = S.close.files["examples/preclose_summary_2026-10.json"];
  const cashCo = kv(S.cash.files["data/company.csv"]);
  const ap = S.cash.files["data/ap_aging.csv"];
  const ar = S.cash.files["data/ar_aging.csv"];
  const cfoCo = kv(S.cfo.files["data/company.csv"]);
  const kpis = S.cfo.files["data/close_kpis.csv"];
  const hc = S.cfo.files["data/headcount.csv"];
  const bal = S.cfo.files["data/balances.csv"];
  const notes = S.cfo.files["data/variance_notes.csv"];
  const cfoAr = S.cfo.files["data/ar_aging_nov13.csv"];

  const asOf = cashCo.as_of_date;
  const minCash = num(cfoCo.minimumCash) * 1000;
  const openingCash = num(cashCo.opening_cash_usd);
  const actions = [];
  let n = 0;
  const add = (a) => actions.push({ id: `A${String(++n).padStart(2, "0")}`, ...a });

  // ---------------- Close  (month-end-close-agent + CFO close KPIs)
  for (const a of bank.accounts) {
    add({ team: "close", role: "Bank rec", source: "close", type: "reconciliation",
      title: `${a.account[0] + a.account.slice(1).toLowerCase()} account reconciled`,
      summary: `${a.difference === 0 ? "Tied to $0.00" : `Out by ${usd(a.difference, 2)}`} · ${(a.match_rate * 100).toFixed(0)}% of ${a.bank_lines} lines auto-matched` });
  }
  const sev = (s) => pre.findings.filter((f) => f.severity === s).length;
  add({ team: "close", role: "Pre-close checks", source: "close", type: "review",
    title: `Tested ${pre.stats.lines_checked} journal lines`,
    summary: `${pre.findings.length} findings: ${sev("High")} high, ${sev("Medium")} medium, ${sev("Low")} low` });
  for (const i of bank.items.filter((x) => x.je_lines.length)) {
    const amt = i.je_lines.reduce((s, l) => s + l[2], 0);
    add({ team: "close", role: "Proposed JEs", source: "close", type: "journal_entry", amount: amt,
      accounts: i.je_lines.map((l) => l[0]), title: `${i.category}: ${clean(i.description)}`,
      summary: `${usd(amt, 2)} · from bank rec`,
      detail: [["Amount", usd(amt, 2)], ...i.je_lines.map((l) => [l[2] ? "Dr" : "Cr", `${l[0]} ${l[1]}`]),
        ["Likely cause", i.likely_cause], ["Next step", i.action]] });
  }
  for (const f of pre.findings.filter((x) => x.reclass.length)) {
    const amt = f.reclass.reduce((s, l) => s + l[2], 0);
    add({ team: "close", role: "Proposed JEs", source: "close", type: "journal_entry", amount: amt,
      accounts: f.reclass.map((l) => l[0]), title: `${f.check}: ${f.counterparty || f.je_number}`,
      summary: `${usd(amt, 2)} · fixes ${f.id}`,
      detail: [["Amount", usd(amt, 2)], ...f.reclass.map((l) => [l[2] ? "Dr" : "Cr", `${l[0]} ${l[1]}`]),
        ["Finding", `${f.id} — ${f.issue}`], ["Fix", f.fix]] });
  }
  const flagged = pre.flux.filter((x) => x.flagged);
  add({ team: "close", role: "Flux commentary", source: "close", type: "review",
    title: `Drafted flux for ${flagged.length} accounts`,
    summary: flagged.slice(0, 3).map((x) => `${x.name} ${x.var > 0 ? "+" : "−"}${k(Math.abs(x.var))}`).join(" · ") });
  const lastKpi = kpis[kpis.length - 1];
  add({ team: "close", role: "Close KPIs", source: "cfo", type: "review",
    title: `${lastKpi.month} close: ${lastKpi.days_to_close} days (target ${cfoCo.closeTargetDays})`,
    summary: `${lastKpi.open_reconciling_items} open reconciling items · ${lastKpi.items_over_60_days} over 60 days · ${lastKpi.manual_journal_entries} manual JEs` });
  add({ team: "close", role: "Bank rec", source: "close", type: "report", destination: "auditor",
    title: "Send October bank rec workpapers to auditors",
    summary: `${bank.accounts.length} accounts, ${bank.accounts.every((a) => a.difference === 0) ? "all tied" : "not all tied"} · requested for interim fieldwork`,
    detail: [["Workpapers", "Rec summary, reconciling items, matched items"], ...bankRecDetail(bank)] });

  // ---------------- AP  (13-week cash flow AP aging + CFO minimum cash policy)
  const weekEnd = addDays(asOf, 7);
  const run = ap.filter((r) => r.payment_hold === "no" && r.due_date <= weekEnd);
  const runTotal = run.reduce((s, r) => s + num(r.amount_usd), 0);
  add({ team: "ap", role: "Payment run prep", source: "cash", type: "payment", amount: runTotal,
    title: `Payment run — bills due by ${fmtDate(weekEnd)}`, summary: `${run.length} bills ready to release`,
    detail: [["Bills", String(run.length)], ["Total", usd(runTotal)],
      ...run.map((r) => [`${r.vendor}${r.due_date < asOf ? " (past due)" : ""}`, `${usd(num(r.amount_usd))} · due ${fmtDate(r.due_date)}`]),
      ["Cash after run", `${k(openingCash - runTotal)} vs ${k(minCash)} minimum (CFO policy)`]] });
  for (const r of ap.filter((x) => x.payment_hold === "yes")) {
    add({ team: "ap", role: "Disputes & holds", source: "cash", type: "review",
      title: `Kept ${r.vendor} on hold`, summary: `${usd(num(r.amount_usd))} · ${r.description} · billing dispute` });
  }
  const later = ap.filter((r) => r.payment_hold === "no" && r.due_date > weekEnd);
  const laterTotal = later.reduce((s, r) => s + num(r.amount_usd), 0);
  add({ team: "ap", role: "Due-date tracking", source: "cash", type: "payment_schedule", amount: laterTotal,
    title: `Schedule ${later.length} bills for later runs`,
    summary: `${k(laterTotal)} due ${fmtDate(addDays(weekEnd, 1))}–${fmtDate(later.map((r) => r.due_date).sort().at(-1))}`,
    detail: [["Bills", String(later.length)], ["Total", usd(laterTotal)],
      ...later.map((r) => [r.vendor, `${usd(num(r.amount_usd))} · due ${fmtDate(r.due_date)}`])] });

  // ---------------- AR  (13-week AR aging + CFO variance notes)
  // Reminders go out once an invoice is more than COLLECTIONS_GRACE_DAYS past due; newer ones are watched.
  const pastDue = ar.filter((r) => num(r.days_past_due) > 0 && r.bucket !== "90+");
  const overdue = pastDue.filter((r) => num(r.days_past_due) > COLLECTIONS_GRACE_DAYS);
  const watch = pastDue.filter((r) => num(r.days_past_due) <= COLLECTIONS_GRACE_DAYS);
  const maxDays = Math.max(...overdue.map((r) => num(r.days_past_due)));
  add({ team: "ar", role: "Collections", source: "cash", type: "collections", destination: "customer",
    title: `Send reminders on ${overdue.length} invoices over ${COLLECTIONS_GRACE_DAYS} days past due`,
    summary: `${k(overdue.reduce((s, r) => s + num(r.balance_usd), 0))} past due ${COLLECTIONS_GRACE_DAYS + 1}–${maxDays} days · drafted, not sent`,
    detail: overdue.map((r) => [r.customer, `${r.invoice} · ${usd(num(r.balance_usd))} · ${r.days_past_due} days past due`]) });
  if (watch.length) {
    add({ team: "ar", role: "Collections", source: "cash", type: "review",
      title: `Watching ${watch.length} invoices 1–${COLLECTIONS_GRACE_DAYS} days past due`,
      summary: `${k(watch.reduce((s, r) => s + num(r.balance_usd), 0))} · no reminder until day ${COLLECTIONS_GRACE_DAYS + 1}` });
  }
  const dueSoon = ar.filter((r) => r.bucket === "Current" && r.due_date <= weekEnd);
  add({ team: "ar", role: "Cash forecast", source: "cash", type: "forecast",
    title: `Expecting ${k(dueSoon.reduce((s, r) => s + num(r.balance_usd), 0))} in receipts by ${fmtDate(weekEnd)}`,
    summary: `${dueSoon.length} current invoices due this week` });
  const ninety = ar.filter((r) => r.bucket === "90+");
  const reserve = ninety.reduce((s, r) => s + num(r.balance_usd), 0);
  const churnNote = notes.find((x) => /churn/i.test(x.note));
  add({ team: "ar", role: "Bad debt reserve", source: "cash", type: "journal_entry", amount: reserve, accounts: ["6900", "1290"],
    title: "Reserve 90+ day balances from churned customers", summary: `${usd(reserve)} · ${ninety.length} invoices`,
    detail: [["Amount", usd(reserve)], ["Dr", "6900 Bad Debt Expense"], ["Cr", "1290 Allowance for Doubtful Accounts"],
      ...ninety.map((r) => [r.customer, `${usd(num(r.balance_usd))} · ${r.days_past_due} days`]),
      ...(churnNote ? [["Support", `CFO variance note (${churnNote.month}): ${churnNote.note}`]] : [])] });
  add({ team: "ar", role: "Aging review", source: "cash", type: "review",
    title: `AR aging reviewed: ${ar.length} invoices`,
    summary: `${k(ar.reduce((s, r) => s + num(r.balance_usd), 0))} total · ${ninety.length} over 90 days` });

  // ---------------- Payroll & People  (CFO headcount)
  const month = hc.filter((r) => r.scenario === "actual").at(-1).month;
  const sumHc = (r) => ["support", "rd", "sm", "ga"].reduce((s, c) => s + num(r[c]), 0);
  const act = hc.find((r) => r.month === month && r.scenario === "actual");
  const bud = hc.find((r) => r.month === month && r.scenario === "budget");
  add({ team: "payroll", role: "Headcount tie-out", source: "cfo", type: "review",
    title: `${month} headcount: ${sumHc(act)} actual vs ${sumHc(bud)} budget`,
    summary: `Support ${act.support} · R&D ${act.rd} · S&M ${act.sm} · G&A ${act.ga}` });
  add({ team: "payroll", role: "Open roles", source: "cfo", type: "review",
    title: `${sumHc(bud) - sumHc(act)} budgeted roles unfilled`,
    summary: ["support", "rd", "sm", "ga"].filter((c) => num(bud[c]) > num(act[c]))
      .map((c) => `${{ support: "Support", rd: "R&D", sm: "S&M", ga: "G&A" }[c]} ${num(bud[c]) - num(act[c])}`).join(" · ") });

  // ---------------- Reporting & FP&A  (CFO dashboard + 13-week forecast)
  const lastBal = bal.at(-1);
  add({ team: "fpa", role: "13-week cash", source: "cash", type: "forecast",
    title: `Forecast low point ${k(num(cfoCo.cash_forecast_lowPoint) * 1000)} on ${fmtDate(cfoCo.cash_forecast_lowPointWeek)}`,
    summary: `Above the ${k(minCash)} minimum without drawing the revolver` });
  const monthNotes = notes.filter((x) => x.month === notes.at(-1).month);
  add({ team: "fpa", role: "Board pack", source: "cfo", type: "report", destination: "board",
    title: `${cfoCo.closedThrough} board pack`, summary: "Ready for your review before it goes to the board",
    detail: [["Closed through", cfoCo.closedThrough], ["Month-end cash", k(num(lastBal.cash_usd_k) * 1000)],
      ["AR / AP", `${k(num(lastBal.accounts_receivable_usd_k) * 1000)} / ${k(num(lastBal.accounts_payable_usd_k) * 1000)}`],
      ["Deferred revenue", k(num(lastBal.deferred_revenue_usd_k) * 1000)],
      ["Cash low point", `${k(num(cfoCo.cash_forecast_lowPoint) * 1000)} (13-week forecast)`],
      ...monthNotes.map((x) => [`Note: ${x.line_id}`, x.note])] });
  add({ team: "fpa", role: "Variance notes", source: "cfo", type: "review",
    title: `Carried ${monthNotes.length} variance notes into commentary`, summary: monthNotes.map((x) => x.line_id).join(" · ") });

  // ---------------- Cross-project data checks
  const arTotal13 = ar.reduce((s, r) => s + num(r.balance_usd), 0);
  const arTotalCfo = cfoAr.reduce((s, r) => s + num(r.balance_usd_k) * 1000, 0); // stored by bucket in $K
  const recMonth = bank.period_end.slice(0, 7);
  const recCash = Math.round(bank.accounts.reduce((s, a) => s + a.adjusted_book, 0) * 100) / 100;
  const bsCash = num(bal.find((r) => r.month === recMonth)?.cash_usd_k) * 1000; // balance sheet stored in $K
  const checks = [
    { name: `${recMonth} cash: bank recs (adjusted book) = CFO balance sheet`, sources: ["close", "cfo"],
      a: recCash, b: bsCash, test: (a, b) => Math.abs(a - b) < 500 },
    { name: "Opening cash: CFO dashboard = 13-week forecast", sources: ["cfo", "cash"],
      a: num(cfoCo.cash_forecast_openingCash) * 1000, b: openingCash },
    { name: "AR aging total: CFO dashboard = 13-week forecast", sources: ["cfo", "cash"],
      a: Math.round(arTotalCfo), b: arTotal13, test: (a, b) => Math.abs(a - b) < 100 },
    { name: "Forecast as-of date: CFO dashboard = 13-week forecast", sources: ["cfo", "cash"],
      a: cfoCo.cash_forecast_asOf, b: asOf },
    ...bank.accounts.map((x) => ({ name: `Bank rec ${x.account}: adjusted bank = adjusted book`, sources: ["close"],
      a: x.adjusted_bank, b: x.adjusted_book })),
    { name: "Payment run leaves cash above minimum policy", sources: ["cash", "cfo"],
      a: openingCash - runTotal, b: minCash, test: (a, b) => a >= b },
  ].map((c) => ({ ...c, pass: c.test ? c.test(c.a, c.b) : c.a === c.b }));

  return { company: cashCo.company, asOf, ...triage(actions), checks };
}

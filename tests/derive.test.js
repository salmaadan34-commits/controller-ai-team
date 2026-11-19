import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWeek, TEAMS } from "../src/derive.js";
import { parseCsv } from "../src/csv.js";

const linked = JSON.parse(readFileSync(new URL("../data/linked.json", import.meta.url)));
const week = buildWeek(linked);
const all = [...week.done, ...week.held];

test("every action names a team, a role on that team and a connected source", () => {
  for (const a of all) {
    const team = TEAMS.find((t) => t.id === a.team);
    assert.ok(team, a.id);
    assert.ok(team.roles.includes(a.role), `${a.id} role ${a.role}`);
    assert.ok(linked.sources[a.source], `${a.id} source ${a.source}`);
  }
});

test("payment run equals the 13-week AP aging bills due within 7 days, not on hold", () => {
  const ap = linked.sources.cash.files["data/ap_aging.csv"];
  const asOf = week.asOf;
  const end = new Date(Date.parse(asOf) + 7 * 864e5).toISOString().slice(0, 10);
  const expected = ap.filter((r) => r.payment_hold === "no" && r.due_date <= end).reduce((s, r) => s + Number(r.amount_usd), 0);
  const run = week.held.find((a) => a.type === "payment");
  assert.equal(run.amount, expected);
});

test("bank rec actions come straight from the close agent's summary", () => {
  const bank = linked.sources.close.files["examples/bank_rec_summary_2026-10.json"];
  assert.equal(all.filter((a) => a.role === "Bank rec" && a.type === "reconciliation").length, bank.accounts.length);
});

test("every proposed JE is done only if under $9,000 and outside revenue (rules 3 and 7)", () => {
  for (const a of all.filter((x) => x.type === "journal_entry")) {
    const held = week.held.includes(a);
    assert.equal(held, a.amount >= 9000 || a.accounts.some((x) => /^4[01]\d\d$/.test(x)), a.title);
  }
});

test("nothing that contacts customers or commits cash is done without the controller", () => {
  for (const a of week.done) {
    assert.notEqual(a.destination, "customer", a.title);
    assert.ok(!["payment", "payment_schedule"].includes(a.type), a.title);
  }
});

test("all cross-project checks pass on the current snapshot", () => {
  for (const c of week.checks) assert.ok(c.pass, `${c.name}: ${c.a} vs ${c.b}`);
});

test("csv parser handles quoted commas", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [{ a: "x, y", b: "2" }]);
});

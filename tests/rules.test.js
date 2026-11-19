import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, isRevenueAccount } from "../src/rules.js";

test("tax filings are always held (rule 1)", () => {
  assert.deepEqual(evaluate({ type: "filing", destination: "tax_authority", amount: 5 }).rules.map((r) => r.id), [1]);
});
test("payments are always held (rule 2), whatever the amount", () => {
  assert.equal(evaluate({ type: "payment", amount: 1 }).held, true);
});
test("JEs well under the limit and outside revenue run on their own", () => {
  assert.equal(evaluate({ type: "journal_entry", amount: 8999.99, accounts: ["6420", "1010"] }).held, false);
});
test("JEs just under the limit are held (rule 7)", () => {
  assert.deepEqual(evaluate({ type: "journal_entry", amount: 9500, accounts: ["6100", "2100"] }).rules.map((r) => r.id), [7]);
  assert.deepEqual(evaluate({ type: "journal_entry", amount: 9999.99, accounts: ["6420", "1010"] }).rules.map((r) => r.id), [7]);
});
test("scheduling future payments is held (rule 2)", () => {
  assert.deepEqual(evaluate({ type: "payment_schedule", amount: 1 }).rules.map((r) => r.id), [2]);
});
test("anything sent to customers is held (rule 6)", () => {
  assert.deepEqual(evaluate({ type: "collections", destination: "customer" }).rules.map((r) => r.id), [6]);
});
test("JEs at the limit are held (rule 3)", () => {
  assert.equal(evaluate({ type: "journal_entry", amount: 10000, accounts: ["6420", "1010"] }).held, true);
});
test("any JE touching revenue is held, even $1", () => {
  assert.equal(evaluate({ type: "journal_entry", amount: 1, accounts: ["4000", "1200"] }).held, true);
});
test("interest income (4900) is not revenue", () => {
  assert.equal(isRevenueAccount("4900"), false);
  assert.equal(evaluate({ type: "journal_entry", amount: 212.37, accounts: ["1010", "4900"] }).held, false);
});
test("auditor and board deliverables are held (rule 4)", () => {
  assert.equal(evaluate({ type: "report", destination: "board" }).rules[0].id, 4);
  assert.equal(evaluate({ type: "report", destination: "auditor" }).rules[0].id, 4);
});
test("vendor bank changes are held (rule 5)", () => {
  assert.equal(evaluate({ type: "master_data" }).rules[0].id, 5);
});
test("an action can trigger more than one rule", () => {
  assert.deepEqual(evaluate({ type: "payment", destination: "tax_authority" }).rules.map((r) => r.id), [1, 2]);
});

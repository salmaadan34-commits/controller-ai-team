// Pulls the latest outputs from the connected projects and writes data/linked.json.
//
//   node scripts/sync.mjs                         # fetch from GitHub (main branch)
//   node scripts/sync.mjs --local close=../month-end-close-agent cash=../13-week-cash-flow cfo=../cfo-control-center
//
// Runs daily in GitHub Actions (.github/workflows/sync.yml), so the hub always shows what
// the other projects currently produce.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/csv.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "salmaadan34-commits";

export const SOURCES = {
  close: {
    repo: `${OWNER}/month-end-close-agent`,
    label: "Month-End Close Agent",
    files: ["examples/bank_rec_summary_2026-10.json", "examples/preclose_summary_2026-10.json"],
  },
  cash: {
    repo: `${OWNER}/13-week-cash-flow`,
    label: "13-Week Cash Flow Forecast",
    demo: `https://${OWNER}.github.io/13-week-cash-flow/`,
    files: ["data/company.csv", "data/ap_aging.csv", "data/ar_aging.csv"],
  },
  cfo: {
    repo: `${OWNER}/cfo-control-center`,
    label: "CFO Control Center",
    demo: `https://${OWNER}.github.io/cfo-control-center/`,
    files: ["data/company.csv", "data/close_kpis.csv", "data/headcount.csv", "data/balances.csv",
            "data/variance_notes.csv", "data/ar_aging_nov13.csv"],
  },
};

const parse = (name, text) => (name.endsWith(".json") ? JSON.parse(text) : parseCsv(text));

async function fromGitHub(key, src) {
  const res = await fetch(`https://api.github.com/repos/${src.repo}/commits/main`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "controller-ai-team-sync" },
  });
  if (!res.ok) throw new Error(`${src.repo}: ${res.status} reading latest commit`);
  const commit = (await res.json()).sha;
  const files = {};
  for (const f of src.files) {
    const r = await fetch(`https://raw.githubusercontent.com/${src.repo}/${commit}/${f}`);
    if (!r.ok) throw new Error(`${src.repo}/${f}: ${r.status}`);
    files[f] = parse(f, await r.text());
  }
  return { commit, files };
}

function fromLocal(path, src) {
  const commit = execSync("git rev-parse HEAD", { cwd: path }).toString().trim();
  const files = {};
  for (const f of src.files) files[f] = parse(f, readFileSync(join(path, f), "utf8"));
  return { commit, files };
}

async function main() {
  const args = process.argv.slice(2);
  const local = {};
  if (args[0] === "--local") for (const kv of args.slice(1)) { const [k, v] = kv.split("="); local[k] = resolve(v); }

  const out = { synced_at: new Date().toISOString(), sources: {} };
  for (const [key, src] of Object.entries(SOURCES)) {
    const got = local[key] ? fromLocal(local[key], src) : await fromGitHub(key, src);
    out.sources[key] = { repo: src.repo, label: src.label, demo: src.demo ?? null, ...got };
    console.log(`  ${key.padEnd(6)} ${src.repo} @ ${got.commit.slice(0, 7)} (${src.files.length} files)`);
  }
  mkdirSync(join(ROOT, "data"), { recursive: true });
  writeFileSync(join(ROOT, "data", "linked.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("Wrote data/linked.json");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

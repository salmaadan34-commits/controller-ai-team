# Controller AI Team

A hub for a controller's AI team. Agents in six teams do the week's finance work, and **one rulebook** decides what they may finish on their own and what waits for the controller. Every number comes from three other projects, so this dashboard only works because they do.

**Live demo:** [salmaadan34-commits.github.io/controller-ai-team](https://salmaadan34-commits.github.io/controller-ai-team/)

## How the projects connect

```
month-end-close-agent ──┐  bank rec + pre-close JSON summaries
13-week-cash-flow ──────┼─► scripts/sync.mjs ─► data/linked.json ─► rulebook ─► done / held for you
cfo-control-center ─────┘  company, close KPIs, headcount, balances, variance notes, AR aging
```

| Team | Fed by | What the agents produce |
|---|---|---|
| Close | [Month-End Close Agent](https://github.com/salmaadan34-commits/month-end-close-agent), [CFO Control Center](https://github.com/salmaadan34-commits/cfo-control-center) | Bank recs, pre-close test results, proposed JEs from both modules, flux, close KPIs, auditor workpapers |
| AP & Spend | [13-Week Cash Flow](https://github.com/salmaadan34-commits/13-week-cash-flow) + CFO minimum-cash policy | This week's payment run (bills due within 7 days, not on hold), disputes, upcoming runs |
| AR & Revenue | 13-Week Cash Flow + CFO variance notes | Collections, expected receipts, a bad-debt reserve for 90+ day balances backed by the CFO churn note |
| Payroll & People | CFO Control Center | Headcount actual vs budget, open roles by department |
| Reporting & FP&A | CFO Control Center + 13-Week Cash Flow | Board pack, forecast low point, variance notes |
| Tax & Compliance | none yet | Shown as unconnected, nothing invented |

Nothing on the page is typed in by hand. Each action names the project and commit it came from.

## The rulebook

All agent actions go through `evaluate()` in [`src/rules.js`](src/rules.js). These five things always need the controller:

1. Anything to the IRS or a state
2. Releasing cash
3. Journal entries of $10,000 or more, or anything touching revenue (4000–4199)
4. Anything to auditors or the board
5. Vendor or bank master-data changes

On the current data, 23 jobs finish on their own and 7 are held. The held items are a $229K payment run, the board pack, auditor workpapers, a $78K bad-debt reserve and three proposed JEs over the limit. Each one opens to a review panel with the rule it triggered, the supporting detail and its source. You can approve it or send it back.

## Cross-project checks

The hub also checks that the projects agree with each other:

- October cash: bank recs (adjusted book, all accounts) = CFO balance sheet ($4,995,000)
- Opening cash: CFO dashboard = 13-week forecast
- AR aging total: CFO dashboard = 13-week forecast ($3,384,950)
- Forecast as-of date matches
- Each bank rec ties (adjusted bank = adjusted book)
- This week's payment run leaves cash above the CFO's minimum-cash policy

If a change in one project breaks another, a check fails and the daily sync shows it.

## Run it

```bash
npm run sync      # pull the latest outputs from the three projects into data/linked.json
npm test          # 15 tests: rulebook, derivations, cross-project checks
npm start         # serve locally
```

A GitHub Actions job ([`.github/workflows/sync.yml`](.github/workflows/sync.yml)) runs the sync and the tests every day, and commits the new snapshot only if the tests pass.

## Project structure

```
index.html          page shell
src/rules.js        the rulebook: evaluate() and triage()
src/derive.js       turns connected-project data into actions and checks
src/app.js          rendering, filters, review panel, approve / send back
src/csv.js          small CSV parser
scripts/sync.mjs    pulls source files from GitHub (or local clones with --local)
data/linked.json    latest synced snapshot
tests/              node --test suites
```

## Limits

- The close agent's bank rec ties to Halden's October cash across operating, payroll and the money market reserve. Its pre-close checks and flux still run on their own sample GL; moving those onto Halden's books is next.
- Approve and send back are recorded in the page only. The hub never posts, files or pays.

All data is synthetic.

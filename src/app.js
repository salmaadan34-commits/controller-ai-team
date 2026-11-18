import { RULES } from "./rules.js";
import { TEAMS, buildWeek } from "./derive.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (x) => (x == null ? "" : `$${Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
// Live demo when the project has one, otherwise its repo.
const srcUrl = (s) => s.demo || `https://github.com/${s.repo}`;
const teamName = (id) => TEAMS.find((t) => t.id === id)?.name ?? id;

const state = { filter: null, decisions: [], week: null, linked: null };

async function load() {
  try {
    const res = await fetch("data/linked.json", { cache: "no-store" });
    state.linked = await res.json();
    state.week = buildWeek(state.linked);
    render();
  } catch (e) {
    document.querySelector(".main").innerHTML =
      `<div class="panel"><h2>Couldn't load data/linked.json</h2><p class="muted">${esc(e.message)}. Run <code>npm run sync</code>, then serve the folder.</p></div>`;
  }
}

function render() {
  const w = state.week, L = state.linked;
  const open = w.held.filter((h) => !state.decisions.some((d) => d.id === h.id));
  $("company").textContent = w.company;
  $("week").textContent = `Week of ${new Date(w.asOf + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

  const stats = [[TEAMS.length, "Teams"], [TEAMS.reduce((s, t) => s + t.roles.length, 0), "Roles"],
    [w.done.length + state.decisions.filter((d) => d.ok).length, "Jobs done"], [open.length, "Held for you", "warm"]];
  $("stats").innerHTML = stats.map(([v, l, c]) => `<div class="stat ${c ?? ""}"><b>${v}</b><span>${l}</span></div>`).join("");

  $("rules").innerHTML = RULES.map((r) => {
    const c = open.filter((h) => h.rules.some((x) => x.id === r.id)).length;
    return `<li title="${esc(r.why)}"><i>${r.id}</i><span>${esc(r.name)}</span>${c ? `<em>${c}</em>` : ""}</li>`;
  }).join("");

  $("teamlist").innerHTML = TEAMS.map((t) => {
    const jobs = [...w.done, ...w.held].filter((a) => a.team === t.id).length;
    return `<li><button data-team="${t.id}" class="${state.filter === t.id ? "on" : ""}"><i class="${jobs ? "live" : ""}"></i>${esc(t.name)}<small>${jobs}</small></button></li>`;
  }).join("");

  $("sources").innerHTML = Object.entries(L.sources).map(([k, s]) =>
    `<li><a href="${srcUrl(s)}" target="_blank" rel="noopener"><span class="src ${k}">${esc(s.label)}</span></a><small>@ ${s.commit.slice(0, 7)}</small></li>`).join("") +
    `<li class="muted small">Synced ${new Date(L.synced_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</li>`;

  $("teams").innerHTML = TEAMS.map((t, i) => {
    const mine = [...w.done, ...w.held].filter((a) => a.team === t.id);
    const heldRoles = new Set(open.filter((h) => h.team === t.id).map((h) => h.role));
    const doneRoles = new Set(mine.map((a) => a.role));
    const srcs = [...new Set(mine.map((a) => a.source))];
    return `<article class="team ${state.filter === t.id ? "sel" : ""} ${mine.length ? "" : "idle"}" data-team="${t.id}" tabindex="0">
      <span class="num">${i + 1}</span>
      <h3>${esc(t.name)}</h3>
      <p class="sub">${mine.length ? `${mine.length} jobs this week` : "No connected source yet"}</p>
      <ul>${t.roles.map((r) => `<li class="${heldRoles.has(r) ? "held" : doneRoles.has(r) ? "done" : ""}">${esc(r)}</li>`).join("")}</ul>
      <div class="srcs">${srcs.map((s) => `<span class="src ${s}">${esc(L.sources[s].label)}</span>`).join("")}</div>
    </article>`;
  }).join("");

  const heldShown = open.filter((h) => !state.filter || h.team === state.filter);
  $("heldCount").textContent = `${open.length} waiting`;
  $("held").innerHTML = heldShown.length ? heldShown.map((h) => `
    <article class="hcard">
      <div class="mono">${esc(teamName(h.team))} · ${esc(h.role)}</div>
      <h4>${esc(h.title)}</h4>
      <div class="lock">Held for a person</div>
      ${h.rules.map((r) => `<div class="rule">Rule ${r.id}: ${esc(r.name)}</div>`).join("")}
      <div class="row"><span>${esc(h.summary)}</span><b>${money(h.amount)}</b></div>
      <button class="btn small" data-review="${h.id}">Review</button>
    </article>`).join("") : `<p class="muted">Nothing waiting${state.filter ? " for this team" : ""}. Agents are within the rulebook.</p>`;

  const feed = w.done.filter((a) => !state.filter || a.team === state.filter);
  $("filterNote").innerHTML = state.filter ? `${esc(teamName(state.filter))} · <a href="#" id="clear">show all</a>` : `${feed.length} jobs`;
  $("feed").innerHTML = feed.map((a) => `<li><i class="tick"></i><div><b>${esc(a.title)}</b><span>${esc(a.summary)}</span>
      <small>${esc(teamName(a.team))} · ${esc(a.role)} · <span class="src ${a.source}">${esc(L.sources[a.source].label)}</span></small></div></li>`).join("");

  const pass = w.checks.filter((c) => c.pass).length;
  $("checkCount").textContent = `${pass}/${w.checks.length} pass`;
  $("checkCount").className = `pill ${pass === w.checks.length ? "good" : "warm"}`;
  $("checks").innerHTML = w.checks.map((c) => `<li class="${c.pass ? "pass" : "fail"}"><i>${c.pass ? "✓" : "!"}</i><div><b>${esc(c.name)}</b>
      <small>${fmt(c.a)} vs ${fmt(c.b)} · ${c.sources.map((s) => `<span class="src ${s}">${esc(L.sources[s].label)}</span>`).join(" ")}</small></div></li>`).join("");

  if (state.decisions.length) {
    $("log").innerHTML = state.decisions.slice().reverse().map((d) => `<li><b class="${d.ok ? "ok" : "back"}">${d.ok ? "Approved" : "Sent back"}</b> ${esc(d.title)}<small>${d.at}</small></li>`).join("");
  }
}

const fmt = (v) => (typeof v === "number" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : esc(v));

function openDrawer(id) {
  const h = state.week.held.find((x) => x.id === id);
  if (!h) return;
  $("dTeam").textContent = `${teamName(h.team)} · ${h.role}`;
  $("dTitle").textContent = h.title;
  $("dRules").innerHTML = h.rules.map((r) => `<div class="rule">Rule ${r.id}: ${esc(r.name)}<small>${esc(r.why)}</small></div>`).join("");
  $("dDetail").innerHTML = (h.detail ?? [["Summary", h.summary]]).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  const s = state.linked.sources[h.source];
  $("dSrc").innerHTML = `Source: <a href="${srcUrl(s)}" target="_blank" rel="noopener">${esc(s.label)}</a> @ ${s.commit.slice(0, 7)}`;
  $("drawer").hidden = false;
  $("drawer").dataset.id = id;
  $("dOk").focus();
}

function decide(ok) {
  const id = $("drawer").dataset.id;
  const h = state.week.held.find((x) => x.id === id);
  state.decisions.push({ id, ok, title: h.title, at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) });
  $("drawer").hidden = true;
  render();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-team]");
  if (e.target.closest("[data-review]")) return openDrawer(e.target.closest("[data-review]").dataset.review);
  if (e.target.id === "clear") { e.preventDefault(); state.filter = null; return render(); }
  if (t) { state.filter = state.filter === t.dataset.team ? null : t.dataset.team; return render(); }
  if (e.target.id === "drawer" || e.target.id === "dClose") $("drawer").hidden = true;
  if (e.target.id === "dOk") decide(true);
  if (e.target.id === "dBack") decide(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("drawer").hidden = true;
  if (e.key === "Enter" && e.target.classList?.contains("team")) e.target.click();
});

load();

/* WantPrompt — prompt library + built-in free AI + agent mode */
const state = { prompts: [], cat: "All", q: "", favsOnly: false, favs: new Set(), openId: null, tab: "prompt" };
const $ = id => document.getElementById(id);
const grid = $("grid"), catsEl = $("cats");

/* ---------- favorites ---------- */
function loadFavs() { try { state.favs = new Set(JSON.parse(localStorage.getItem("wp_favs") || "[]")); } catch (e) {} }
function saveFavs() { localStorage.setItem("wp_favs", JSON.stringify([...state.favs])); }
function updateFavCount() { $("favCount").textContent = state.favs.size; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

/* ---------- free AI backend ---------- */
async function aiChat(messages, attempt) {
  attempt = attempt || 1;
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai-fast", messages, private: true })
  });
  if (!res.ok) throw new Error("status " + res.status);
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content && attempt < 3) {
    await new Promise(r => setTimeout(r, 1500));
    return aiChat(messages, attempt + 1);
  }
  if (!content) throw new Error("empty response");
  return content.trim();
}
function aiErrorHTML(err) {
  return "⚠️ The free AI is busy or unreachable right now (" + esc(err.message || "error") + "). " +
    "Wait a minute and try again — or copy the prompt and run it in ChatGPT / Claude / Gemini instead.";
}

/* ---------- variables ---------- */
function varsIn(text) {
  const out = []; const re = /\[([A-Z][A-Z0-9 _-]{1,40})\]/g; let m;
  while ((m = re.exec(text))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
function currentValues(p) {
  const values = {};
  const names = varsIn(p.prompt);
  $("modalVars").querySelectorAll(".var-field").forEach((w, i) => { values[names[i]] = w.querySelector("input").value; });
  return values;
}
function fillVars(p, values) {
  let t = p.prompt;
  varsIn(p.prompt).forEach(v => {
    const val = (values[v] || "").trim() || "[" + v + "]";
    t = t.split("[" + v + "]").join(val);
  });
  return t;
}
function getPrompt() { return state.prompts.find(x => x.id === state.openId); }

/* ---------- categories / grid ---------- */
function renderCats() {
  const cats = ["All", ...new Set(state.prompts.map(p => p.category))];
  catsEl.innerHTML = "";
  cats.forEach(c => {
    const b = document.createElement("button");
    b.className = "cat" + (state.cat === c ? " active" : "");
    b.textContent = c + (c === "All" ? "" : " · " + state.prompts.filter(p => p.category === c).length);
    b.onclick = () => { state.cat = c; state.favsOnly = false; render(); };
    catsEl.appendChild(b);
  });
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.prompts.filter(p => {
    if (state.favsOnly && !state.favs.has(p.id)) return false;
    if (state.cat !== "All" && p.category !== state.cat) return false;
    if (q && !(p.title + " " + p.desc + " " + p.prompt).toLowerCase().includes(q)) return false;
    return true;
  });
}
function render() {
  renderCats();
  const list = filtered();
  grid.innerHTML = "";
  $("empty").hidden = list.length > 0;
  $("resultCount").textContent = list.length + " prompt" + (list.length === 1 ? "" : "s");
  $("activeFilter").textContent = state.favsOnly ? "· ♥ favorites" : (state.cat !== "All" ? "· " + state.cat : "");
  list.forEach(p => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="card-top"><span class="badge">' + esc(p.category) + '</span>' +
      '<button class="fav' + (state.favs.has(p.id) ? " active" : "") + '" aria-label="Save">' +
      (state.favs.has(p.id) ? "♥" : "♡") + "</button></div>" +
      "<h3>" + esc(p.title) + "</h3><p>" + esc(p.desc) + "</p>" +
      '<div class="card-foot"><button class="mini-try">▶ Try</button><button class="mini-copy">📋 Copy</button></div>';
    card.querySelector(".fav").onclick = e => { e.stopPropagation(); toggleFav(p.id); };
    card.querySelector(".mini-copy").onclick = e => { e.stopPropagation(); copyText(fillVars(p, {}), e.target); };
    card.querySelector(".mini-try").onclick = e => { e.stopPropagation(); openModal(p.id, "run"); };
    card.onclick = () => openModal(p.id, "prompt");
    grid.appendChild(card);
  });
}
function toggleFav(id) {
  state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
  saveFavs(); updateFavCount(); render();
  if (state.openId === id) syncModalFav();
}

/* ---------- modal + tabs ---------- */
function setTab(name) {
  state.tab = name;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  ["prompt", "run", "agent"].forEach(n => { $("pane-" + n).hidden = n !== name; });
}
document.querySelectorAll(".tab").forEach(t => { t.onclick = () => setTab(t.dataset.tab); });

function openModal(id, tab) {
  const p = state.prompts.find(x => x.id === id);
  if (!p) return;
  state.openId = id;
  $("modalCat").textContent = p.category;
  $("modalTitle").textContent = p.title;
  $("modalDesc").textContent = p.desc;
  const varsBox = $("modalVars"); varsBox.innerHTML = "";
  varsIn(p.prompt).forEach(v => {
    const wrap = document.createElement("div");
    wrap.className = "var-field";
    wrap.innerHTML = "<label>[" + esc(v) + "]</label>";
    const inp = document.createElement("input");
    inp.placeholder = "Type to customize…";
    inp.oninput = () => { $("modalText").textContent = fillVars(p, currentValues(p)); };
    wrap.appendChild(inp); varsBox.appendChild(wrap);
  });
  $("modalText").textContent = p.prompt;
  $("copiedTip").hidden = true;
  syncModalFav();
  resetRunPane(); resetAgentPane();
  setTab(tab || "prompt");
  $("modalBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
}
function syncModalFav() {
  const b = $("modalFav"), on = state.favs.has(state.openId);
  b.classList.toggle("active", on); b.textContent = on ? "♥" : "♡";
}
function closeModal() { $("modalBackdrop").hidden = true; document.body.style.overflow = ""; state.openId = null; }

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = "✓ Copied"; setTimeout(() => btn.textContent = o, 1400); }
}

/* ---------- Try with AI ---------- */
function resetRunPane() {
  $("runStatus").hidden = true; $("runOutput").hidden = true;
  $("runError").hidden = true; $("runRegen").hidden = true; $("runCopyResp").hidden = true;
  $("runBtn").disabled = false;
}
async function runPrompt() {
  const p = getPrompt(); if (!p) return;
  const filled = fillVars(p, currentValues(p));
  $("runError").hidden = true; $("runOutput").hidden = true;
  $("runStatus").hidden = false; $("runStatusText").textContent = "Thinking…";
  $("runBtn").disabled = true; $("runRegen").hidden = true; $("runCopyResp").hidden = true;
  try {
    const out = await aiChat([
      { role: "system", content: "You are a helpful AI assistant. Follow the user's instructions exactly and completely." },
      { role: "user", content: filled }
    ]);
    $("runOutput").textContent = out; $("runOutput").hidden = false;
    $("runRegen").hidden = false; $("runCopyResp").hidden = false;
  } catch (err) {
    $("runError").innerHTML = aiErrorHTML(err); $("runError").hidden = false;
  }
  $("runStatus").hidden = true; $("runBtn").disabled = false;
}

/* ---------- Agent mode ---------- */
function resetAgentPane() {
  $("agentSteps").innerHTML = ""; $("agentError").hidden = true;
  $("agentCopyFinal").hidden = true; $("agentBtn").disabled = false;
}
function agentStepEl(n, title) {
  const d = document.createElement("div");
  d.className = "agent-step pending";
  d.innerHTML = '<div class="agent-step-head"><span class="agent-num">' + n + '</span><span>' + esc(title) + '</span><span class="agent-state"></span></div><pre class="agent-body" hidden></pre>';
  $("agentSteps").appendChild(d);
  return d;
}
function setStepState(el, st, body) {
  el.className = "agent-step " + st;
  el.querySelector(".agent-state").textContent = st === "working" ? "⏳" : st === "done" ? "✓" : "";
  if (body !== undefined) { const b = el.querySelector(".agent-body"); b.hidden = false; b.textContent = body; }
}
async function runAgent() {
  const p = getPrompt(); if (!p) return;
  resetAgentPane();
  $("agentBtn").disabled = true; $("agentError").hidden = true;
  const filled = fillVars(p, currentValues(p));
  const s1 = agentStepEl(1, "Draft — AI writes a first version");
  const s2 = agentStepEl(2, "Critique — AI finds the weaknesses");
  const s3 = agentStepEl(3, "Polish — AI rewrites using the critique");
  try {
    setStepState(s1, "working");
    const draft = await aiChat([
      { role: "system", content: "You are a helpful AI assistant. Follow the user's instructions exactly and completely." },
      { role: "user", content: filled }
    ]);
    setStepState(s1, "done", draft);

    setStepState(s2, "working");
    const critique = await aiChat([
      { role: "system", content: "You are a ruthless but constructive critic. Find real weaknesses: inaccuracies, vagueness, missing pieces, weak structure. Be specific." },
      { role: "user", content: "Critique this AI-generated output. List the top 3-5 specific weaknesses as bullets. No praise, no fluff:\n\n" + draft }
    ]);
    setStepState(s2, "done", critique);

    setStepState(s3, "working");
    const final = await aiChat([
      { role: "system", content: "You are an expert editor. Rewrite and improve. Output ONLY the improved version — no commentary, no headers about what you changed." },
      { role: "user", content: "Rewrite this draft, fixing every issue in the critique below. Output only the improved version.\n\nDRAFT:\n" + draft + "\n\nCRITIQUE:\n" + critique }
    ]);
    setStepState(s3, "done", final);
    $("agentCopyFinal").hidden = false;
    $("agentCopyFinal").onclick = e => copyText(final, e.target);
  } catch (err) {
    $("agentError").innerHTML = aiErrorHTML(err); $("agentError").hidden = false;
    document.querySelectorAll(".agent-step.working").forEach(el => setStepState(el, "pending"));
  }
  $("agentBtn").disabled = false;
}

/* ---------- prompt of the day ---------- */
function showPotd() {
  if (!state.prompts.length) return;
  const day = Math.floor(Date.now() / 86400000);
  const p = state.prompts[day % state.prompts.length];
  $("potdLink").textContent = p.title + " →";
  $("potdLink").onclick = () => openModal(p.id, "prompt");
  $("potd").hidden = false;
}

/* ---------- wiring ---------- */
$("modalClose").onclick = closeModal;
$("modalBackdrop").onclick = e => { if (e.target === $("modalBackdrop")) closeModal(); };
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("modalBackdrop").hidden) closeModal();
  if (e.key === "/" && document.activeElement !== $("search") && $("modalBackdrop").hidden) { e.preventDefault(); $("search").focus(); }
});
$("modalFav").onclick = () => toggleFav(state.openId);
$("modalCopy").onclick = e => {
  const p = getPrompt();
  copyText(fillVars(p, currentValues(p)), e.target);
  $("copiedTip").hidden = false;
};
$("runBtn").onclick = runPrompt;
$("runRegen").onclick = runPrompt;
$("runCopyResp").onclick = e => copyText($("runOutput").textContent, e.target);
$("agentBtn").onclick = runAgent;
$("search").oninput = e => { state.q = e.target.value; state.favsOnly = false; render(); };
$("clearSearch").onclick = () => { $("search").value = ""; state.q = ""; render(); };
$("homeLink").onclick = e => { e.preventDefault(); state.cat = "All"; state.q = ""; state.favsOnly = false; $("search").value = ""; render(); window.scrollTo(0, 0); };
$("favsBtn").onclick = () => { state.favsOnly = !state.favsOnly; render(); window.scrollTo(0, 0); };
$("randomBtn").onclick = () => {
  const list = filtered();
  if (list.length) openModal(list[Math.floor(Math.random() * list.length)].id, "prompt");
};

fetch("prompts.json")
  .then(r => r.json())
  .then(data => { state.prompts = data; loadFavs(); updateFavCount(); render(); showPotd(); })
  .catch(() => { grid.innerHTML = "<p style='color:var(--muted)'>Couldn't load the prompt library. Try refreshing.</p>"; });

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
// Pollinations' anonymous tier allows roughly 1 request per 15s per IP.
// A 402/429 means the shared free quota is tapped out right now —
// so we throttle client-side and retry with backoff instead of failing fast.
const AI_MIN_GAP = 15000;                    // ms between AI calls
const AI_RETRY_DELAYS = [12000, 20000, 30000]; // backoff between retries
let lastAiAt = 0;

function aiWait(ms, onStatus, label) {
  return new Promise(resolve => {
    let left = Math.ceil(ms / 1000);
    if (onStatus) onStatus(label + " (" + left + "s)…");
    const iv = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(iv); resolve(); }
      else if (onStatus) onStatus(label + " (" + left + "s)…");
    }, 1000);
  });
}

async function aiChatStream(messages, onToken) {
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai-fast", messages, private: true, stream: true })
  });
  if (res.status === 402 || res.status === 429 || res.status >= 500) throw new Error("busy");
  if (!res.ok) throw new Error("hard:" + res.status);
  if (!res.body || typeof res.body.getReader !== "function") throw new Error("nostream");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of block.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const c = j && j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (c) { out += c; if (onToken) onToken(out); }
        } catch (e) { /* ignore partial SSE lines */ }
      }
    }
  }
  return out.trim();
}

async function aiChatOnce(messages, onToken) {
  try {
    const out = await aiChatStream(messages, onToken);
    if (out) return out;
    // Stream ended with no content — fall through to non-streaming.
  } catch (err) {
    if (err.message !== "nostream") throw err;
    // No streaming support — fall through to non-streaming.
  }
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai-fast", messages, private: true })
  });
  if (res.status === 402 || res.status === 429 || res.status >= 500) throw new Error("busy");
  if (!res.ok) throw new Error("hard:" + res.status);
  const data = await res.json();
  const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return c ? c.trim() : "";
}

async function aiChat(messages, onStatus, onToken) {
  // Stay inside the free tier's rate limit instead of hammering it.
  const gap = AI_MIN_GAP - (Date.now() - lastAiAt);
  if (gap > 0) await aiWait(gap, onStatus, "Waiting for the free AI");
  let lastErr = new Error("unreachable");
  for (let attempt = 0; ; attempt++) {
    try {
      lastAiAt = Date.now();
      const out = await aiChatOnce(messages, onToken);
      if (out) return out;
      throw new Error("busy");
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof TypeError || err.message === "busy";
      if (retryable && attempt < AI_RETRY_DELAYS.length) {
        await aiWait(AI_RETRY_DELAYS[attempt], onStatus, "Free AI is busy, retrying");
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
function aiErrorHTML() {
  return "⚠️ The free AI stayed busy after several tries. " +
    "Wait a minute and tap Run again — or copy the prompt and run it in ChatGPT / Claude / Gemini instead.";
}

/* ---------- variables ---------- */
function varsIn(text) {
  const out = []; const re = /\[([^\[\]\n]{1,80})\]/g; let m;
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
    b.onclick = () => { state.cat = c; state.favsOnly = false; state.q = ""; $("search").value = ""; render(); window.scrollTo(0, 0); };
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
  if (name === "run" && state.openId) {
    const p = getPrompt();
    if (p) $("runPromptPreview").textContent = fillVars(p, currentValues(p));
  }
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
  try { history.replaceState(null, "", "#p=" + id); } catch (e) {}
}
function syncModalFav() {
  const b = $("modalFav"), on = state.favs.has(state.openId);
  b.classList.toggle("active", on); b.textContent = on ? "♥" : "♡";
}
function closeModal() { $("modalBackdrop").hidden = true; document.body.style.overflow = ""; state.openId = null; try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }

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
    ], t => { $("runStatus").hidden = false; $("runStatusText").textContent = t; },
    partial => { $("runOutput").textContent = partial; $("runOutput").hidden = false; $("runStatus").hidden = true; });
    $("runOutput").textContent = out; $("runOutput").hidden = false;
    $("runRegen").hidden = false; $("runCopyResp").hidden = false;
  } catch (err) {
    $("runError").innerHTML = aiErrorHTML(); $("runError").hidden = false;
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
  const agentStatus = t => {
    const el = document.querySelector(".agent-step.working .agent-state");
    if (el) el.textContent = "⏳ " + t;
  };
  const agentToken = partial => {
    const el = document.querySelector(".agent-step.working .agent-body");
    if (el) { el.hidden = false; el.textContent = partial; }
  };
  const s1 = agentStepEl(1, "Draft — AI writes a first version");
  const s2 = agentStepEl(2, "Critique — AI finds the weaknesses");
  const s3 = agentStepEl(3, "Polish — AI rewrites using the critique");
  try {
    setStepState(s1, "working");
    const draft = await aiChat([
      { role: "system", content: "You are a helpful AI assistant. Follow the user's instructions exactly and completely." },
      { role: "user", content: filled }
    ], agentStatus, agentToken);
    setStepState(s1, "done", draft);

    setStepState(s2, "working");
    const critique = await aiChat([
      { role: "system", content: "You are a ruthless but constructive critic. Find real weaknesses: inaccuracies, vagueness, missing pieces, weak structure. Be specific." },
      { role: "user", content: "Critique this AI-generated output. List the top 3-5 specific weaknesses as bullets. No praise, no fluff:\n\n" + draft }
    ], agentStatus, agentToken);
    setStepState(s2, "done", critique);

    setStepState(s3, "working");
    const final = await aiChat([
      { role: "system", content: "You are an expert editor. Rewrite and improve. Output ONLY the improved version — no commentary, no headers about what you changed." },
      { role: "user", content: "Rewrite this draft, fixing every issue in the critique below. Output only the improved version.\n\nDRAFT:\n" + draft + "\n\nCRITIQUE:\n" + critique }
    ], agentStatus, agentToken);
    setStepState(s3, "done", final);
    $("agentCopyFinal").hidden = false;
    $("agentCopyFinal").onclick = e => copyText(final, e.target);
  } catch (err) {
    $("agentError").innerHTML = aiErrorHTML(); $("agentError").hidden = false;
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
$("modalShare").onclick = e => {
  copyText(location.origin + location.pathname + "#p=" + state.openId, e.target);
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

fetch("prompts.json?v=2")
  .then(r => r.json())
  .then(data => {
    state.prompts = data; loadFavs(); updateFavCount(); render(); showPotd();
    const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)$/);
    if (m) openModal(m[1], "prompt");
  })
  .catch(() => { grid.innerHTML = "<p style='color:var(--muted)'>Couldn't load the prompt library. Try refreshing.</p>"; });

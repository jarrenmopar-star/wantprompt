/* WantPrompt — My Vault. Same storage keys as the library (wp_favs, wp_mine);
   use counts live in wp_uses. Everything stays in this browser. */
const $ = id => document.getElementById(id);
const grid = $("grid"), catsEl = $("cats");
const state = { prompts: [], mine: [], favs: new Set(), uses: {}, q: "", cat: "All", filter: "all", sort: "used", editingId: null };
const CATS = ["Writing", "Marketing", "Business", "Coding", "Images", "Productivity", "Learning", "Fun"];

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function loadAll() {
  try { state.favs = new Set(JSON.parse(localStorage.getItem("wp_favs") || "[]")); } catch (e) { state.favs = new Set(); }
  try { state.mine = JSON.parse(localStorage.getItem("wp_mine") || "[]"); } catch (e) { state.mine = []; }
  try { state.uses = JSON.parse(localStorage.getItem("wp_uses") || "{}"); } catch (e) { state.uses = {}; }
}
function saveFavs() { localStorage.setItem("wp_favs", JSON.stringify([...state.favs])); }
function saveMine() { localStorage.setItem("wp_mine", JSON.stringify(state.mine)); }
function saveUses() { localStorage.setItem("wp_uses", JSON.stringify(state.uses)); }
function savedList() {
  const lib = state.prompts.filter(p => state.favs.has(p.id));
  return [...lib, ...state.mine];
}
function varsIn(text) {
  const out = []; const re = /\[([^\[\]\n]{1,80})\]/g; let m;
  while ((m = re.exec(text))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
function fillVars(p, values) {
  let t = p.prompt;
  varsIn(p.prompt).forEach(v => {
    const val = (values[v] || "").trim() || "[" + v + "]";
    t = t.split("[" + v + "]").join(val);
  });
  return t;
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = "✓ Copied"; setTimeout(() => btn.textContent = o, 1400); }
}
function bumpUse(id) {
  state.uses[id] = (state.uses[id] || 0) + 1;
  saveUses();
}

function renderCats() {
  const saved = savedList();
  const cats = ["All", ...new Set(saved.map(p => p.category))];
  catsEl.innerHTML = "";
  cats.forEach(c => {
    const n = c === "All" ? saved.length : saved.filter(p => p.category === c).length;
    const b = document.createElement("button");
    b.className = "cat" + (state.cat === c ? " active" : "");
    b.textContent = c + " · " + n;
    b.onclick = () => { state.cat = c; render(); window.scrollTo(0, 0); };
    catsEl.appendChild(b);
  });
}
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = savedList().filter(p => {
    if (state.filter === "favs" && p.mine) return false;
    if (state.filter === "mine" && !p.mine) return false;
    if (state.cat !== "All" && p.category !== state.cat) return false;
    if (q && !(p.title + " " + p.desc + " " + p.prompt).toLowerCase().includes(q)) return false;
    return true;
  });
  if (state.sort === "az") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  else if (state.sort === "newest") list = [...list].sort((a, b) => {
    const ta = a.mine ? parseInt(String(a.id).replace("mine-", ""), 10) || 0 : 0;
    const tb = b.mine ? parseInt(String(b.id).replace("mine-", ""), 10) || 0 : 0;
    return tb - ta;
  });
  else list = [...list].sort((a, b) => (state.uses[b.id] || 0) - (state.uses[a.id] || 0) || a.title.localeCompare(b.title));
  return list;
}
function render() {
  renderCats();
  const saved = savedList();
  const list = filtered();
  grid.innerHTML = "";
  $("empty").hidden = saved.length > 0;
  $("noMatch").hidden = saved.length === 0 || list.length > 0;
  $("resultCount").textContent = saved.length
    ? list.length + " of " + saved.length + " saved prompt" + (saved.length === 1 ? "" : "s")
    : "";
  $("activeFilter").textContent = state.filter === "favs" ? "· ♥ favorites" : state.filter === "mine" ? "· my prompts" : (state.cat !== "All" ? "· " + state.cat : "");
  list.forEach(p => {
    const uses = state.uses[p.id] || 0;
    const vars = varsIn(p.prompt);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="card-top"><span class="badge">' + esc(p.mine ? "My prompt · " + p.category : p.category) + '</span><span>' +
      (p.mine ? '<button class="del-mine" aria-label="Delete my prompt">✕</button>' : "") +
      '<button class="fav active" aria-label="Remove from vault">♥</button></span></div>' +
      "<h3>" + esc(p.title) + "</h3><p>" + esc(p.desc) + "</p>" +
      '<div class="card-foot"><span class="used-tag">' + (uses ? "Used " + uses + "×" : "") + '</span>' +
      '<span class="card-foot-right">' +
      (vars.length ? '<button class="mini-try fill-btn">✎ Fill in &amp; copy</button>' : "") +
      '<button class="mini-copy">📋 Copy</button></span></div>' +
      (p.mine ? '<div class="card-foot"><span></span><span class="card-foot-right"><button class="mini-copy edit-btn">✎ Edit</button></span></div>' : "") +
      '<div class="fill-box" hidden></div>';
    const favBtn = card.querySelector(".fav");
    favBtn.onclick = e => {
      e.stopPropagation();
      if (p.mine) { state.mine = state.mine.filter(x => x.id !== p.id); saveMine(); }
      else { state.favs.delete(p.id); saveFavs(); }
      render();
    };
    const del = card.querySelector(".del-mine");
    if (del) del.onclick = e => { e.stopPropagation(); state.mine = state.mine.filter(x => x.id !== p.id); saveMine(); render(); };
    card.querySelector(".mini-copy").onclick = e => { e.stopPropagation(); bumpUse(p.id); copyText(fillVars(p, {}), e.target); render(); };
    const editBtn = card.querySelector(".edit-btn");
    if (editBtn) editBtn.onclick = e => { e.stopPropagation(); startEdit(p); };
    const fillBtn = card.querySelector(".fill-btn");
    if (fillBtn) fillBtn.onclick = e => { e.stopPropagation(); toggleFill(card, p); };
    grid.appendChild(card);
  });
}
function toggleFill(card, p) {
  const box = card.querySelector(".fill-box");
  if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.innerHTML = '<div class="vars"></div><pre class="prompt-preview"></pre><div class="var-actions"><button class="btn primary copy-filled">📋 Copy filled prompt</button></div>';
  const varsBox = box.querySelector(".vars");
  const preview = box.querySelector(".prompt-preview");
  const values = {};
  varsIn(p.prompt).forEach(v => {
    const wrap = document.createElement("div");
    wrap.className = "var-field";
    wrap.innerHTML = "<label>[" + esc(v) + "]</label>";
    const inp = document.createElement("input");
    inp.placeholder = "Type to customize…";
    inp.oninput = () => { values[v] = inp.value; preview.textContent = fillVars(p, values); };
    wrap.appendChild(inp); varsBox.appendChild(wrap);
  });
  preview.textContent = p.prompt;
  box.querySelector(".copy-filled").onclick = e => { bumpUse(p.id); copyText(fillVars(p, values), e.target); render(); };
}

/* ---------- add / edit my prompts ---------- */
function resetForm() {
  state.editingId = null;
  $("addTitle").textContent = "Add your own prompt";
  $("vSave").textContent = "Save my prompt";
  ["vTitle", "vDesc", "vPrompt"].forEach(i => $(i).value = "");
  $("vStatus").textContent = "";
}
function startEdit(p) {
  state.editingId = p.id;
  $("addTitle").textContent = "Edit your prompt";
  $("vSave").textContent = "Save changes";
  $("vTitle").value = p.title;
  $("vCat").value = p.category;
  $("vDesc").value = p.desc;
  $("vPrompt").value = p.prompt;
  $("addPanel").hidden = false;
  $("addPanel").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("addBtn").onclick = () => {
  const panel = $("addPanel");
  if (panel.hidden) { resetForm(); panel.hidden = false; panel.scrollIntoView({ behavior: "smooth", block: "center" }); }
  else panel.hidden = true;
};
$("vCancel").onclick = () => { resetForm(); $("addPanel").hidden = true; };
$("vSave").onclick = () => {
  const title = $("vTitle").value.trim(), prompt = $("vPrompt").value.trim();
  const st = $("vStatus");
  if (!title || !prompt) { st.textContent = "Title and prompt text are required."; st.className = "panel-status err"; return; }
  if (state.editingId) {
    const p = state.mine.find(x => x.id === state.editingId);
    if (p) { p.title = title; p.category = $("vCat").value; p.desc = $("vDesc").value.trim() || "Your custom prompt."; p.prompt = prompt; }
    st.textContent = "Saved changes.";
  } else {
    state.mine.push({ id: "mine-" + Date.now(), title, category: $("vCat").value, desc: $("vDesc").value.trim() || "Your custom prompt.", prompt, mine: true });
    st.textContent = "Saved — it's now in your vault and the library.";
  }
  st.className = "panel-status ok";
  saveMine();
  resetForm();
  $("addPanel").hidden = true;
  render();
};

/* ---------- toolbar: search / filter / sort / export / import / theme ---------- */
$("search").oninput = e => { state.q = e.target.value; render(); };
$("clearSearch").onclick = () => { $("search").value = ""; state.q = ""; render(); };
document.querySelectorAll(".filter-btn").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll(".filter-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    state.filter = b.dataset.filter;
    render();
  };
});
$("sortSel").onchange = e => { state.sort = e.target.value; render(); };
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ favs: [...state.favs], mine: state.mine }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "wantprompt-backup.json"; a.click();
  URL.revokeObjectURL(a.href);
};
$("importFile").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (Array.isArray(data.favs)) data.favs.forEach(id => state.favs.add(id));
      if (Array.isArray(data.mine)) {
        const have = new Set(state.mine.map(p => p.id));
        data.mine.forEach(p => { if (p && p.id && p.title && p.prompt && !have.has(p.id)) state.mine.push(p); });
      }
      if (data.uses && typeof data.uses === "object") {
        Object.keys(data.uses).forEach(k => { state.uses[k] = Math.max(state.uses[k] || 0, data.uses[k] || 0); });
      }
      saveFavs(); saveMine(); saveUses(); render();
    } catch (err) { /* ignore bad file */ }
  };
  r.readAsText(f);
};
function applyTheme() {
  const theme = localStorage.getItem("wp_theme") || "dark";
  document.body.classList.toggle("light", theme === "light");
  $("themeBtn").textContent = theme === "light" ? "🌙 Dark" : "☀️ Light";
}
$("themeBtn").onclick = () => {
  localStorage.setItem("wp_theme", document.body.classList.contains("light") ? "dark" : "light");
  applyTheme();
};

fetch("prompts.json?v=2")
  .then(r => r.json())
  .then(data => { state.prompts = data; loadAll(); applyTheme(); render(); })
  .catch(() => { loadAll(); applyTheme(); render(); grid.innerHTML = "<p style='color:var(--muted)'>Couldn't load the prompt library — your own saved prompts still show below.</p>"; });

/* Writer — compose posts in the browser and commit them to GitHub.
   Posts land at content/posts/YYYY-MM-DD-slug.md; the site's Actions workflow
   then rebuilds and deploys. Your token never leaves this browser except in
   requests to api.github.com. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const API = "https://api.github.com";
  const SITE_ORIGIN = location.origin.includes("github.io") ? location.origin : "https://mehedieh.github.io";
  const CATEGORY_NAMES = {
    cybersecurity: "Cybersecurity", software: "Software Engineering", physics: "Physics",
    notes: "Academic Notes", technology: "Technology", reflections: "Personal Reflections",
  };
  const KNOWN_KEYS = ["title", "date", "category", "description", "draft", "slug"];
  const DRAFT_KEY = "writer:draft";
  const SETTINGS_KEY = "writer:github";

  const f = {
    title: $("#f-title"), description: $("#f-description"), category: $("#f-category"),
    date: $("#f-date"), slug: $("#f-slug"), draft: $("#f-draft"), original: $("#f-original"), body: $("#f-body"),
  };
  const status = $("#status");
  const pending = new Map(); // site URL (/img/posts/x.png) → { path, file, blobUrl }
  let state = { slugTouched: false, sourcePath: null, extra: {}, originalSlug: null };
  let postsCache = null;

  /* ───────────── utilities ───────────── */
  const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
  const slugify = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
  const validSlug = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const setStatus = (msg, kind = "") => { status.textContent = msg; status.className = "w-status" + (kind ? " is-" + kind : ""); };
  const words = (s) => (s.trim().match(/\S+/g) || []).length;
  const fmtDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); };
  const utf8ToB64 = (s) => { const b = new TextEncoder().encode(s); let bin = ""; b.forEach((x) => (bin += String.fromCharCode(x))); return btoa(bin); };
  const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  const fileToB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ───────────── settings / GitHub ───────────── */
  /* The decrypted connection lives only in this variable — never in storage. */
  let session = null; // { key: CryptoKey, salt: Uint8Array, iter, data: { token, owner, repo, branch } }
  function settings() {
    const d = (session && session.data) || {};
    return { owner: d.owner || "mehedieh", repo: d.repo || "mehedieh.github.io", branch: d.branch || "master", token: d.token || "" };
  }
  async function gh(path, opts = {}) {
    const s = settings();
    if (!s.token) throw Object.assign(new Error("Writer is locked. Unlock it to talk to GitHub."), { code: "NO_TOKEN" });
    const res = await fetch(API + path.replace("{repo}", `repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`), {
      ...opts,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${s.token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json()).message || ""; } catch {}
      const msg = res.status === 401 ? "GitHub rejected the token (expired or wrong)."
        : res.status === 403 ? `GitHub refused the request: ${detail || "the token lacks permission"}.`
        : res.status === 404 ? "Not found — check owner, repository and branch, and that the token can access this repository."
        : `GitHub error ${res.status}: ${detail}`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }

  /* ───────────── composing the file ───────────── */
  function filePath() { return `content/posts/${f.date.value}-${f.slug.value}.md`; }
  function composeBody() {
    let body = f.body.value.replace(/\s+$/, "");
    const orig = f.original.value.trim();
    if (orig && !body.includes(orig)) {
      let host = orig; try { host = new URL(orig).hostname.replace(/^www\./, ""); } catch {}
      body += `\n\n---\n\n*Originally published on [${host}](${orig}).*`;
    }
    return body + "\n";
  }
  function composeFile() {
    const q = (s) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars
    let fm = `---\ntitle: ${q(f.title.value.trim())}\ndate: ${f.date.value}\ncategory: ${f.category.value}\n`;
    fm += `description: ${q(f.description.value.trim().replace(/\s+/g, " "))}\n`;
    if (f.draft.checked) fm += "draft: true\n";
    const extra = { ...state.extra };
    if (state.originalSlug && state.originalSlug !== f.slug.value) {
      const old = `/writing/${state.originalSlug}/`;
      extra.legacy_urls = Array.from(new Set([...(extra.legacy_urls || []), old]));
    }
    if (Object.keys(extra).length) fm += window.jsyaml.safeDump(extra, { lineWidth: 1000 });
    return fm + "---\n\n" + composeBody();
  }

  /* ───────────── preview (mirrors build.py) ───────────── */
  const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
  function splitFences(src, fn) {
    let out = "", last = 0;
    for (const m of src.matchAll(FENCE)) { out += fn(src.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
    return out + fn(src.slice(last));
  }
  function render(src) {
    const levels = [...src.replace(FENCE, "").matchAll(/^(#{1,6})\s/gm)].map((m) => m[1].length);
    const shift = levels.length ? Math.max(0, 2 - Math.min(...levels)) : 0;
    if (shift) src = splitFences(src, (t) => t.replace(/^(#{1,6})(\s)/gm, (_, h, s) => "#".repeat(Math.min(6, h.length + shift)) + s));
    const math = [];
    const keep = (display, tex) => { math.push({ display, tex: tex.trim() }); return `MATHTOKEN${math.length - 1}X`; };
    src = splitFences(src, (t) => t
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => "\n\nMATHBLOCK" + keep(true, x) + "\n\n")
      .replace(/(?<![\\$])\$(?!\s*\$)([^\n$]+?)(?<!\\)\$/g, (_, x) => keep(false, x)));
    let html = window.marked.parse(src, { gfm: true, breaks: false });
    html = window.DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
    const tex = (i) => {
      let { display, tex: t } = math[i];
      if (display) {
        t = t.replace(/\\(begin|end)\{(align|equation|gather)\*?\}/g, (_, be, env) => `\\${be}{${{ align: "aligned", equation: "split", gather: "gathered" }[env]}}`);
        if (t.includes("\\\\") && !t.includes("\\begin")) t = `\\begin{gathered}${t}\\end{gathered}`;
      }
      try {
        return window.katex.renderToString(t, { displayMode: display, throwOnError: false, strict: "ignore", macros: { "\\bold": "\\mathbf{#1}" } });
      } catch (e) { return `<code>${t}</code>`; }
    };
    html = html.replace(/<p>\s*MATHBLOCKMATHTOKEN(\d+)X\s*<\/p>/g, (_, i) => `<div class="math-display">${tex(+i)}</div>`)
      .replace(/MATHBLOCKMATHTOKEN(\d+)X/g, (_, i) => `<div class="math-display">${tex(+i)}</div>`)
      .replace(/MATHTOKEN(\d+)X/g, (_, i) => `<span class="math-inline">${tex(+i)}</span>`);
    return html;
  }
  function renderPreview() {
    $("#p-title").textContent = f.title.value || "Untitled post";
    $("#p-desc").textContent = f.description.value;
    $("#p-desc").hidden = !f.description.value.trim();
    $("#p-cat").textContent = CATEGORY_NAMES[f.category.value];
    $("#p-date").textContent = f.date.value ? fmtDate(f.date.value) : "";
    const body = composeBody();
    let html = render(body);
    pending.forEach((img, url) => { html = html.split(`src="${url}"`).join(`src="${img.blobUrl}" class="w-pending-img" title="Uploads when you publish"`); });
    const box = $("#p-body");
    box.innerHTML = html;
    box.querySelectorAll("img").forEach((img) => {
      const p = img.parentElement;
      if (p && p.tagName === "P" && p.childNodes.length === 1) { const fig = document.createElement("figure"); fig.className = "figure"; p.replaceWith(fig); fig.appendChild(img); }
      img.loading = "lazy";
    });
    box.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
    $("#p-time").textContent = `${Math.max(1, Math.ceil(words(box.textContent) / 220))} min read`;
  }
  const livePreview = debounce(() => { if (!$("#preview-pane").hidden) renderPreview(); }, 200);

  /* ───────────── local draft ───────────── */
  function snapshot() {
    return { title: f.title.value, description: f.description.value, category: f.category.value, date: f.date.value,
      slug: f.slug.value, draft: f.draft.checked, original: f.original.value, body: f.body.value, ...state };
  }
  function load(d) {
    f.title.value = d.title || ""; f.description.value = d.description || ""; f.category.value = d.category || "cybersecurity";
    f.date.value = d.date || today(); f.slug.value = d.slug || ""; f.draft.checked = !!d.draft; f.original.value = d.original || "";
    f.body.value = d.body || "";
    state = { slugTouched: !!d.slugTouched, sourcePath: d.sourcePath || null, extra: d.extra || {}, originalSlug: d.originalSlug || null };
    refreshMeta(); autoGrow();
  }
  const saveLocal = debounce(() => { store.set(DRAFT_KEY, snapshot()); setStatus(state.sourcePath ? "Editing published post — changes saved on this device" : "Draft saved on this device"); }, 400);

  function refreshMeta() {
    const n = words(f.body.value);
    $("#word-count").textContent = `${n.toLocaleString()} word${n === 1 ? "" : "s"}`;
    $("#read-time").textContent = `${Math.max(1, Math.ceil(n / 220))} min read`;
    const dl = f.description.value.length;
    $("#desc-count").textContent = `${dl}/200`;
    $("#desc-count").classList.toggle("is-over", dl > 200);
    $("#file-path").textContent = f.date.value && f.slug.value ? filePath() : "content/posts/…";
  }
  function autoGrow() { f.title.style.height = "auto"; f.title.style.height = f.title.scrollHeight + "px"; }

  /* ───────────── formatting toolbar ───────────── */
  function surround(before, after = before, placeholder = "text") {
    const t = f.body, s = t.selectionStart, e = t.selectionEnd, sel = t.value.slice(s, e) || placeholder;
    t.setRangeText(before + sel + after, s, e, "end");
    t.setSelectionRange(s + before.length, s + before.length + sel.length);
    t.focus(); t.dispatchEvent(new Event("input"));
  }
  function linePrefix(prefix) {
    const t = f.body, s = t.value.lastIndexOf("\n", t.selectionStart - 1) + 1;
    t.setRangeText(prefix, s, s, "end"); t.focus(); t.dispatchEvent(new Event("input"));
  }
  function insertBlock(text) {
    const t = f.body, s = t.selectionStart;
    const before = t.value.slice(0, s);
    const pre = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    t.setRangeText(pre + text + "\n", s, t.selectionEnd, "end"); t.focus(); t.dispatchEvent(new Event("input"));
  }
  const actions = {
    h2: () => linePrefix("## "), h3: () => linePrefix("### "), bold: () => surround("**"), italic: () => surround("*"),
    link: () => { const url = prompt("Link URL", "https://"); if (url) surround("[", `](${url})`, "link text"); },
    quote: () => linePrefix("> "), ul: () => linePrefix("- "),
    code: () => { const t = f.body; if (t.value.slice(t.selectionStart, t.selectionEnd).includes("\n")) surround("```\n", "\n```", ""); else surround("`"); },
    math: () => surround("$", "$", "E = mc^2"), mathblock: () => insertBlock("$$\n\\oint \\mathbf{E}\\cdot d\\mathbf{l} = -\\frac{d\\Phi_B}{dt}\n$$"),
  };
  $(".w-toolbar").addEventListener("click", (e) => { const b = e.target.closest("button[data-md]"); if (b) actions[b.dataset.md](); });
  f.body.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); actions.bold(); } else if (k === "i") { e.preventDefault(); actions.italic(); }
    else if (k === "k") { e.preventDefault(); actions.link(); }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); store.set(DRAFT_KEY, snapshot()); setStatus("Draft saved on this device", "ok"); }
  });

  $("#f-image").addEventListener("change", (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { setStatus("Images over 3 MB slow the site down — resize it first.", "error"); return; }
    const base = file.name.replace(/\.[^.]+$/, ""), ext = (file.name.split(".").pop() || "png").toLowerCase();
    const name = `${f.date.value || today()}-${slugify(base) || "image"}.${ext}`;
    const url = `/img/posts/${name}`;
    pending.set(url, { path: `static/img/posts/${name}`, file, blobUrl: URL.createObjectURL(file) });
    insertBlock(`![Describe the image for screen readers](${url})`);
    setStatus(`Image added — it uploads when you publish`, "ok");
  });

  /* ───────────── field wiring ───────────── */
  f.title.addEventListener("input", () => { autoGrow(); if (!state.slugTouched && !state.sourcePath) f.slug.value = slugify(f.title.value); });
  f.slug.addEventListener("input", () => { state.slugTouched = true; f.slug.value = f.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-"); });
  Object.values(f).forEach((el) => el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => { refreshMeta(); saveLocal(); livePreview(); }));

  /* ───────────── preview toggle ───────────── */
  const wide = window.matchMedia("(min-width: 1100px)");
  function setPreview(on) {
    $("#toggle-preview").setAttribute("aria-pressed", String(on));
    $("#toggle-preview").textContent = on ? (wide.matches ? "Hide preview" : "Edit") : "Preview";
    $("#preview-pane").hidden = !on;
    $("#main").classList.toggle("is-split", on && wide.matches);
    $("#editor-pane").hidden = on && !wide.matches;
    if (on) { renderPreview(); if (!wide.matches) window.scrollTo(0, 0); }
  }
  $("#toggle-preview").addEventListener("click", () => setPreview($("#toggle-preview").getAttribute("aria-pressed") !== "true"));
  wide.addEventListener?.("change", () => setPreview($("#toggle-preview").getAttribute("aria-pressed") === "true"));

  /* ───────────── theme ───────────── */
  $("#theme").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch {}
  });

  /* ───────────── vault: password-encrypted token ─────────────
     Password → PBKDF2-SHA256 (600k iterations, random 16-byte salt) → AES-256-GCM key.
     Only the ciphertext is stored. A wrong password fails GCM authentication, so
     nothing that could verify a guess offline is kept besides the ciphertext itself. */
  const VAULT_KEY = "writer:vault", GUARD_KEY = "writer:guard";
  const PBKDF2_ITER = 600000, AAD = new TextEncoder().encode("mehedieh-writer-vault-v1");
  const IDLE_LOCK_MS = 15 * 60 * 1000, HIDDEN_LOCK_MS = 5 * 60 * 1000, MAX_FAILS = 10;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = (buf) => { let s = ""; new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealVault(key, salt, iter, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, enc.encode(JSON.stringify(data)));
    store.set(VAULT_KEY, { v: 1, kdf: "PBKDF2-SHA256", iter, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) });
  }
  async function openVault(password) {
    const v = store.get(VAULT_KEY);
    const salt = fromB64(v.salt), key = await deriveKey(password, salt, v.iter);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(v.iv), additionalData: AAD }, key, fromB64(v.ct));
    return { key, salt, iter: v.iter, data: JSON.parse(dec.decode(pt)) };
  }
  function passwordProblem(pw, pw2, token) {
    if (pw.length < 12) return "Use at least 12 characters.";
    if (pw !== pw2) return "The two passwords don't match.";
    if (token && pw === token) return "The password must not be the token itself.";
    if (/^(.)\1+$/.test(pw) || /^(?:password|qwerty|123456|admin|writer)/i.test(pw)) return "That password is too easy to guess.";
    return "";
  }
  function strength(pw) {
    let score = Math.min(pw.length, 24) / 6 + [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((r) => r.test(pw)).length;
    return pw.length < 12 ? ["Too short", "weak"] : score >= 7 ? ["Strong", "strong"] : score >= 5 ? ["Good", "ok"] : ["Weak", "weak"];
  }
  async function testConnection(data) {
    const prev = session; session = { data };
    try {
      const repo = await gh("/{repo}");
      if (!repo.permissions || !repo.permissions.push) throw new Error("This token can read the repository but not write to it. Give it Contents: Read and write.");
      await gh(`/{repo}/branches/${encodeURIComponent(data.branch)}`);
      return repo.full_name;
    } finally { session = prev; }
  }

  /* Throttling: exponential delay after 3 failed attempts; vault wiped after 10. */
  const guard = () => store.get(GUARD_KEY) || { fails: 0, until: 0 };
  function registerFail() {
    const g = guard(); g.fails += 1;
    g.until = g.fails >= 3 ? Date.now() + Math.min(5000 * 2 ** (g.fails - 3), 15 * 60 * 1000) : 0;
    store.set(GUARD_KEY, g); return g;
  }

  const lockEl = $("#lock"), lockMsg = $("#lock-msg");
  const say = (msg, kind = "error") => { lockMsg.textContent = msg; lockMsg.className = "w-msg" + (msg && kind !== "info" ? " is-" + kind : ""); };
  function showLock(mode, msg = "", kind = "info") {
    session = null; postsCache = null;
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if (!drawer.hidden) openDrawer(false);
    document.body.classList.add("is-locked");
    $(".w-bar").inert = true; $("#main").inert = true;
    lockEl.hidden = false;
    const setup = mode === "setup";
    $("#unlock-form").hidden = setup; $("#setup-form").hidden = !setup; $("#lock-reset").hidden = setup;
    $("#lock-title").textContent = setup ? "Secure Writer" : "Writer is locked";
    $("#lock-intro").textContent = setup
      ? "Choose a password for this device. It encrypts your GitHub token, which is stored only in this browser. There's no way to recover the password, but you can always reset Writer and paste the token again."
      : "Enter your password to unlock.";
    say(msg, kind);
    setTimeout(() => (setup ? $("#n-pw") : $("#u-pw")).focus(), 30);
  }
  function hideLock() {
    lockEl.hidden = true; document.body.classList.remove("is-locked");
    $(".w-bar").inert = false; $("#main").inert = false;
    $("#u-pw").value = ""; ["#n-pw", "#n-pw2", "#n-token"].forEach((s) => ($(s).value = ""));
    say("");
    setStatus(`Unlocked — connected to ${settings().owner}/${settings().repo}`, "ok");
    armIdle();
  }
  function lock(reason = "Locked.") { if (store.get(VAULT_KEY)) showLock("unlock", reason); }

  $("#unlock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = guard();
    if (g.until > Date.now()) { say(`Too many attempts. Try again in ${Math.ceil((g.until - Date.now()) / 1000)} s.`); return; }
    const btn = $("#u-submit"); btn.disabled = true; btn.textContent = "Unlocking…"; say("");
    try {
      session = await openVault($("#u-pw").value);
      store.del(GUARD_KEY); hideLock();
    } catch {
      const ng = registerFail();
      if (ng.fails >= MAX_FAILS) {
        store.del(VAULT_KEY); store.del(GUARD_KEY);
        showLock("setup", "Too many wrong passwords — the saved token was erased for safety. Set Writer up again.", "error");
      } else {
        say(`Wrong password.${ng.fails >= 3 ? ` Wait ${Math.ceil((ng.until - Date.now()) / 1000)} s before the next try.` : ""} ${MAX_FAILS - ng.fails} attempt${MAX_FAILS - ng.fails === 1 ? "" : "s"} left before the token is erased.`);
        $("#u-pw").select();
      }
    } finally { btn.disabled = false; btn.textContent = "Unlock"; }
  });

  $("#n-pw").addEventListener("input", () => {
    const pw = $("#n-pw").value, el = $("#pw-strength");
    if (!pw) { el.textContent = ""; return; }
    const [label, cls] = strength(pw); el.textContent = label; el.className = "w-count w-strength-" + cls;
  });
  $("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#n-pw").value, token = $("#n-token").value.trim();
    const data = { token, owner: $("#n-owner").value.trim(), repo: $("#n-repo").value.trim(), branch: $("#n-branch").value.trim() || "master" };
    const problem = !token ? "Paste your GitHub access token." : passwordProblem(pw, $("#n-pw2").value, token);
    if (problem) { say(problem); return; }
    const btn = $("#n-submit"); btn.disabled = true; btn.textContent = "Checking token…"; say("");
    try {
      const name = await testConnection(data);
      btn.textContent = "Encrypting…";
      const salt = crypto.getRandomValues(new Uint8Array(16)), key = await deriveKey(pw, salt, PBKDF2_ITER);
      await sealVault(key, salt, PBKDF2_ITER, data);
      store.del(SETTINGS_KEY); try { sessionStorage.removeItem("writer:token"); } catch {} // remove any old plain-text token
      store.del(GUARD_KEY);
      session = { key, salt, iter: PBKDF2_ITER, data };
      hideLock(); setStatus(`Secured and connected to ${name}`, "ok");
    } catch (err) { say(err.message); }
    finally { btn.disabled = false; btn.textContent = "Secure & connect"; }
  });

  function resetWriter() {
    if (!confirm("Reset Writer on this device? The encrypted token is erased and you'll set a new password and paste a token again. Your posts on GitHub and your local draft are not affected.")) return;
    store.del(VAULT_KEY); store.del(GUARD_KEY); store.del(SETTINGS_KEY);
    showLock("setup", "Writer was reset. Choose a new password.");
  }
  $("#lock-reset").addEventListener("click", resetWriter);
  $("#lock-now").addEventListener("click", () => lock("Locked."));

  /* Auto-lock: 15 minutes without activity, or 5 minutes in a background tab. */
  let idleTimer, hiddenAt = 0;
  function armIdle() { clearTimeout(idleTimer); if (session) idleTimer = setTimeout(() => lock("Locked after 15 minutes of inactivity."), IDLE_LOCK_MS); }
  ["pointerdown", "keydown", "input", "scroll"].forEach((ev) => document.addEventListener(ev, armIdle, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (session && hiddenAt && Date.now() - hiddenAt > HIDDEN_LOCK_MS) lock("Locked while you were away.");
  });

  /* ───────────── settings dialog ───────────── */
  const sd = $("#settings-dialog"), smsg = $("#settings-msg");
  const sMsg = (m, k = "") => { smsg.textContent = m; smsg.className = "w-msg" + (k ? " is-" + k : ""); };
  function openSettings(msg = "") {
    if (!session) { lock("Unlock Writer to change settings."); return; }
    const s = settings();
    ["#s-token", "#s-newpw", "#s-newpw2", "#s-curpw"].forEach((x) => ($(x).value = ""));
    $("#s-owner").value = s.owner; $("#s-repo").value = s.repo; $("#s-branch").value = s.branch;
    sMsg(msg); sd.showModal();
  }
  $("#open-settings").addEventListener("click", () => openSettings());
  $("#s-cancel").addEventListener("click", () => sd.close());
  $("#s-reset").addEventListener("click", () => { sd.close(); resetWriter(); });
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cur = $("#s-curpw").value, newpw = $("#s-newpw").value, token = $("#s-token").value.trim();
    if (!cur) { sMsg("Enter your current password to save changes.", "error"); $("#s-curpw").focus(); return; }
    if (newpw || $("#s-newpw2").value) { const p = passwordProblem(newpw, $("#s-newpw2").value, token || settings().token); if (p) { sMsg(p, "error"); return; } }
    const btn = $("#s-save"); btn.disabled = true; sMsg("Checking…");
    try {
      let verified;
      try { verified = await openVault(cur); } catch { const g = registerFail(); sMsg("Current password is wrong.", "error"); if (g.fails >= 3) { sd.close(); lock("Locked after repeated wrong passwords."); } return; }
      store.del(GUARD_KEY);
      const data = { ...verified.data, owner: $("#s-owner").value.trim() || verified.data.owner, repo: $("#s-repo").value.trim() || verified.data.repo,
        branch: $("#s-branch").value.trim() || verified.data.branch, ...(token ? { token } : {}) };
      const name = await testConnection(data);
      let { key, salt, iter } = verified;
      if (newpw) { salt = crypto.getRandomValues(new Uint8Array(16)); iter = PBKDF2_ITER; key = await deriveKey(newpw, salt, iter); }
      await sealVault(key, salt, iter, data);
      session = { key, salt, iter, data }; postsCache = null;
      sMsg(`Saved. Connected to ${name}${newpw ? " — password changed" : ""}.`, "ok");
      setTimeout(() => sd.close(), 1100);
    } catch (err) { sMsg(err.message, "error"); }
    finally { btn.disabled = false; }
  });

  /* ───────────── posts drawer ───────────── */
  const drawer = $("#posts-drawer");
  let scrim;
  function openDrawer(open) {
    drawer.hidden = !open; $("#open-posts").setAttribute("aria-expanded", String(open));
    if (open) {
      scrim = document.createElement("div"); scrim.className = "w-scrim"; scrim.addEventListener("click", () => openDrawer(false));
      document.body.appendChild(scrim); loadPosts(); $("#new-post").focus();
    } else { scrim?.remove(); }
  }
  $("#open-posts").addEventListener("click", () => openDrawer(drawer.hidden));
  drawer.querySelector("[data-close]").addEventListener("click", () => openDrawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) openDrawer(false); });

  async function listPosts(force) {
    if (postsCache && !force) return postsCache;
    const s = settings();
    const items = await gh(`/{repo}/contents/content/posts?ref=${encodeURIComponent(s.branch)}`);
    postsCache = items.filter((i) => i.type === "file" && i.name.endsWith(".md")).sort((a, b) => b.name.localeCompare(a.name));
    return postsCache;
  }
  async function loadPosts() {
    const list = $("#posts-list"), note = $("#posts-note");
    list.innerHTML = ""; note.textContent = "Loading…";
    try {
      const posts = await listPosts(true);
      note.textContent = `${posts.length} post${posts.length === 1 ? "" : "s"} on GitHub. Open one to edit it.`;
      posts.forEach((p) => {
        const m = p.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
        const li = document.createElement("li"), b = document.createElement("button");
        b.type = "button";
        const t = document.createElement("span"); t.textContent = m ? m[2].replace(/-/g, " ") : p.name;
        const meta = document.createElement("span"); meta.className = "meta"; meta.textContent = m ? m[1] : "";
        b.append(t, meta); b.addEventListener("click", () => openPost(p.path)); li.appendChild(b); list.appendChild(li);
      });
    } catch (err) {
      note.textContent = err.message;
      if (err.code === "NO_TOKEN") { openDrawer(false); lock("Unlock Writer to load your posts."); }
    }
  }
  function isDirty() { return f.body.value.trim() || f.title.value.trim(); }
  async function openPost(path) {
    if (isDirty() && !confirm("Replace what's in the editor with this post? Your current draft will be discarded.")) return;
    try {
      setStatus("Opening…");
      const file = await gh(`/{repo}/contents/${path}?ref=${encodeURIComponent(settings().branch)}`);
      const text = b64ToUtf8(file.content);
      const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
      const fm = m ? window.jsyaml.safeLoad(m[1]) || {} : {};
      const body = m ? m[2].replace(/^\n+/, "") : text;
      const nm = path.match(/(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
      let date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : String(fm.date || (nm && nm[1]) || today());
      const slug = fm.slug || (nm ? nm[2] : "");
      const extra = {}; Object.keys(fm).forEach((k) => { if (!KNOWN_KEYS.includes(k)) extra[k] = fm[k]; });
      pending.clear();
      load({ title: fm.title || "", description: fm.description || "", category: fm.category || "notes", date, slug,
        draft: !!fm.draft, original: "", body, slugTouched: true, sourcePath: path, extra, originalSlug: slug });
      store.set(DRAFT_KEY, snapshot());
      openDrawer(false); setStatus(`Editing ${path.split("/").pop()}`, "ok"); livePreview();
    } catch (err) { setStatus(err.message, "error"); }
  }
  $("#new-post").addEventListener("click", () => {
    if (isDirty() && !confirm("Start a new post? The current draft will be discarded.")) return;
    pending.clear(); load({ date: today(), category: "cybersecurity" }); store.del(DRAFT_KEY);
    openDrawer(false); setStatus("New post"); f.title.focus(); livePreview();
  });

  /* ───────────── publish ───────────── */
  const pd = $("#publish-dialog"), pmsg = $("#publish-msg");
  pd.querySelector("[data-close]").addEventListener("click", () => pd.close());

  function validate() {
    const errs = [];
    if (!f.title.value.trim()) errs.push("Add a title.");
    if (!f.date.value) errs.push("Pick a date.");
    if (!validSlug(f.slug.value)) errs.push("The URL slug may only contain lowercase letters, numbers and single hyphens.");
    if (!f.body.value.trim()) errs.push("The post body is empty.");
    if (!f.description.value.trim()) errs.push("Add a short description — it is shown in lists and link previews.");
    return errs;
  }
  function row(dl, k, v, mono) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; if (mono) dd.className = "mono"; dl.append(dt, dd); }

  $("#publish").addEventListener("click", async () => {
    const errs = validate();
    if (errs.length) { setStatus(errs[0], "error"); (errs[0].includes("title") ? f.title : errs[0].includes("slug") ? f.slug : errs[0].includes("description") ? f.description : f.body).focus(); return; }
    if (!settings().token) { lock("Unlock Writer to publish."); return; }
    const dl = $("#publish-summary"); dl.innerHTML = "";
    const path = filePath();
    row(dl, "Title", f.title.value.trim());
    row(dl, "Category", CATEGORY_NAMES[f.category.value]);
    row(dl, "File", path, true);
    row(dl, "URL", f.draft.checked ? "Not visible (draft)" : `${SITE_ORIGIN}/writing/${f.slug.value}/`, true);
    const imgs = [...pending.entries()].filter(([u, img]) => !img.uploaded && f.body.value.includes(u));
    if (imgs.length) row(dl, "Images", `${imgs.length} to upload`);
    $("#publish-title").textContent = state.sourcePath ? "Update this post?" : f.draft.checked ? "Save draft to GitHub?" : "Publish this post?";
    $("#publish-progress").hidden = true; $("#publish-actions").hidden = false; $("#publish-confirm").hidden = false;
    pd.querySelector("[data-close]").textContent = "Cancel";
    $("#publish-confirm").textContent = state.sourcePath ? "Update" : f.draft.checked ? "Save draft" : "Publish";
    pmsg.textContent = ""; pmsg.className = "w-msg";
    pd.showModal();
    try {
      const posts = await listPosts(true);
      const clash = posts.find((p) => p.path !== state.sourcePath && (p.path === path || p.name.replace(/^\d{4}-\d{2}-\d{2}-/, "") === `${f.slug.value}.md`));
      if (clash) { pmsg.textContent = `Another post already uses this URL (${clash.name}). Publishing will ${clash.path === path ? "replace it" : "create a duplicate URL"} — change the slug unless that's intended.`; pmsg.className = "w-msg is-error"; }
    } catch (err) { pmsg.textContent = err.message; pmsg.className = "w-msg is-error"; }
  });

  function steps(labels) {
    const ol = $("#publish-steps"); ol.innerHTML = "";
    const lis = labels.map((l) => { const li = document.createElement("li"); li.textContent = l; ol.appendChild(li); return li; });
    return {
      start(i) { lis[i].className = "is-active"; },
      done(i, text) { lis[i].className = "is-done"; if (text) lis[i].textContent = text; },
      fail(i, text) { lis[i].className = "is-failed"; if (text) lis[i].textContent = text; },
    };
  }

  $("#publish-confirm").addEventListener("click", async () => {
    const s = settings(), path = filePath(), isDraft = f.draft.checked;
    const imgs = [...pending.entries()].filter(([u, img]) => !img.uploaded && f.body.value.includes(u));
    $("#publish-actions").hidden = true; $("#publish-progress").hidden = false; pmsg.textContent = "";
    const labels = [imgs.length ? `Uploading ${imgs.length} image${imgs.length > 1 ? "s" : ""} and the post` : "Uploading the post", "Building the site", isDraft ? "Draft saved (not shown on the site)" : "Checking it's live"];
    const st = steps(labels);
    let commitSha;
    try {
      st.start(0);
      const ref = await gh(`/{repo}/git/ref/heads/${encodeURIComponent(s.branch)}`);
      const base = await gh(`/{repo}/git/commits/${ref.object.sha}`);
      const tree = [];
      for (const [, img] of imgs) {
        const blob = await gh("/{repo}/git/blobs", { method: "POST", body: { content: await fileToB64(img.file), encoding: "base64" } });
        tree.push({ path: img.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const md = await gh("/{repo}/git/blobs", { method: "POST", body: { content: utf8ToB64(composeFile()), encoding: "base64" } });
      tree.push({ path, mode: "100644", type: "blob", sha: md.sha });
      if (state.sourcePath && state.sourcePath !== path) tree.push({ path: state.sourcePath, mode: "100644", type: "blob", sha: null });
      const newTree = await gh("/{repo}/git/trees", { method: "POST", body: { base_tree: base.tree.sha, tree } });
      const verb = state.sourcePath ? "Update" : isDraft ? "Draft" : "Add";
      const commit = await gh("/{repo}/git/commits", { method: "POST", body: { message: `${verb} post: ${f.title.value.trim()}`, tree: newTree.sha, parents: [ref.object.sha] } });
      await gh(`/{repo}/git/refs/heads/${encodeURIComponent(s.branch)}`, { method: "PATCH", body: { sha: commit.sha } });
      commitSha = commit.sha;
      st.done(0, "Committed to GitHub");
      // From here the post is safely on GitHub.
      imgs.forEach(([, img]) => { img.uploaded = true; }); // keep local previews until the site has them
      state.sourcePath = path; state.originalSlug = f.slug.value; postsCache = null;
      store.set(DRAFT_KEY, snapshot());
      setStatus(`Committed ${path.split("/").pop()}`, "ok");
    } catch (err) {
      st.fail(0, "Upload failed"); pmsg.textContent = err.message; pmsg.className = "w-msg is-error";
      $("#publish-actions").hidden = false; $("#publish-confirm").textContent = "Try again"; return;
    }

    // Watch the Actions build (needs Actions: Read; skipped gracefully otherwise).
    st.start(1);
    let built = false, runUrl = `https://github.com/${s.owner}/${s.repo}/actions`;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      try {
        const runs = await gh(`/{repo}/actions/runs?head_sha=${commitSha}&per_page=5`);
        const run = runs.workflow_runs.find((r) => /pages\.yml$/.test(r.path || "") || r.name === "Build and deploy site") || runs.workflow_runs[0];
        if (!run) continue;
        runUrl = run.html_url;
        if (run.status === "completed") {
          if (run.conclusion === "success") { built = true; break; }
          st.fail(1, "Build failed");
          pmsg.innerHTML = ""; pmsg.className = "w-msg is-error";
          pmsg.append("The post is saved on GitHub, but the site build failed. ");
          const a = document.createElement("a"); a.href = runUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open the build log";
          pmsg.append(a); finish(); return;
        }
      } catch (err) {
        if (err.status === 403 || err.status === 404) { st.done(1, "Building (progress hidden: token lacks Actions: Read)"); built = true; await sleep(45000); break; }
      }
    }
    if (!built) { st.fail(1, "Build is taking longer than usual"); linkOut("Check progress on GitHub", runUrl); finish(); return; }
    st.done(1, "Site built");

    st.start(2);
    if (isDraft) { st.done(2); pmsg.textContent = "Draft committed. Untick “Save as draft” and publish again when it's ready."; pmsg.className = "w-msg is-ok"; finish(); return; }
    const url = `${SITE_ORIGIN}/writing/${f.slug.value}/`;
    let live = false;
    for (let i = 0; i < 24 && !live; i++) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) {
          const doc = new DOMParser().parseFromString(await r.text(), "text/html");
          live = (doc.querySelector("h1")?.textContent || "").trim() === f.title.value.trim();
        }
      } catch {}
      if (!live) await sleep(5000);
    }
    if (live) { st.done(2, "Live on the site"); linkOut("View the post", url, "ok"); }
    else { st.done(2, "Published — the CDN may take a minute to refresh"); linkOut("Open the post", url, "ok"); }
    finish();
  });
  function linkOut(text, href, kind = "") {
    pmsg.innerHTML = ""; pmsg.className = "w-msg" + (kind ? " is-" + kind : "");
    const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = text; pmsg.appendChild(a);
  }
  function finish() {
    const actions = $("#publish-actions"); actions.hidden = false;
    $("#publish-confirm").hidden = true; actions.querySelector("[data-close]").textContent = "Done";
  }

  /* ───────────── boot ───────────── */
  window.addEventListener("beforeunload", (e) => { if ([...pending.entries()].some(([u, img]) => !img.uploaded && f.body.value.includes(u))) { e.preventDefault(); e.returnValue = ""; } });
  const saved = store.get(DRAFT_KEY);
  load(saved || { date: today(), category: "cybersecurity" });
  if (saved?.sourcePath) setStatus(`Editing ${saved.sourcePath.split("/").pop()}`);
  else if (saved && (saved.title || saved.body)) setStatus("Restored your unsaved draft");
  if (!window.crypto || !crypto.subtle) {
    showLock("setup", "This browser can't encrypt the token (open Writer over https in an up-to-date browser).", "error");
    $("#setup-form").hidden = true;
  } else if (store.get(VAULT_KEY)) {
    showLock("unlock");
  } else {
    showLock("setup", (store.get(SETTINGS_KEY) || {}).token ? "Writer now protects your token with a password. Paste the token once more to finish." : "");
  }
})();

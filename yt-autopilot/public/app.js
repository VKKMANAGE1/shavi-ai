/* YT AutoPilot dashboard */
const $ = (sel) => document.querySelector(sel);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let STATUS = null;
let QUEUE = [];
let EDITING = null;
let pollTimer = null;
let settingsFilled = false;

/* ------------------------------- helpers -------------------------------- */

function tz() {
  return STATUS?.setup?.timezone || "Asia/Kolkata";
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: tz(),
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function relative(iso) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const text = mins < 60 ? `${mins} min` : hours < 48 ? `${hours} hr` : `${days} day`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function tzOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz(),
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function isoToLocalInput(iso) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

function localInputToIso(value) {
  if (!value) return null;
  const asUtc = Date.parse(`${value}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  const first = tzOffsetMinutes(new Date(asUtc));
  let guess = asUtc - first * 60000;
  const second = tzOffsetMinutes(new Date(guess));
  if (second !== first) guess = asUtc - second * 60000;
  return new Date(guess).toISOString();
}

function bytes(n) {
  if (!n) return "";
  const mb = n / 1024 / 1024;
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("toast-error", isError);
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Sign in required");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request fail (${response.status})`);
  return data;
}

/* -------------------------------- render -------------------------------- */

function renderChannel() {
  const chip = $("#channel-chip");
  if (STATUS.connected) {
    const name = STATUS.channel?.title || "YouTube channel";
    const subs = STATUS.channel?.subscribers
      ? ` · ${Number(STATUS.channel.subscribers).toLocaleString("en-IN")} subs`
      : "";
    chip.className = "chip chip-ok";
    chip.textContent = `● ${name}${subs}`;
    $("#disconnect-btn").classList.remove("hidden");
  } else {
    chip.className = "chip chip-muted";
    chip.textContent = STATUS.setup.clientConfigured ? "Channel not connected" : "OAuth setup needed";
    $("#disconnect-btn").classList.add("hidden");
  }
  $("#logout-btn").classList.toggle("hidden", !STATUS.setup.passwordProtected);
}

function renderStats() {
  const s = STATUS.stats;
  $("#stat-today").textContent = `${s.publishedToday} / ${s.videosPerDay}`;
  $("#stat-queued").textContent = s.queued + s.uploading;
  $("#stat-published").textContent = s.published;
  $("#stat-failed-foot").textContent = `failed: ${s.failed} · uploading: ${s.uploading}`;
  $("#stat-next").textContent = s.nextPublishAt ? fmtDate(s.nextPublishAt) : "—";
  $("#stat-next-file").textContent = s.nextFile || (s.queued ? "" : "queue khaali hai");
  $("#tz-label").textContent = `Time zone: ${s.timezone} · slots: ${s.slots.join(", ")}`;
}

function renderSetup() {
  const banner = $("#setup-banner");
  const body = $("#setup-body");
  const setup = STATUS.setup;
  let title = "";
  let sub = "";
  let html = "";

  if (!setup.clientConfigured) {
    title = "Step 1 — Google Cloud credentials chahiye";
    sub = "Ye ek baar karna hota hai (5 minute).";
    html = `
      <ol class="steps">
        <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud</a> par naya project banao.</li>
        <li><b>APIs &amp; Services → Library</b> me <b>YouTube Data API v3</b> aur <b>Google Drive API</b> enable karo.</li>
        <li><b>OAuth consent screen</b> → External → apna email test user me add karo.</li>
        <li><b>Credentials → Create credentials → OAuth client ID → Web application</b>.</li>
        <li>Authorized redirect URI me ye exact URL daalo:</li>
      </ol>
      <div class="copy-row">
        <input id="redirect-uri" readonly value="${esc(setup.redirectUri)}" />
        <button class="btn" type="button" data-action="copy-redirect">Copy</button>
      </div>
      <ol class="steps" start="6">
        <li>Client ID aur Client Secret ko <code>yt-autopilot/.env</code> me daalo:
          <br /><code>GOOGLE_CLIENT_ID=...</code><br /><code>GOOGLE_CLIENT_SECRET=...</code></li>
        <li>Server restart karo — phir yahan <b>Connect YouTube</b> button aa jayega.</li>
      </ol>`;
    banner.classList.remove("hidden");
  } else if (!STATUS.connected) {
    title = "Step 2 — Apna YouTube channel connect karo";
    sub = "Upload + Drive read permission maangi jayegi.";
    html = `
      <div class="row" style="margin-top:4px">
        <a class="btn btn-primary" href="/api/google/connect" target="_blank" rel="noopener">Connect YouTube + Drive</a>
        <span class="muted small">Google account jisme channel hai wahi choose karo.</span>
      </div>
      <p class="muted small" style="margin:10px 0 0">
        Button naye tab me khulega — Google login iframe ke andar kaam nahi karta, is liye
        naya tab aana zaroori hai. Agar phir bhi Google par error aaye to dashboard ko apne
        browser ke normal tab me kholo (ya localhost par chalao) aur wahan se Connect dabao.
      </p>`;
    banner.classList.remove("hidden");
  } else if (!setup.passwordProtected) {
    title = "Security warning — APP_PASSWORD set nahi hai";
    sub = "Dashboard par aapka YouTube access token save hai.";
    html = `<p class="muted small" style="margin:6px 0 0">
      Public hosting se pehle <code>APP_PASSWORD</code> (aur <code>SESSION_SECRET</code>) .env me set karo,
      warna jo bhi URL kholega wo aapke channel par upload kar sakta hai.</p>`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  if (title) {
    $("#setup-title").textContent = title;
    $("#setup-sub").textContent = sub;
    body.innerHTML = html;
  }
}

function statusBadge(item) {
  const label =
    item.status === "uploading"
      ? `uploading ${item.progress || 0}%`
      : item.status === "published" && item.publishAt && new Date(item.publishAt) > new Date()
        ? "scheduled"
        : item.status;
  return `<span class="badge badge-${esc(item.status)}">${esc(label)}</span>`;
}

function renderQueue() {
  const body = $("#queue-body");
  const empty = $("#queue-empty");
  if (!QUEUE.length) {
    body.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  body.innerHTML = QUEUE.map((item) => {
    const meta = [item.fileName, bytes(item.sizeBytes)].filter(Boolean).join(" · ");
    const actions = [];

    actions.push(
      `<button class="btn btn-sm" type="button" data-action="edit" data-id="${item.id}">Edit</button>`,
    );

    if (item.status === "queued") {
      actions.push(
        `<button class="btn btn-sm btn-primary" type="button" data-action="publish" data-id="${item.id}">Publish now</button>`,
      );
    }
    if (item.status === "failed") {
      actions.push(
        `<button class="btn btn-sm btn-primary" type="button" data-action="retry" data-id="${item.id}">Retry</button>`,
      );
    }
    if (item.status === "published" && item.youtubeUrl) {
      actions.push(
        `<a class="btn btn-sm" href="${esc(item.youtubeUrl)}" target="_blank" rel="noreferrer">Open</a>`,
      );
    }
    actions.push(
      `<button class="btn btn-sm btn-danger" type="button" data-action="delete" data-id="${item.id}">✕</button>`,
    );

    const progress =
      item.status === "uploading"
        ? `<div class="progress"><i style="width:${Math.max(2, item.progress || 0)}%"></i></div>`
        : "";
    const error =
      item.status === "failed" && item.error
        ? `<div class="err-line" title="${esc(item.error)}">${esc(item.error)}</div>`
        : "";

    return `<tr>
      <td class="cell-title">
        <strong title="${esc(item.title)}">${esc(item.title)}</strong>
        <span title="${esc(meta)}">${esc(meta)}</span>
        ${progress}${error}
      </td>
      <td>
        ${esc(fmtDate(item.publishAt))}
        <div class="muted small">${esc(relative(item.publishAt))}</div>
      </td>
      <td>${statusBadge(item)}</td>
      <td class="right"><div class="row-actions">${actions.join("")}</div></td>
    </tr>`;
  }).join("");
}

function renderLogs(logs) {
  const list = $("#log-list");
  if (!logs?.length) {
    list.innerHTML = `<li class="muted">Abhi koi activity nahi hai.</li>`;
    return;
  }
  list.innerHTML = logs
    .map(
      (entry) => `<li>
        <span class="log-time">${esc(fmtDate(entry.at))}</span>
        <span class="log-level level-${esc(entry.level)}">${esc(entry.level)}</span>
        <span>${esc(entry.message)}</span>
      </li>`,
    )
    .join("");
}

function fillSettingsForm() {
  const s = STATUS.settings;
  $("#s-perday").value = s.videosPerDay;
  $("#s-slots").value = (s.slots || []).join(", ");
  $("#s-privacy").value = s.privacy;
  $("#s-lead").value = s.uploadLeadMinutes;
  $("#s-region").value = s.regionCode || "IN";
  $("#s-niche").value = s.niche || "";
  $("#s-tagpool").value = s.tagPool || "";
  $("#s-desc").value = s.descriptionTemplate || "";
  $("#s-ai").checked = Boolean(s.aiTitles);
  settingsFilled = true;

  const select = $("#s-category");
  const categories = STATUS.setup.categories || [];
  select.innerHTML = categories
    .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
    .join("");
  select.value = s.categoryId;
}

/* -------------------------------- loading ------------------------------- */

async function loadStatus() {
  STATUS = await api("/api/status");
  renderChannel();
  renderStats();
  renderSetup();
  renderLogs(STATUS.logs);
  // Poll settings form ko overwrite na kare jab user type kar raha ho.
  if (!settingsFilled) {
    fillSettingsForm();
    settingsFilled = true;
  }
}

async function loadQueue() {
  const data = await api("/api/queue");
  QUEUE = data.items || [];
  renderQueue();
}

async function refreshAll() {
  try {
    await Promise.all([loadStatus(), loadQueue()]);
  } catch (error) {
    toast(error.message, true);
  }
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const busy = QUEUE.some((item) => item.status === "uploading");
  pollTimer = setTimeout(refreshAll, busy ? 4000 : 20000);
}

/* -------------------------------- actions ------------------------------- */

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    $(`#panel-${tab.dataset.tab}`).classList.add("active");
    return;
  }

  const goto = event.target.closest("[data-goto]");
  if (goto) {
    document.querySelector(`[data-tab="${goto.dataset.goto}"]`)?.click();
    return;
  }

  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const { action, id } = trigger.dataset;

  if (action === "copy-redirect") {
    const value = $("#redirect-uri")?.value || "";
    try {
      await navigator.clipboard.writeText(value);
      toast("Redirect URI copy ho gaya.");
    } catch {
      $("#redirect-uri")?.select();
      toast("Copy nahi hua — manually select karke copy karo.", true);
    }
    return;
  }

  const item = QUEUE.find((i) => i.id === id);

  if (action === "edit" && item) return openModal(item);

  if (action === "publish" && item) {
    if (!confirm(`"${item.title}" abhi publish karna hai?`)) return;
    trigger.disabled = true;
    try {
      await api(`/api/queue/${id}/publish-now`, { method: "POST" });
      toast("Publish shuru ho gaya — log me progress dekho.");
      refreshAll();
    } catch (error) {
      toast(error.message, true);
      trigger.disabled = false;
    }
    return;
  }

  if (action === "retry" && item) {
    trigger.disabled = true;
    try {
      await api(`/api/queue/${id}/retry`, { method: "POST" });
      toast("Retry queue me daal diya.");
      refreshAll();
    } catch (error) {
      toast(error.message, true);
      trigger.disabled = false;
    }
    return;
  }

  if (action === "delete" && item) {
    if (!confirm(`Queue se "${item.fileName}" hata dena hai?`)) return;
    try {
      await api(`/api/queue/${id}`, { method: "DELETE" });
      toast("Item hata diya.");
      refreshAll();
    } catch (error) {
      toast(error.message, true);
    }
  }
});

/* --------------------------------- add ---------------------------------- */

$("#add-btn").addEventListener("click", async () => {
  const input = $("#add-input").value.trim();
  if (!input) return toast("Pehle Drive link daalo.", true);

  const btn = $("#add-btn");
  btn.disabled = true;
  $("#add-hint").textContent = "Drive check ho raha hai, title/tags ban rahe hain...";
  $("#add-result").classList.add("hidden");

  try {
    const data = await api("/api/queue", { method: "POST", body: JSON.stringify({ input }) });
    const problemText = data.problems?.length ? `\n\nSkipped:\n- ${data.problems.join("\n- ")}` : "";
    const result = $("#add-result");
    result.className = "result";
    result.textContent = `${data.added} video queue me add hua — title, description aur tags auto bhar gaye.${problemText}`;
    result.classList.remove("hidden");
    $("#add-input").value = "";
    toast(`${data.added} video add hua.`);
    refreshAll();
  } catch (error) {
    const result = $("#add-result");
    result.className = "result result-error";
    result.textContent = error.message;
    result.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    $("#add-hint").textContent = "";
  }
});

/* ------------------------------- settings ------------------------------- */

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    videosPerDay: Number($("#s-perday").value),
    slots: $("#s-slots")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    privacy: $("#s-privacy").value,
    categoryId: $("#s-category").value,
    uploadLeadMinutes: Number($("#s-lead").value),
    regionCode: $("#s-region").value.trim().toUpperCase() || "IN",
    niche: $("#s-niche").value,
    tagPool: $("#s-tagpool").value,
    descriptionTemplate: $("#s-desc").value,
    aiTitles: $("#s-ai").checked,
  };

  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
    $("#settings-msg").textContent = "Save ho gaya ✓";
    toast("Settings save ho gayi.");
    refreshAll();
    setTimeout(() => ($("#settings-msg").textContent = ""), 3000);
  } catch (error) {
    toast(error.message, true);
  }
});

$("#disconnect-btn").addEventListener("click", async () => {
  if (!confirm("YouTube disconnect karna hai? Auto-publish ruk jayega.")) return;
  await api("/api/google/disconnect", { method: "POST" });
  toast("Disconnect ho gaya.");
  refreshAll();
});

$("#logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

$("#refresh-btn").addEventListener("click", () => refreshAll());

/* -------------------------------- modal --------------------------------- */

function openModal(item) {
  EDITING = item;
  $("#modal-title").textContent = "Video edit";
  $("#modal-file").textContent = `${item.fileName}${item.sizeBytes ? ` · ${bytes(item.sizeBytes)}` : ""}`;
  $("#m-title").value = item.title;
  $("#m-tags").value = (item.tags || []).join(", ");
  $("#m-desc").value = item.description || "";
  $("#m-publish").value = isoToLocalInput(item.publishAt);
  $("#m-privacy").value = item.privacy || "public";
  $("#title-count").textContent = item.title.length;
  $("#modal-error").classList.add("hidden");

  const yt = $("#m-youtube");
  if (item.youtubeUrl) {
    yt.href = item.youtubeUrl;
    yt.classList.remove("hidden");
  } else {
    yt.classList.add("hidden");
  }

  $("#modal").classList.remove("hidden");
}

function closeModal() {
  $("#modal").classList.add("hidden");
  EDITING = null;
}

$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (event) => {
  if (event.target === $("#modal")) closeModal();
});
$("#m-title").addEventListener("input", (event) => {
  $("#title-count").textContent = event.target.value.length;
});

$("#m-save").addEventListener("click", async () => {
  if (!EDITING) return;
  const publishAt = localInputToIso($("#m-publish").value);
  if (!publishAt) return toast("Publish time galat hai.", true);

  const btn = $("#m-save");
  btn.disabled = true;
  try {
    await api(`/api/queue/${EDITING.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: $("#m-title").value,
        tags: $("#m-tags").value,
        description: $("#m-desc").value,
        publishAt,
        privacy: $("#m-privacy").value,
      }),
    });
    toast("Save ho gaya.");
    closeModal();
    refreshAll();
  } catch (error) {
    $("#modal-error").textContent = error.message;
    $("#modal-error").classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
});

$("#m-regenerate").addEventListener("click", async () => {
  if (!EDITING) return;
  const btn = $("#m-regenerate");
  btn.disabled = true;
  btn.textContent = "Generating...";
  try {
    const data = await api(`/api/queue/${EDITING.id}/regenerate`, { method: "POST" });
    $("#m-title").value = data.item.title;
    $("#m-tags").value = (data.item.tags || []).join(", ");
    $("#m-desc").value = data.item.description || "";
    $("#title-count").textContent = data.item.title.length;
    toast(`Naya title/tags ban gaya (${data.item.metadataSource}).`);
    refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "↻ Auto title/tags dobara";
  }
});

/* --------------------------------- init --------------------------------- */

(async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("connected")) toast("YouTube connect ho gaya 🎉");
  if (params.get("connect_error")) toast(params.get("connect_error"), true);
  if (params.toString()) window.history.replaceState({}, "", "/");

  await refreshAll();
})();

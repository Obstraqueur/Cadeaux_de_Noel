// Petits outils d'interface : HTML échappé, icônes, avatars, messages, confirmation.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

// html`<p>${valeur}</p>` : les valeurs sont échappées, sauf raw(...) et les tableaux de raw.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join("");
    else if (v === false || v === null || v === undefined) out += "";
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

const ICONS = {
  gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  bag: '<path d="M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 16h.01M12 12h.01M16 8h.01M8 16h.01"/>',
  star: '<path d="m12 2 2.9 6.6 7.1.6-5.4 4.7 1.6 7.1L12 17.3 5.8 21l1.6-7.1L2 9.2l7.1-.6z"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.4-9.3C1.2 8.2 3.5 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.7 1.2-1.6 2.8-2.7 4.8-2.7 3.7 0 6 3.7 4.6 7.2C19.5 16.4 12 21 12 21z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  "eye-off": '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.2M6.6 6.6C4.4 8 2.9 10.1 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/>',
  "arrow-left": '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  snow: '<path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9M9 3l3 3 3-3M9 21l3-3 3 3M3 9l3 3-3 3M21 9l-3 3 3 3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  user: '<path d="M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};

export const icon = (name, cls = "") =>
  raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`);

export function initials(name) {
  return (name || "?").replace(/-/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}
export function hue(name) {
  let h = 0;
  [...(name || "")].forEach((c, i) => { h += c.charCodeAt(0) * (i + 1); });
  return h % 360;
}
export const avatar = (m, size = "md") =>
  raw(`<span class="avatar avatar--${size}" style="--h:${hue(m?.name)}" aria-hidden="true">${esc(initials(m?.name))}</span>`);

export const plural = (n, one, many) => `${n} ${n <= 1 ? one : (many || one + "s")}`;

export function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function frDate(d, opts = { day: "numeric", month: "long" }) {
  const date = typeof d === "string" ? new Date(d + "T12:00:00") : d;
  return date.toLocaleDateString("fr-FR", opts);
}

// ---------- messages
export function toast(text, kind = "ok") {
  const box = document.querySelector(".toasts");
  if (!box || !text) return;
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 350); }, kind === "error" ? 5000 : 2800);
}

// ---------- confirmation
export function confirmBox(question, okLabel = "Supprimer") {
  const dialog = document.getElementById("confirm-dialog");
  return new Promise((resolve) => {
    if (!dialog?.showModal) return resolve(window.confirm(question));
    dialog.querySelector(".confirm__text").textContent = question;
    dialog.querySelector('[value="ok"]').textContent = okLabel;
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    dialog.showModal();
  });
}

// ---------- formulaires
export function field({ name, label, type = "text", value = "", placeholder = "", help = "", required = false, attrs = "" }) {
  const id = "f-" + name + "-" + Math.random().toString(36).slice(2, 7);
  if (type === "checkbox") {
    return html`<div class="field field--check"><label><input type="checkbox" name="${name}" ${raw(value ? "checked" : "")} ${raw(attrs)}> <span>${label}</span></label></div>`;
  }
  const input = type === "textarea"
    ? html`<textarea class="input" id="${id}" name="${name}" rows="2" placeholder="${placeholder}" ${raw(attrs)}>${value}</textarea>`
    : html`<input class="input" id="${id}" type="${type}" name="${name}" value="${value}" placeholder="${placeholder}" ${raw(required ? "required" : "")} ${raw(attrs)}>`;
  return html`<div class="field field--${name}"><label for="${id}">${label}</label>${input}${help ? html`<p class="field__help">${help}</p>` : ""}</div>`;
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

// Bouton occupé pendant une action
export async function busy(el, fn) {
  if (el) { el.disabled = true; el.classList.add("is-busy"); }
  try { return await fn(); }
  finally { if (el) { el.disabled = false; el.classList.remove("is-busy"); } }
}

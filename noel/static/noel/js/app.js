/* Cadeaux de Noël : petites interactions (toasts, confirmation, neige, copie). */
(function () {
  "use strict";

  /* ---------- toasts ---------- */
  const toasts = document.querySelector(".toasts");
  function dismiss(el, delay) {
    setTimeout(() => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 350);
    }, delay);
  }
  function showToast(text, kind) {
    if (!toasts || !text) return;
    const el = document.createElement("div");
    el.className = "toast toast--" + (kind || "ok");
    el.textContent = text;
    toasts.appendChild(el);
    dismiss(el, 2600);
  }
  document.querySelectorAll(".toast").forEach((t) => dismiss(t, 4200));
  document.body.addEventListener("toast", (e) => showToast(e.detail.text, e.detail.kind));

  /* Erreurs réseau / serveur pendant une action HTMX */
  document.body.addEventListener("htmx:responseError", (e) => {
    const s = e.detail.xhr.status;
    showToast(s === 403 ? "Action non autorisée." : "Oups, l'action n'a pas abouti. Réessayez.", "error");
  });
  document.body.addEventListener("htmx:sendError", () => showToast("Pas de connexion internet.", "error"));

  /* ---------- confirmation (remplace la boîte native) ---------- */
  const dialog = document.getElementById("confirm-dialog");
  function ask(question) {
    return new Promise((resolve) => {
      if (!dialog || !dialog.showModal) return resolve(window.confirm(question));
      dialog.querySelector(".confirm__text").textContent = question;
      dialog.returnValue = "";
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      dialog.showModal();
    });
  }
  document.body.addEventListener("htmx:confirm", (e) => {
    if (!e.detail.question) return;
    e.preventDefault();
    ask(e.detail.question).then((ok) => ok && e.detail.issueRequest(true));
  });
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!form.dataset.confirm || form.dataset.confirmed) return;
    e.preventDefault();
    ask(form.dataset.confirm).then((ok) => {
      if (ok) { form.dataset.confirmed = "1"; form.requestSubmit ? form.requestSubmit() : form.submit(); }
    });
  });

  /* ---------- formulaire d'ajout : on vide et on garde le focus ---------- */
  document.body.addEventListener("idea-added", () => {
    const form = document.getElementById("idea-form");
    if (!form) return;
    form.reset();
    const first = form.querySelector("input[type=text], textarea");
    if (first) first.focus();
  });

  /* ---------- menu compte : fermer en cliquant ailleurs ---------- */
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.menu[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });

  /* ---------- copier un lien ---------- */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const input = document.querySelector(btn.dataset.copy);
    if (!input) return;
    const done = () => showToast("Lien copié");
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); });
    else { input.select(); document.execCommand("copy"); done(); }
  });

  /* ---------- tout cocher ---------- */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-check-all]");
    if (!btn) return;
    const boxes = [...document.querySelectorAll(`input[name="${btn.dataset.checkAll}"]`)];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !all));
  });

  /* ---------- calendrier de l'Avent ---------- */
  const adventData = document.getElementById("advent-data");
  const adventView = document.getElementById("advent-view");
  if (adventData && adventView) {
    const days = JSON.parse(adventData.textContent);
    let cur = -1;
    const show = (i) => {
      const d = days[i];
      if (!d) return;
      cur = i;
      adventView.querySelector(".advent-view__title").textContent = d.title;
      const body = adventView.querySelector(".advent-view__body");
      body.innerHTML = "";
      if (d.img) { const im = new Image(); im.src = d.img; im.alt = d.title; body.appendChild(im); }
      if (d.text) { const p = document.createElement("p"); p.className = "advent-view__text"; p.textContent = d.text; body.appendChild(p); }
      const prev = days.slice(0, i).some(Boolean), next = days.slice(i + 1).some(Boolean);
      adventView.querySelector('[data-advent-nav="-1"]').disabled = !prev;
      adventView.querySelector('[data-advent-nav="1"]').disabled = !next;
      try { localStorage.setItem("avent-" + location.pathname + "-" + i, "1"); } catch (_) {}
      const door = document.querySelector(`[data-advent-open="${i}"]`);
      if (door) door.closest(".door").classList.add("door--seen");
      if (!adventView.open) adventView.showModal();
    };
    document.querySelectorAll("[data-advent-open]").forEach((b) => {
      const i = +b.dataset.adventOpen;
      try { if (localStorage.getItem("avent-" + location.pathname + "-" + i)) b.closest(".door").classList.add("door--seen"); } catch (_) {}
      b.addEventListener("click", () => show(i));
    });
    adventView.querySelectorAll("[data-advent-nav]").forEach((b) => b.addEventListener("click", () => {
      const step = +b.dataset.adventNav;
      for (let j = cur + step; j >= 0 && j < days.length; j += step) if (days[j]) return show(j);
    }));
    adventView.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") adventView.querySelector('[data-advent-nav="-1"]').click();
      if (e.key === "ArrowRight") adventView.querySelector('[data-advent-nav="1"]').click();
    });
    adventView.addEventListener("click", (e) => { if (e.target === adventView) adventView.close(); });
  }

  /* ---------- neige (discrète, coupable, absente si mouvement réduit) ---------- */
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let snowOn = true;
  try { snowOn = localStorage.getItem("snow") !== "off"; } catch (_) {}
  if (reduce) snowOn = false;
  document.documentElement.dataset.snow = snowOn ? "on" : "off";

  const canvases = [...document.querySelectorAll("canvas.snow")];
  const flakes = new Map();
  let raf = null;

  function setup(c) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = r.width * dpr; c.height = r.height * dpr;
    const n = Math.round(r.width / 28);
    flakes.set(c, Array.from({ length: n }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height,
      r: (Math.random() * 1.6 + .6) * dpr, s: (Math.random() * .35 + .15) * dpr, d: Math.random() * Math.PI * 2,
    })));
  }
  function frame() {
    canvases.forEach((c) => {
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      (flakes.get(c) || []).forEach((f) => {
        f.y += f.s; f.d += .01; f.x += Math.sin(f.d) * .25;
        if (f.y > c.height + 4) { f.y = -4; f.x = Math.random() * c.width; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      });
    });
    raf = requestAnimationFrame(frame);
  }
  function start() { if (raf || !canvases.length) return; canvases.forEach(setup); frame(); }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    canvases.forEach((c) => c.getContext("2d").clearRect(0, 0, c.width, c.height));
  }
  if (snowOn) start();
  window.addEventListener("resize", () => { if (raf) canvases.forEach(setup); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else if (snowOn) start(); });

  document.querySelectorAll("[data-snow-toggle]").forEach((b) => b.addEventListener("click", () => {
    snowOn = !snowOn;
    document.documentElement.dataset.snow = snowOn ? "on" : "off";
    try { localStorage.setItem("snow", snowOn ? "on" : "off"); } catch (_) {}
    snowOn ? start() : stop();
    showToast(snowOn ? "Neige activée" : "Neige coupée");
  }));
})();

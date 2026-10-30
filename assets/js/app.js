// Cadeaux de Noël — application (pages statiques + Supabase).
import { SUPABASE_URL, SUPABASE_KEY, LINK_PREVIEW } from "./config.js";
import { html, raw, esc, icon, avatar, plural, domain, frDate, toast, confirmBox, field, formData, busy } from "./ui.js";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cadeaux-de-noel" },
});
const main = document.getElementById("main");
const topbar = document.getElementById("topbar");
const UUID = "([0-9a-f-]{36})";

const parisParts = () => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
const todayStr = () => { const p = parisParts(); return `${p.year}-${p.month}-${p.day}`; };
const SEASON = +parisParts().year;

const state = { session: null, handlers: {}, inputs: {} };

// ============================================================================ données
async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message || "Erreur");
  return data;
}
async function q(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || "Erreur");
  return data;
}
const one = (x) => (Array.isArray(x) ? x[0] || null : x || null);

async function loadFamily(famId) {
  const [family, members, households, managers] = await Promise.all([
    q(sb.from("families").select("*").eq("id", famId).maybeSingle()),
    q(sb.from("members").select("*").eq("family_id", famId).order("name")),
    q(sb.from("households").select("*").eq("family_id", famId).order("name")),
    q(sb.from("member_managers").select("*")),
  ]);
  if (!family) throw new Error("Vous ne faites pas partie de cette famille.");
  const me = members.find((m) => m.user_id === state.session.user.id);
  if (!me) throw new Error("Vous ne faites pas partie de cette famille.");
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const houseById = Object.fromEntries(households.map((h) => [h.id, h]));
  const managersOf = (mid) => new Set(managers.filter((x) => x.member_id === mid).map((x) => x.user_id));
  const managed = members.filter((m) => m.id !== me.id && managersOf(m.id).has(state.session.user.id));
  return { family, members, households, me, byId, houseById, managersOf, managed, isAdmin: me.is_admin };
}

function isSurprise(idea, ctx) {
  if (!idea.author_id) return true;
  if (idea.author_id === idea.recipient_id) return false;
  const author = ctx.byId[idea.author_id];
  return !(author?.user_id && ctx.managersOf(idea.recipient_id).has(author.user_id));
}
const canEditList = (mid, ctx) => ctx.byId[mid]?.user_id === state.session.user.id || ctx.managersOf(mid).has(state.session.user.id);
const canEditIdea = (i, ctx) => ctx.isAdmin || i.author_id === ctx.me.id || (canEditList(i.recipient_id, ctx) && !isSurprise(i, ctx));

function normUrl(url) {
  url = (url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}
async function linkPreview(url) {
  if (!LINK_PREVIEW || !url) return "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch("https://api.microlink.io/?url=" + encodeURIComponent(url), { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    return j?.data?.image?.url || "";
  } catch { return ""; }
}

// ============================================================================ routes
const routes = [
  [/^#\/connexion$/, viewLogin, true],
  [/^#\/invitation\/([^/?]+)$/, viewInvite, true],
  [/^#\/compte$/, viewAccount],
  [new RegExp(`^#/f/${UUID}$`), viewFamily],
  [new RegExp(`^#/f/${UUID}/p/${UUID}$`), viewMember],
  [new RegExp(`^#/f/${UUID}/achats$`), viewPurchases],
  [new RegExp(`^#/f/${UUID}/amis-secrets$`), viewDraws],
  [new RegExp(`^#/f/${UUID}/avent$`), viewAdvent],
  [new RegExp(`^#/f/${UUID}/avent/gestion$`), viewAdventManage],
  [new RegExp(`^#/f/${UUID}/gestion$`), viewManage],
  [/^#\/?(\?.*)?$/, viewHome],
];

const go = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };

let routing = 0;
async function router({ keepScroll = false } = {}) {
  const run = ++routing;
  const hash = location.hash || "#/";
  const route = routes.find(([re]) => re.test(hash.split("?")[0] === "#" ? "#/" : hash));
  if (!route) return go("#/");
  const [re, view, isPublic] = route;
  if (!state.session && !isPublic) {
    try { sessionStorage.setItem("apres-connexion", hash); } catch {}
    return go("#/connexion");
  }
  const params = (hash.match(re) || []).slice(1);
  const y = window.scrollY;
  state.handlers = {}; state.inputs = {};
  try {
    const out = await view(...params);
    if (run !== routing || out === undefined) return;
    const paint = () => { main.innerHTML = String(out); if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0); afterPaint(); };
    if (document.startViewTransition && !keepScroll && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(paint);
    else paint();
  } catch (e) {
    if (run !== routing) return;
    main.innerHTML = String(html`<div class="empty" style="margin-top:40px"><p><strong>${e.message}</strong></p>
      <a class="btn btn--primary" href="#/">Retour à l'accueil</a></div>`);
  }
}
const refresh = () => router({ keepScroll: true });

let afterPaintHooks = [];
function afterPaint() { const hooks = afterPaintHooks; afterPaintHooks = []; hooks.forEach((f) => f()); }
const onPaint = (f) => afterPaintHooks.push(f);

// Délégation d'événements : data-act="nom" (clic), data-form="nom" (envoi), data-input="nom" (saisie)
main.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !main.contains(el)) return;
  const fn = state.handlers[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  if (el.dataset.confirm && !(await confirmBox(el.dataset.confirm, el.dataset.confirmOk || "Supprimer"))) return;
  try { await busy(el, () => fn(el, e)); } catch (err) { toast(err.message, "error"); }
});
main.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const fn = state.handlers[form.dataset.form];
  if (!fn) return;
  if (form.dataset.confirm && !(await confirmBox(form.dataset.confirm, form.dataset.confirmOk || "Confirmer"))) return;
  const btn = e.submitter || form.querySelector("[type=submit]");
  try { await busy(btn, () => fn(form, e)); } catch (err) { toast(err.message, "error"); }
});
let inputTimer;
main.addEventListener("input", (e) => {
  const el = e.target.closest("[data-input]");
  if (!el) return;
  const fn = state.inputs[el.dataset.input];
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => fn && fn(el).catch((err) => toast(err.message, "error")), 250);
});

// ============================================================================ en-tête
function renderTopbar(ctx, section = "") {
  if (!state.session) { topbar.hidden = true; document.body.classList.add("auth"); return; }
  document.body.classList.remove("auth");
  topbar.hidden = false;
  const f = ctx?.family, me = ctx?.me;
  const tab = (href, ic, label, key) =>
    html`<a href="${href}" ${raw(section === key ? 'aria-current="page"' : "")}>${icon(ic)}<span>${label}</span></a>`;
  document.getElementById("topbar-inner").innerHTML = String(html`
    <a class="brand" href="${f ? `#/f/${f.id}` : "#/"}"><img src="assets/icon.svg" alt="" width="30" height="30"><span>${f ? f.name : "Cadeaux de Noël"}</span></a>
    ${f ? html`<nav class="tabs" aria-label="Navigation principale">
      ${tab(`#/f/${f.id}`, "home", "Accueil", "family")}
      ${tab(`#/f/${f.id}/p/${me.id}`, "list", "Ma liste", "mine")}
      ${tab(`#/f/${f.id}/achats`, "bag", "À acheter", "purchases")}
      ${tab(`#/f/${f.id}/amis-secrets`, "dice", "Amis secrets", "draws")}
      ${tab(`#/f/${f.id}/avent`, "star", "Avent", "advent")}
    </nav>` : ""}
    <div class="topbar__tools">
      <button class="iconbtn" type="button" data-snow-toggle title="Neige" aria-label="Activer ou couper la neige">${icon("snow")}</button>
      <details class="menu">
        <summary class="iconbtn" aria-label="Mon compte">${icon("user")}</summary>
        <div class="menu__panel">
          ${f ? html`<a href="#/f/${f.id}/avent">${icon("star")} Calendrier de l'Avent</a>` : ""}
          ${me?.is_admin ? html`<a href="#/f/${f.id}/gestion">${icon("settings")} Gérer la famille</a>` : ""}
          <a href="#/compte">${icon("user")} Mon compte</a>
          <a href="#/?toutes">${icon("users")} Mes familles</a>
          <button type="button" data-logout>${icon("logout")} Se déconnecter</button>
        </div>
      </details>
    </div>`);
  snow.attach();
}
topbar.addEventListener("click", async (e) => {
  if (e.target.closest("[data-logout]")) { await sb.auth.signOut(); go("#/connexion"); }
  if (e.target.closest("[data-snow-toggle]")) snow.toggle();
  if (e.target.closest(".menu__panel a")) e.target.closest("details").open = false;
});
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.menu[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});

// ============================================================================ connexion & invitation
function authCard(title, sub, body) {
  renderTopbar(null);
  topbar.hidden = true;
  document.body.classList.add("auth");
  return html`<div class="authcard"><canvas class="snow" aria-hidden="true"></canvas>
    <div class="authcard__head"><img src="assets/icon.svg" alt="" width="56" height="56">
      <h1 class="authcard__title">${title}</h1><p class="authcard__sub">${sub}</p></div>
    <div class="authcard__body">${body}</div></div>`;
}
const afterLogin = () => {
  let next = "#/";
  try { next = sessionStorage.getItem("apres-connexion") || "#/"; sessionStorage.removeItem("apres-connexion"); } catch {}
  go(next);
};
async function signIn(username, password) {
  const email = await rpc("login_email", { p_username: username });
  if (!email) throw new Error("Prénom inconnu. Vérifiez l'orthographe ou demandez le lien d'invitation.");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Mot de passe incorrect.");
}

async function viewLogin() {
  if (state.session) { afterLogin(); return; }
  state.handlers.login = async (form) => {
    const d = formData(form);
    await signIn(d.username, d.password);
  };
  onPaint(() => { snow.attach(); main.querySelector("input")?.focus(); });
  return authCard("Cadeaux de Noël", "La liste au Père Noël de toute la famille.", html`
    <form data-form="login" class="stack">
      ${field({ name: "username", label: "Prénom", required: true, attrs: 'autocomplete="username" autocapitalize="words"' })}
      ${field({ name: "password", label: "Mot de passe", type: "password", required: true, attrs: 'autocomplete="current-password"' })}
      <button class="btn btn--primary btn--block" type="submit">Se connecter</button>
    </form>
    <p class="authcard__foot">Pas encore de compte ? Ouvrez le lien d'invitation envoyé par l'organisateur de votre famille.<br>
    Mot de passe oublié ? L'organisateur peut vous en donner un provisoire.</p>`);
}

async function viewInvite(code) {
  const info = await rpc("invite_info", { p_code: code });
  if (!info) return authCard("Lien inconnu", "Ce lien d'invitation n'existe pas ou a été renouvelé.",
    html`<a class="btn btn--primary btn--block" href="#/connexion">Aller à la connexion</a>`);
  const claimSelect = info.profiles.length ? html`<div class="field"><label for="claim">Je suis déjà sur le site</label>
    <select class="input" id="claim" name="claim"><option value="">— Non, je suis nouveau —</option>
      ${info.profiles.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
    <p class="field__help">Choisissez votre prénom pour retrouver votre liste et vos idées des années passées.</p></div>` : "";
  if (state.session) {
    state.handlers.join = async (form) => {
      const fam = await rpc("join_family", { p_code: code, p_claim: formData(form).claim || null });
      toast(`Bienvenue dans ${info.family} !`);
      go(`#/f/${fam}`);
    };
    return authCard(`Rejoindre ${info.family}`, "Vous êtes déjà connecté.", html`
      <form data-form="join" class="stack">${claimSelect}<button class="btn btn--primary btn--block">Rejoindre ${info.family}</button></form>`);
  }
  state.handlers.signup = async (form) => {
    const d = formData(form);
    if (d.password !== d.password2) throw new Error("Les deux mots de passe ne sont pas identiques.");
    await rpc("create_account", { p_code: code, p_username: d.username, p_password: d.password, p_claim: d.claim || null });
    await signIn(d.username, d.password);
    toast("Compte créé ! Bienvenue 🎄");
  };
  state.handlers.gologin = () => { try { sessionStorage.setItem("apres-connexion", location.hash); } catch {} go("#/connexion"); };
  onPaint(() => snow.attach());
  return authCard(`Rejoindre ${info.family}`, "Créez votre compte en quelques secondes.", html`
    <form data-form="signup" class="stack">
      ${claimSelect}
      ${field({ name: "username", label: "Prénom", required: true, help: "C'est ce que vous taperez pour vous connecter.", attrs: 'autocomplete="username" autocapitalize="words"' })}
      ${field({ name: "password", label: "Mot de passe", type: "password", required: true, help: "Au moins 6 caractères.", attrs: 'minlength="6" autocomplete="new-password"' })}
      ${field({ name: "password2", label: "Confirmation", type: "password", required: true, attrs: 'minlength="6" autocomplete="new-password"' })}
      <button class="btn btn--primary btn--block" type="submit">Créer mon compte</button>
    </form>
    <p class="authcard__foot">Déjà un compte ? <a href="#" data-act="gologin">Connectez-vous</a> pour rejoindre ${info.family}.</p>`);
}

// ============================================================================ accueil
async function viewHome() {
  const mine = await q(sb.from("members").select("family_id, families(name)").eq("user_id", state.session.user.id));
  if (mine.length === 1 && !location.hash.includes("toutes")) { go(`#/f/${mine[0].family_id}`); return; }
  renderTopbar(null);
  state.handlers.join = async (form) => {
    const code = formData(form).code.trim().split("/").pop();
    const fam = await rpc("join_family", { p_code: code, p_claim: null });
    go(`#/f/${fam}`);
  };
  state.handlers.create = async (form) => {
    const fam = await rpc("create_family", { p_name: formData(form).name });
    toast("Famille créée. Invitez les autres depuis « Gérer la famille ».");
    go(`#/f/${fam}`);
  };
  return html`
    <header class="pagehead"><h1 class="pagehead__title">${mine.length ? "Vos familles" : "Bienvenue"}</h1>
      ${mine.length ? "" : html`<p class="pagehead__sub">Pour commencer, ouvrez le lien d'invitation de votre famille, ou collez-le ci-dessous.</p>`}</header>
    ${mine.length ? html`<section class="block people">${mine.map((m) => html`
      <a class="person" href="#/f/${m.family_id}"><span class="avatar" style="--h:150">${icon("users")}</span><span class="person__name">${m.families?.name}</span></a>`)}</section>` : ""}
    <section class="block panel"><h2 class="block__title">Rejoindre une famille</h2>
      <form data-form="join" class="addline addline--row">${field({ name: "code", label: "Lien ou code d'invitation", required: true })}
        <button class="btn btn--primary">Rejoindre</button></form></section>
    <section class="block panel"><h2 class="block__title">Créer une nouvelle famille</h2>
      <p class="panel__hint">Vous en serez l'organisateur et pourrez inviter les autres.</p>
      <form data-form="create" class="addline addline--row">${field({ name: "name", label: "Nom de la famille", placeholder: "Ex. Famille Jean", required: true })}
        <button class="btn">Créer</button></form></section>`;
}

function daysUntilChristmas() {
  const t = new Date(todayStr() + "T12:00:00");
  let x = new Date(`${t.getFullYear()}-12-25T12:00:00`);
  if (t > x) x = new Date(`${t.getFullYear() + 1}-12-25T12:00:00`);
  return Math.round((x - t) / 86400000);
}

async function viewFamily(famId) {
  const ctx = await loadFamily(famId);
  renderTopbar(ctx, "family");
  const today = todayStr();
  const [ideas, myCount, assigns, resv, advent] = await Promise.all([
    q(sb.from("ideas").select("id, recipient_id, reservations(idea_id)").eq("family_id", famId).eq("archived", false).gte("year", SEASON)),
    rpc("my_count", { p_member: ctx.me.id }),
    q(sb.from("assignments").select("round, giver_id, receiver_id, draws!inner(id, title, budget, year, family_id, created_at)")
      .eq("draws.family_id", famId).eq("draws.year", SEASON)),
    q(sb.from("reservations").select("status, owner_id, reservation_participants(member_id), ideas!inner(family_id, year)")
      .eq("ideas.family_id", famId).gte("ideas.year", SEASON)),
    rpc("advent_calendar", { p_family: famId }),
  ]);
  const counts = {};
  ideas.forEach((i) => {
    const c = (counts[i.recipient_id] ||= { total: 0, free: 0 });
    c.total++; if (!one(i.reservations)) c.free++;
  });
  const mineRes = resv.filter((r) => r.owner_id === ctx.me.id || r.reservation_participants.some((p) => p.member_id === ctx.me.id));
  const todo = mineRes.filter((r) => r.status !== "bought").length;
  const groups = {};
  assigns.forEach((a) => {
    const k = a.draws.id + a.giver_id;
    (groups[k] ||= { draw: a.draws, giver: ctx.byId[a.giver_id], receivers: [] }).receivers.push(ctx.byId[a.receiver_id]);
  });
  const adventToday = advent.find((d) => d.day === today);
  const adventSoon = !adventToday && advent.find((d) => d.day > today);
  const adventUrls = adventToday ? await signedUrls(advent.filter((d) => d.open).flatMap((d) => [d.cover, d.inside])) : {};
  if (adventToday) onPaint(() => setupAdventViewer(advent.map((d) => (d.open
    ? { date: frDate(d.day, { weekday: "long", day: "numeric", month: "long" }), title: d.title, img: adventUrls[d.inside] || "", text: d.text } : null))));
  const days = daysUntilChristmas();
  const others = ctx.members.filter((m) => m.id !== ctx.me.id);
  const person = (m) => {
    const c = counts[m.id] || { total: 0, free: 0 };
    const h = m.household_id && ctx.houseById[m.household_id];
    return html`<a class="person" href="#/f/${famId}/p/${m.id}">${avatar(m)}<span class="person__name">${m.name}</span>
      <span class="person__meta">${c.total ? (c.free ? `${c.free} libre${c.free > 1 ? "s" : ""} sur ${c.total}` : "Tout est pris") : "Pas encore d'idée"}</span>
      ${h ? html`<span class="person__house">${h.name}</span>` : ""}</a>`;
  };
  return html`
    <section class="hello"><h1 class="hello__title">Bonjour ${ctx.me.name}</h1>
      <p class="hello__sub">${days === 0 ? "C'est Noël aujourd'hui 🎄" : days === 1 ? "Noël, c'est demain." :
        days <= 60 ? `Plus que ${days} jours avant Noël.` : `Noël ${SEASON} est dans ${days} jours : le temps de remplir sa liste.`}</p></section>
    <section class="mine">
      <a class="mine__card" href="#/f/${famId}/p/${ctx.me.id}">${avatar(ctx.me, "lg")}
        <span class="mine__text"><strong>Ma liste ${SEASON}</strong>
          <span>${myCount ? `${plural(myCount, "idée")}, bien rangée${myCount > 1 ? "s" : ""} à l'abri de vos yeux.` : "Elle est vide. Dites aux autres ce qui vous ferait plaisir."}</span></span>
        <span class="mine__cta">${myCount ? "Ajouter" : "Commencer"}</span></a>
      ${mineRes.length ? html`<a class="mine__card mine__card--soft" href="#/f/${famId}/achats"><span class="mine__icon">${icon("bag")}</span>
        <span class="mine__text"><strong>À acheter</strong><span>${todo ? `${todo} sur ${mineRes.length} pas encore acheté${todo > 1 ? "s" : ""}` : "Tout est acheté, bravo !"}</span></span></a>` : ""}
      ${adventToday ? html`<div class="advent-home">
          <button type="button" class="advent-home__door" data-advent-open="${advent.indexOf(adventToday)}" aria-label="Ouvrir la case du jour">
            ${adventUrls[adventToday.cover] ? html`<img src="${adventUrls[adventToday.cover]}" alt="">` : doorFace(adventToday)}
          </button>
          <div class="advent-home__text"><strong>Calendrier de l'Avent</strong>
            <span>${adventToday.title || `Case du ${frDate(today)}`}</span>
            <button type="button" class="btn btn--small btn--primary" data-advent-open="${advent.indexOf(adventToday)}">Ouvrir la case du jour</button>
            <a class="linkbtn" href="#/f/${famId}/avent">Voir tout le calendrier</a></div></div>`
        : adventSoon ? html`<a class="mine__card mine__card--advent" href="#/f/${famId}/avent"><span class="mine__icon">${icon("star")}</span>
          <span class="mine__text"><strong>Calendrier de l'Avent</strong><span>Première case le ${frDate(adventSoon.day)}</span></span></a>`
        : !advent.length && ctx.isAdmin ? html`<a class="mine__card mine__card--advent" href="#/f/${famId}/avent/gestion"><span class="mine__icon">${icon("star")}</span>
          <span class="mine__text"><strong>Calendrier de l'Avent ${SEASON}</strong><span>Pas encore prêt : ajoutez les images des cases</span></span>
          <span class="mine__cta">Préparer</span></a>` : ""}
      ${Object.values(groups).map((g) => html`<div class="santa">
        <span class="santa__label">${g.draw.title}${g.giver?.id !== ctx.me.id ? `, pour ${g.giver?.name}` : ""}</span>
        <span class="santa__name">${g.giver?.id === ctx.me.id ? "Vous offrez à" : `${g.giver?.name} offre à`}</span>
        <span class="santa__list">${g.receivers.map((r) => html`<a class="santa__who" href="#/f/${famId}/p/${r.id}">${avatar(r, "sm")} ${r.name}</a>`)}</span>
        ${g.draw.budget ? html`<span class="santa__budget">Budget conseillé : ${g.draw.budget} par cadeau</span>` : ""}</div>`)}
    </section>
    ${ctx.managed.length ? html`<section class="block"><h2 class="block__title">Les listes que vous tenez</h2>
      <div class="people">${ctx.managed.map(person)}</div></section>` : ""}
    <section class="block"><h2 class="block__title">Pour qui cherchez-vous ?</h2>
      ${others.length ? html`<div class="people">${others.map(person)}</div>` :
        html`<div class="empty"><p>Vous êtes seul ici pour l'instant.</p>${ctx.isAdmin ? html`<a class="btn" href="#/f/${famId}/gestion">Inviter la famille</a>` : ""}</div>`}
    </section>
    ${adventToday ? adventDialog() : ""}`;
}

// ============================================================================ une liste
function ideaForm(i = {}, { submit = "Ajouter à la liste", cancel = false, renew = false } = {}) {
  return html`
    ${field({ name: "title", label: "Idée", value: i.title, required: true, placeholder: "Ex. Un bon livre de cuisine italienne", attrs: 'autocomplete="off" maxlength="200"' })}
    ${field({ name: "details", label: "Précisions", type: "textarea", value: i.details, placeholder: "Taille, couleur, référence… (facultatif)" })}
    ${field({ name: "url", label: "Lien", value: i.url, placeholder: "https://… (facultatif)", attrs: 'inputmode="url"' })}
    ${field({ name: "price", label: "Prix indicatif", value: i.price, placeholder: "≈ 30 € (facultatif)" })}
    ${field({ name: "favorite", label: "J'en rêve", type: "checkbox", value: i.favorite })}
    ${renew ? html`<input type="hidden" name="renew" value="1">` : ""}
    <div class="ideaform__actions">
      ${cancel ? html`<button class="btn btn--ghost" type="button" data-act="cancel-edit">Annuler</button>` : ""}
      <button class="btn btn--primary" type="submit">${submit}</button></div>`;
}

function ideaCard(i, ctx, { ownerView = false, review = false } = {}) {
  const res = ownerView ? null : one(i.reservations);
  const parts = res ? res.reservation_participants.map((p) => p.member_id) : [];
  const mine = res && res.owner_id === ctx.me.id;
  const participating = parts.includes(ctx.me.id);
  const surprise = !ownerView && isSurprise(i, ctx);
  const edit = canEditIdea(i, ctx) || ownerView;
  const author = ctx.byId[i.author_id];
  const cls = ["tag", i.favorite && "tag--fav", res && "tag--taken", res?.status === "bought" && "tag--bought",
    (mine || participating) && "tag--mine", surprise && "tag--tiers", review && "tag--older"].filter(Boolean).join(" ");
  let actions = "";
  if (review) {
    actions = html`<button class="btn btn--small btn--primary" data-act="keep" data-id="${i.id}">${icon("check")} Garder</button>
      <button class="btn btn--small" data-act="edit" data-id="${i.id}" data-renew="1">${icon("edit")} Modifier</button>
      <button class="btn btn--small btn--ghost" data-act="drop" data-id="${i.id}">Enlever</button>`;
  } else if (!ownerView) {
    const a = (act, label, cl = "") => html`<button class="btn btn--small ${cl}" data-act="res" data-do="${act}" data-id="${i.id}">${label}</button>`;
    if (!res) actions = a("reserve", "Je m'en occupe", "btn--primary");
    else if (mine) actions = html`${a("bought", res.status === "bought" ? raw("Pas encore acheté") : html`${icon("check")} C'est acheté`, res.status === "bought" ? "" : "btn--primary")}${a("release", "Annuler", "btn--ghost")}`;
    else if (participating) actions = a("leave", "Ne plus participer", "btn--ghost");
    else if (res.status !== "bought") actions = a("join", html`${icon("users")} Participer`);
  }
  if (ownerView && !review && i.year < SEASON) actions = html`<button class="btn btn--small" data-act="keep" data-id="${i.id}">${icon("check")} Garder pour ${SEASON}</button>`;
  return html`<li class="${cls}" id="idea-${i.id}"><div class="tag__paper">
    <div class="tag__body">
      ${i.preview_image ? html`<a class="tag__thumb" href="${i.url}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${i.preview_image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></a>` : ""}
      <p class="tag__title">${i.favorite ? html`<span class="tag__fav" title="J'en rêve">${icon("heart")}</span>` : ""}${i.title}</p>
      ${i.details ? html`<p class="tag__details">${raw(esc(i.details).replace(/\n/g, "<br>"))}</p>` : ""}
      <p class="tag__meta">
        ${i.url ? html`<a class="chip chip--link" href="${i.url}" target="_blank" rel="noopener noreferrer">${icon("link")} ${domain(i.url)}</a>` : ""}
        ${i.price ? html`<span class="chip">${i.price}</span>` : ""}
        ${i.year < SEASON ? html`<span class="chip">Idée de ${i.year}</span>` : ""}
        ${surprise ? html`<span class="chip chip--surprise" title="${ctx.byId[i.recipient_id]?.name} ne voit pas cette idée">${icon("eye-off")} Suggestion d'un tiers${author ? ` (${author.name})` : ""}</span>` : ""}
        ${i.archived && !ownerView ? html`<span class="chip chip--warn">Retirée de sa liste</span>` : ""}
      </p></div>
    ${res ? html`<div class="tag__status"><p class="stamp${res.status === "bought" ? " stamp--bought" : ""}">
        ${res.status === "bought" ? "Acheté" : "Réservé"} par ${mine ? "vous" : ctx.byId[res.owner_id]?.name || "quelqu'un"}${parts.length ? ` + ${parts.length}` : ""}</p>
        ${parts.length ? html`<p class="tag__with">Avec ${parts.map((p) => (p === ctx.me.id ? "vous" : ctx.byId[p]?.name)).join(", ")}</p>` : ""}</div>` : ""}
    <div class="tag__actions">${actions}
      ${edit && !review ? html`<span class="tag__tools">
        <button class="iconbtn iconbtn--small" data-act="edit" data-id="${i.id}" aria-label="Modifier">${icon("edit")}</button>
        <button class="iconbtn iconbtn--small" data-act="delete" data-id="${i.id}" data-confirm="Supprimer « ${i.title.slice(0, 60)} » ?" aria-label="Supprimer">${icon("trash")}</button></span>` : ""}
    </div></div></li>`;
}

function bindIdeaActions(ctx, ideasById, { after = refresh, ownerView = false } = {}) {
  state.handlers.res = async (el) => {
    const msg = await rpc("reservation_action", { p_idea: +el.dataset.id, p_action: el.dataset.do });
    toast(msg); await after();
  };
  state.handlers.edit = (el) => {
    const i = ideasById[el.dataset.id];
    const li = document.getElementById(`idea-${i.id}`);
    li.className = "tag tag--editing";
    li.innerHTML = String(html`<div class="tag__paper"><form class="ideaform" data-form="save-idea" data-id="${i.id}">
      ${ideaForm(i, { submit: el.dataset.renew ? `Enregistrer pour ${SEASON}` : "Enregistrer", cancel: true, renew: !!el.dataset.renew })}</form></div>`);
    li.querySelector("input")?.focus();
  };
  state.handlers["cancel-edit"] = () => after();
  state.handlers["save-idea"] = async (form) => {
    const i = ideasById[form.dataset.id];
    const d = formData(form);
    const url = normUrl(d.url);
    const preview = url && url !== i.url ? await linkPreview(url) : url ? i.preview_image : "";
    await rpc("update_idea", { p_id: i.id, p_title: d.title, p_details: d.details, p_url: url, p_price: d.price,
      p_favorite: !!d.favorite, p_preview: preview, p_renew: !!d.renew });
    toast(d.renew ? `Modifiée et rangée dans votre liste ${SEASON}` : "Idée modifiée");
    await after();
  };
  state.handlers.delete = async (el) => {
    await rpc("delete_idea", { p_id: +el.dataset.id });
    toast("Idée supprimée"); await after();
  };
  state.handlers.drop = async (el) => {
    await rpc("keep_idea", { p_id: +el.dataset.id, p_keep: false });
    toast("Idée enlevée de votre liste"); await after();
  };
  state.handlers.keep = async (el) => {
    await rpc("keep_idea", { p_id: +el.dataset.id, p_keep: true });
    toast(`Rangée dans votre liste ${SEASON}`); await after();
  };
}

async function viewMember(famId, memberId) {
  const ctx = await loadFamily(famId);
  const r = ctx.byId[memberId];
  if (!r) throw new Error("Cette personne n'est pas dans la famille.");
  const ownerView = r.user_id === state.session.user.id;
  renderTopbar(ctx, ownerView ? "mine" : "");
  const editsList = canEditList(r.id, ctx);
  state.handlers["add-idea"] = async (form) => {
    const d = formData(form);
    const url = normUrl(d.url);
    const preview = await linkPreview(url);
    await rpc("add_idea", { p_recipient: r.id, p_title: d.title, p_details: d.details, p_url: url, p_price: d.price,
      p_favorite: !!d.favorite, p_preview: preview });
    form.reset();
    if (ownerView) toast(`« ${d.title.slice(0, 50)} » est dans votre liste. Vous pouvez l'oublier 🎁`);
    else toast(isSurpriseFor(r) ? `Suggestion ajoutée : ${r.name} ne la verra pas` : "Idée ajoutée");
    await refresh();
  };
  const isSurpriseFor = (rec) => !canEditList(rec.id, ctx);
  const adder = html`<section class="adder"><details class="adder__box" ${raw(ownerView && !(await rpc("my_count", { p_member: r.id })) ? "open" : "")}>
      <summary class="btn btn--primary btn--block">${icon("plus")} ${ownerView || editsList ? "Ajouter une idée" : `Suggérer une idée pour ${r.name}`}</summary>
      <form class="ideaform" id="idea-form" data-form="add-idea">${ideaForm()}</form></details>
      ${!ownerView && !editsList ? html`<p class="adder__hint">${icon("eye-off")} Votre suggestion sera marquée « suggestion d'un tiers » et restera invisible pour ${r.name}.</p>` : ""}
    </section>`;
  const head = html`<a class="back" href="#/f/${famId}">${icon("arrow-left")} Accueil</a>
    <header class="listhead">${avatar(r, "xl")}<div>
      <h1 class="listhead__title">${ownerView ? `Ma liste ${SEASON}` : r.name}</h1>
      <p class="listhead__sub">${ownerView ? "Vos idées restent cachées, même pour vous : oubliez-les et laissez-vous surprendre. Les autres les voient, vous ne saurez jamais ce qu'ils réservent."
        : editsList ? `Vous tenez la liste de ${r.name}. Vous voyez aussi ce que les autres ont réservé.`
        : `Réservez une idée pour éviter les doublons. ${r.name} ne verra rien.`}</p></div></header>`;

  if (ownerView) {
    const [count, review] = await Promise.all([rpc("my_count", { p_member: r.id }), rpc("my_review", { p_member: r.id })]);
    const byId = Object.fromEntries(review.map((i) => [i.id, i]));
    let lastQuery = "";
    const runSearch = async () => {
      const box = document.getElementById("search-results");
      if (!box) return;
      if (lastQuery.trim().length < 2) { box.innerHTML = ""; return; }
      const found = await rpc("search_my_ideas", { p_member: r.id, p_query: lastQuery });
      found.forEach((i) => (byId[i.id] = i));
      box.innerHTML = String(found.length ? html`<ul class="tags">${found.map((i) => ideaCard(i, ctx, { ownerView: true }))}</ul>`
        : html`<p class="finder__none">Aucune de vos idées ne contient « ${lastQuery.trim()} ».</p>`);
    };
    state.inputs.search = async (el) => { lastQuery = el.value; await runSearch(); };
    bindIdeaActions(ctx, byId, { ownerView: true, after: async () => { await refresh(); } });
    onPaint(() => {
      const input = main.querySelector('[data-input="search"]');
      if (input && lastQuery) { input.value = lastQuery; runSearch(); }
    });
    // garder la recherche après une action
    const keepQuery = state.inputs.search;
    state.inputs.search = async (el) => { sessionStorage.setItem("recherche", el.value); await keepQuery(el); };
    try { lastQuery = sessionStorage.getItem("recherche") || ""; } catch {}
    return html`${head}
      <section class="adder"><div class="vault" id="my-count"><span class="vault__icon">${icon("gift")}</span>
        <p>${count ? html`<strong>${plural(count, "idée")}</strong> dans votre liste ${SEASON}, bien rangée${count > 1 ? "s" : ""} à l'abri de vos yeux.`
          : "Votre liste est vide. Une idée, même vague, aide beaucoup : « un livre de cuisine », « des gants chauds »…"}</p></div></section>
      ${adder}
      <section class="block finder"><h2 class="block__title">Retrouver une de mes idées</h2>
        <p class="finder__hint">Pour la corriger ou la supprimer. Tapez quelques lettres de ce que vous aviez écrit.</p>
        <div class="finder__box">${icon("search")}<input class="input" type="search" data-input="search" autocomplete="off"
          placeholder="Ex. gants, livre, casque…" aria-label="Rechercher dans mes idées"></div>
        <div id="search-results" aria-live="polite"></div></section>
      ${review.length ? html`<section class="block review-block"><h2 class="block__title">Toujours d'actualité ? <span class="count">${review.length}</span></h2>
        <p class="older__hint">Ces idées des années passées n'ont pas été offertes. Ça vous fait toujours envie ?
          « Garder » la range dans votre liste ${SEASON} (elle redevient cachée), « Modifier » permet de la corriger avant, « Enlever » la retire.</p>
        <ul class="tags">${review.map((i) => ideaCard(i, ctx, { ownerView: true, review: true }))}</ul></section>` : ""}`;
  }

  const all = await q(sb.from("ideas").select("*, reservations(*, reservation_participants(member_id))")
    .eq("recipient_id", r.id).order("favorite", { ascending: false }).order("created_at", { ascending: false }));
  const visible = all.filter((i) => !i.archived || one(i.reservations));
  const current = visible.filter((i) => i.year >= SEASON);
  const older = visible.filter((i) => i.year < SEASON && !one(i.reservations) && !i.archived);
  const free = current.filter((i) => !one(i.reservations));
  const taken = current.filter((i) => one(i.reservations));
  const byId = Object.fromEntries(all.map((i) => [i.id, i]));
  bindIdeaActions(ctx, byId);
  const santa = await q(sb.from("assignments").select("draws!inner(title, budget, year, family_id)")
    .eq("giver_id", ctx.me.id).eq("receiver_id", r.id).eq("draws.year", SEASON));
  return html`${head}
    ${santa.length ? html`<p class="notice notice--santa">${icon("dice")} ${r.name} est votre ami secret (${santa[0].draws.title}${santa[0].draws.budget ? `, budget ${santa[0].draws.budget}` : ""}).</p>` : ""}
    ${adder}
    <section class="block"><h2 class="block__title">Idées disponibles</h2>
      ${free.length ? html`<ul class="tags" id="ideas">${free.map((i) => ideaCard(i, ctx))}</ul>`
        : html`<div class="empty"><p>Aucune idée libre pour l'instant. Suggérez-en une ci-dessus.</p></div>`}</section>
    ${taken.length ? html`<section class="block"><h2 class="block__title">Déjà réservées</h2>
      <ul class="tags tags--taken">${taken.map((i) => ideaCard(i, ctx))}</ul></section>` : ""}
    ${older.length ? html`<section class="block"><details class="older"><summary class="block__title">Idées des années précédentes <span class="count">${older.length}</span></summary>
      <p class="older__hint">Jamais offertes. Elles peuvent encore faire plaisir, mais vérifiez qu'elles sont toujours d'actualité.</p>
      <ul class="tags tags--older">${older.map((i) => ideaCard(i, ctx))}</ul></details></section>` : ""}`;
}

// ============================================================================ à acheter
async function viewPurchases(famId) {
  const ctx = await loadFamily(famId);
  renderTopbar(ctx, "purchases");
  const rows = await q(sb.from("reservations").select("*, reservation_participants(member_id), ideas!inner(*)")
    .eq("ideas.family_id", famId).gte("ideas.year", SEASON));
  const mine = rows.filter((r) => r.owner_id === ctx.me.id || r.reservation_participants.some((p) => p.member_id === ctx.me.id))
    .sort((a, b) => (a.status === "bought") - (b.status === "bought") || (ctx.byId[a.ideas.recipient_id]?.name || "").localeCompare(ctx.byId[b.ideas.recipient_id]?.name || ""));
  state.handlers.toggle = async (el) => {
    const msg = await rpc("reservation_action", { p_idea: +el.dataset.id, p_action: "bought" });
    toast(msg); await refresh();
  };
  return html`<header class="pagehead"><h1 class="pagehead__title">À acheter</h1>
      <p class="pagehead__sub">Les cadeaux dont vous vous occupez. Cochez-les une fois achetés.</p></header>
    ${mine.length ? html`<section class="block"><ul class="rows">${mine.map((r) => {
      const i = r.ideas, rec = ctx.byId[i.recipient_id], done = r.status === "bought";
      return html`<li class="row${done ? " row--done" : ""}">
        <button class="check" data-act="toggle" data-id="${i.id}" aria-pressed="${done ? "true" : "false"}" aria-label="${done ? "Marquer comme pas encore acheté" : "Marquer comme acheté"}">${icon("check")}</button>
        ${i.preview_image ? html`<img class="row__thumb" src="${i.preview_image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
        <div class="row__body"><p class="row__title">${i.title}</p><p class="row__meta">Pour <a href="#/f/${famId}/p/${rec?.id}">${rec?.name}</a>
          ${i.price ? html`<span class="chip">${i.price}</span>` : ""}
          ${i.url ? html`<a class="chip chip--link" href="${i.url}" target="_blank" rel="noopener noreferrer">${icon("link")} ${domain(i.url)}</a>` : ""}
          ${i.archived ? html`<span class="chip chip--warn">Retirée de sa liste</span>` : ""}
          ${r.owner_id !== ctx.me.id ? html`<span class="chip">avec ${ctx.byId[r.owner_id]?.name || "quelqu'un"}</span>` : ""}</p></div></li>`;
    })}</ul></section>`
    : html`<div class="empty"><p>Vous n'avez encore rien réservé. Ouvrez la liste de quelqu'un et choisissez « Je m'en occupe ».</p>
        <a class="btn btn--primary" href="#/f/${famId}">Voir les listes</a></div>`}`;
}

// ============================================================================ amis secrets
async function viewDraws(famId) {
  const ctx = await loadFamily(famId);
  renderTopbar(ctx, "draws");
  const [draws, assigns, last] = await Promise.all([
    q(sb.from("draws").select("*").eq("family_id", famId).order("year", { ascending: false }).order("created_at", { ascending: false })),
    q(sb.from("assignments").select("draw_id, round, giver_id, receiver_id").order("round")),
    rpc("last_draw_participants", { p_family: famId }),
  ]);
  const preset = new Set(last?.participants || ctx.members.map((m) => m.id));
  state.handlers.draw = async (form) => {
    const fd = new FormData(form);
    const participants = fd.getAll("participants");
    const res = await rpc("run_draw", { p_family: famId, p_title: fd.get("title"), p_budget: fd.get("budget"),
      p_rounds: +fd.get("rounds"), p_participants: participants });
    let text = "Tirage effectué ! Chacun découvre ses amis secrets sur l'accueil.";
    if (res.relaxed?.length) text += ` Impossible de tout respecter : on a seulement assoupli « ${res.relaxed.join(" », « ")} ».`;
    toast(text); await refresh();
  };
  state.handlers["del-draw"] = async (el) => { await rpc("delete_draw", { p_id: el.dataset.id }); toast("Tirage supprimé."); await refresh(); };
  state.handlers["check-all"] = () => {
    const boxes = [...main.querySelectorAll('input[name="participants"]')];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !all));
  };
  const rounds = last?.rounds || 2;
  return html`<header class="pagehead"><h1 class="pagehead__title">Amis secrets</h1>
      <p class="pagehead__sub">Chacun tire au sort une, deux ou trois personnes à qui faire un cadeau. Le tirage se fait sur le serveur : personne d'autre ne connaît le résultat, pas même l'organisateur.</p></header>
    <section class="block">${draws.length ? draws.map((d) => {
      const mine = assigns.filter((a) => a.draw_id === d.id);
      const groups = {};
      mine.forEach((a) => (groups[a.giver_id] ||= []).push(ctx.byId[a.receiver_id]));
      return html`<article class="draw${d.year < SEASON ? " draw--past" : ""}">
        <div class="draw__head"><h2 class="draw__title">${d.title}</h2>
          <p class="draw__meta">${d.year}, ${d.rounds > 1 ? `${d.rounds} amis secrets par personne` : "1 ami secret par personne"}${d.budget ? `, budget ${d.budget}` : ""}</p></div>
        ${Object.keys(groups).length ? Object.entries(groups).map(([gid, recs]) => html`<div class="draw__mine">
            <p>${gid === ctx.me.id ? "Vous offrez à" : `${ctx.byId[gid]?.name} offre à`}</p>
            <ul>${recs.map((r) => html`<li><a class="draw__who" href="#/f/${famId}/p/${r?.id}">${avatar(r, "sm")} ${r?.name}</a></li>`)}</ul></div>`)
          : html`<p class="draw__none">Vous ne participez pas à ce tirage.</p>`}
        ${ctx.isAdmin ? html`<button class="btn btn--small btn--ghost" data-act="del-draw" data-id="${d.id}" data-confirm="Supprimer le tirage « ${d.title} » ? Chacun perdra ses amis secrets.">Supprimer ce tirage</button>` : ""}
      </article>`;
    }) : html`<div class="empty"><p>Aucun tirage pour l'instant.${ctx.isAdmin ? "" : " Un organisateur de la famille peut en lancer un."}</p></div>`}</section>
    ${ctx.isAdmin ? html`<section class="block"><details class="panel" ${raw(draws.some((d) => d.year === SEASON) ? "" : "open")}>
      <summary class="block__title">Lancer un nouveau tirage</summary>
      <p class="panel__hint">Règles : on ne se tire pas soi-même, ni quelqu'un de son foyer, et jamais deux fois la même personne d'une boucle à l'autre. Si possible, on évite aussi de retomber sur la personne de l'an dernier, que deux personnes d'un même foyer offrent à la même personne, et les échanges réciproques.</p>
      <form data-form="draw" class="drawform">
        ${field({ name: "title", label: "Nom du tirage", value: `Amis secrets ${SEASON}` })}
        ${field({ name: "budget", label: "Budget conseillé", placeholder: "Ex. 30 € (facultatif)" })}
        <div class="field"><label for="rounds">Nombre d'amis secrets par personne</label>
          <select class="input" id="rounds" name="rounds">${[1, 2, 3].map((n) => html`<option value="${n}" ${raw(n === rounds ? "selected" : "")}>${n} ami${n > 1 ? "s" : ""} secret${n > 1 ? "s" : ""}</option>`)}</select>
          <p class="field__help">Chacun offre à autant de personnes différentes, sans doublon d'une boucle à l'autre.</p></div>
        <fieldset class="field picks"><legend>Participants <button type="button" class="linkbtn" data-act="check-all">Tout cocher / décocher</button></legend>
          ${ctx.members.map((m) => html`<label class="pick"><input type="checkbox" name="participants" value="${m.id}" ${raw(preset.has(m.id) ? "checked" : "")}> <span>${m.name}</span></label>`)}</fieldset>
        <button class="btn btn--primary" type="submit">${icon("dice")} Tirer au sort</button></form></details></section>` : ""}`;
}

// ============================================================================ calendrier de l'Avent
async function signedUrls(paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data } = await sb.storage.from("avent").createSignedUrls(list, 3600);
  return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

async function viewAdvent(famId) {
  const ctx = await loadFamily(famId);
  renderTopbar(ctx, "advent");
  const days = await rpc("advent_calendar", { p_family: famId });
  const today = todayStr();
  const urls = await signedUrls(days.filter((d) => d.open).flatMap((d) => [d.cover, d.inside]));
  const viewer = days.map((d) => (d.open ? { date: frDate(d.day, { weekday: "long", day: "numeric", month: "long" }), title: d.title, img: urls[d.inside] || "", text: d.text } : null));
  onPaint(() => setupAdventViewer(viewer));
  return html`<header class="pagehead"><h1 class="pagehead__title">Calendrier de l'Avent</h1>
      <p class="pagehead__sub">Une case par jour jusqu'à Noël. Les cases s'ouvrent le jour venu, pas avant.</p></header>
    ${days.length ? html`<section class="block"><ol class="advent">${days.map((d, n) => html`
      <li class="door${d.open ? " door--open" : ""}${d.day === today ? " door--today" : ""}">
        ${d.open ? html`<button type="button" class="door__btn" data-advent-open="${n}" aria-label="Ouvrir la case du ${frDate(d.day)}">
            ${urls[d.cover] ? html`<img src="${urls[d.cover]}" alt="" loading="lazy">` : doorFace(d)}
            ${d.day === today ? html`<span class="door__flag">Aujourd'hui</span>` : ""}</button>`
          : html`<div class="door__btn door__btn--locked" aria-label="Case du ${frDate(d.day)}, pas encore ouverte">
            <span class="door__num">${+d.day.slice(8)}</span><span class="door__lock">${frDate(d.day, { day: "numeric", month: "short" })}</span></div>`}
      </li>`)}</ol></section>
      ${adventDialog()}`
    : html`<div class="empty"><p>Le calendrier ${SEASON} n'est pas encore prêt.</p>
        ${ctx.isAdmin ? html`<a class="btn btn--primary" href="#/f/${famId}/avent/gestion">Préparer le calendrier</a>` : ""}</div>`}
    ${ctx.isAdmin && days.length ? html`<p class="block"><a class="linkbtn" href="#/f/${famId}/avent/gestion">Modifier le calendrier</a></p>` : ""}`;
}

// Texte légèrement balisé des cases : paragraphes séparés par une ligne vide, « ^ » = centré,
// **gras**, _italique_, {b|bleu} {r|rouge} {g|vert} {o|orange}.
function richText(text) {
  return (text || "").split(/\n\s*\n/).filter((p) => p.trim()).map((p) => {
    let center = false;
    if (p.startsWith("^")) { center = true; p = p.slice(1); }
    let h = esc(p.trim())
      .replace(/\{([brgo])\|([\s\S]+?)\}/g, '<span class="hl hl--$1">$2</span>')
      .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(«>])_([\s\S]+?)_(?=$|[\s.,;:!?)»<])/g, "$1<em>$2</em>")
      .replace(/\n/g, "<br>");
    return `<p${center ? ' class="is-center"' : ""}>${h}</p>`;
  }).join("");
}

// Porte dessinée (quand il n'y a pas d'image) : dans l'esprit du livret « Psaume 23 ».
function doorFace(d) {
  const day = +d.day.slice(8), month = +d.day.slice(5, 7);
  if (month === 11) {
    return html`<span class="door-face door-face--cover"><span class="door-face__stars">✦ · ✦</span>
      <span class="door-face__cover-title">${(d.title || "Avent").split("—")[0].trim()}</span>
      ${d.title?.includes("—") ? html`<span class="door-face__cover-sub">${d.title.split("—")[1].trim()}</span>` : ""}
      <svg class="door-face__wave" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9 C15 3 25 11 40 7 S47 2 45 5 S55 10 70 6 S90 4 100 8"/></svg></span>`;
  }
  return html`<span class="door-face${day === 24 ? " door-face--eve" : ""}"><span class="door-face__num">${day}</span>
    <svg class="door-face__wave" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9 C15 3 25 11 40 7 S47 2 45 5 S55 10 70 6 S90 4 100 8"/></svg></span>`;
}

const adventDialog = () => html`<dialog class="advent-view" id="advent-view"><div class="advent-view__bar">
    <button class="iconbtn" type="button" data-advent-nav="-1" aria-label="Case précédente">${icon("arrow-left")}</button>
    <p class="advent-view__title"></p>
    <button class="iconbtn advent-view__next" type="button" data-advent-nav="1" aria-label="Case suivante">${icon("arrow-left")}</button>
    <form method="dialog"><button class="iconbtn" aria-label="Fermer">✕</button></form></div>
    <div class="advent-view__body"></div></dialog>`;

function setupAdventViewer(days) {
  const view = document.getElementById("advent-view");
  if (!view) return;
  let cur = -1;
  const seenKey = (i) => `avent-${location.hash.split("/")[2]}-${i}`;
  const show = (i) => {
    const d = days[i];
    if (!d) return;
    cur = i;
    view.querySelector(".advent-view__title").textContent = d.date;
    const body = view.querySelector(".advent-view__body");
    body.innerHTML = "";
    if (d.img) { const im = new Image(); im.src = d.img; im.alt = d.title || ""; body.appendChild(im); }
    if (d.title || d.text) {
      const card = document.createElement("article");
      card.className = "meditation";
      card.innerHTML = (d.title ? `<h2 class="meditation__title">${esc(d.title)}</h2>` : "") + richText(d.text);
      body.appendChild(card);
    }
    body.scrollTop = 0;
    view.querySelector('[data-advent-nav="-1"]').disabled = !days.slice(0, i).some(Boolean);
    view.querySelector('[data-advent-nav="1"]').disabled = !days.slice(i + 1).some(Boolean);
    try { localStorage.setItem(seenKey(i), "1"); } catch {}
    main.querySelector(`[data-advent-open="${i}"]`)?.closest(".door")?.classList.add("door--seen");
    if (!view.open) {
      const door = main.querySelector(".advent-home__door");
      if (door && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        door.classList.add("is-opening");
        setTimeout(() => { door.classList.remove("is-opening"); view.showModal(); }, 380);
      } else view.showModal();
    }
  };
  main.querySelectorAll("[data-advent-open]").forEach((b) => {
    const i = +b.dataset.adventOpen;
    try { if (localStorage.getItem(seenKey(i))) b.closest(".door").classList.add("door--seen"); } catch {}
    b.addEventListener("click", () => show(i));
  });
  view.querySelectorAll("[data-advent-nav]").forEach((b) => b.addEventListener("click", () => {
    const step = +b.dataset.adventNav;
    for (let j = cur + step; j >= 0 && j < days.length; j += step) if (days[j]) return show(j);
  }));
  view.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") view.querySelector('[data-advent-nav="-1"]').click();
    if (e.key === "ArrowRight") view.querySelector('[data-advent-nav="1"]').click();
  });
  view.addEventListener("click", (e) => { if (e.target === view) view.close(); });
}

const ADVENT_NAME = /^(?:day|jour)[ _-]?(\d{1,2})(_modal|_interieur|_inside)?\.(png|jpe?g|webp|gif)$/i;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

async function uploadAdvent(famId, day, file, kind) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${famId}/${day}/${kind}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await sb.storage.from("avent").upload(path, file, { contentType: file.type || "image/png", upsert: false });
  if (error) throw new Error(`Envoi de ${file.name} impossible : ${error.message}`);
  return path;
}

async function viewAdventManage(famId) {
  const ctx = await loadFamily(famId);
  if (!ctx.isAdmin) throw new Error("Réservé aux organisateurs de la famille.");
  renderTopbar(ctx, "advent");
  const days = await rpc("advent_calendar", { p_family: famId });
  const urls = await signedUrls(days.map((d) => d.cover));
  state.handlers.bulk = async (form) => {
    const start = form.start.value;
    const files = [...form.files.files];
    if (!files.length) throw new Error("Choisissez les images.");
    let done = 0; const ignored = [];
    for (const f of files) {
      const m = f.name.match(ADVENT_NAME);
      if (!m) { ignored.push(f.name); continue; }
      const n = +m[1], inside = !!m[2], day = addDays(start, n);
      const path = await uploadAdvent(famId, day, f, inside ? "interieur" : "porte");
      await rpc("advent_save", { p_family: famId, p_day: day, p_title: `Jour ${n}`, p_text: null,
        p_cover: inside ? null : path, p_inside: inside ? path : null });
      done++;
      form.querySelector("[type=submit]").textContent = `Envoi… ${done}/${files.length}`;
    }
    toast(`${done} image${done > 1 ? "s" : ""} rangée${done > 1 ? "s" : ""} dans le calendrier.` + (ignored.length ? ` Ignorées : ${ignored.slice(0, 4).join(", ")}` : ""));
    await refresh();
  };
  state.handlers.day = async (form) => {
    const d = formData(form), day = d.day;
    const cover = form.cover.files[0] ? await uploadAdvent(famId, day, form.cover.files[0], "porte") : null;
    const inside = form.inside.files[0] ? await uploadAdvent(famId, day, form.inside.files[0], "interieur") : null;
    await rpc("advent_save", { p_family: famId, p_day: day, p_title: d.title, p_text: d.text, p_cover: cover, p_inside: inside });
    toast(`Case du ${frDate(day)} enregistrée.`); await refresh();
  };
  state.handlers["del-day"] = async (el) => {
    const d = days.find((x) => x.id === el.dataset.id);
    await rpc("advent_delete", { p_id: d.id });
    const paths = [d.cover, d.inside].filter(Boolean);
    if (paths.length) await sb.storage.from("avent").remove(paths);
    toast("Case supprimée."); await refresh();
  };
  return html`<a class="back" href="#/f/${famId}/avent">${icon("arrow-left")} Calendrier</a>
    <header class="pagehead"><h1 class="pagehead__title">Préparer le calendrier ${SEASON}</h1>
      <p class="pagehead__sub">Chaque case a une image de porte (le numéro du jour, par exemple) et, à l'intérieur, une image ou un texte. Vous voyez toutes les cases, la famille seulement celles du jour et des jours passés.</p></header>
    <section class="block panel"><h2 class="block__title">Tout envoyer d'un coup</h2>
      <p class="panel__hint">Sélectionnez toutes les images du dossier en une fois (comme celles de l'an dernier : day0.png, day0_modal.png, day1.png…). « _modal » = l'image à l'intérieur. Chaque image est rangée à la bonne date.</p>
      <form data-form="bulk" class="stack">
        ${field({ name: "start", label: "Jour de la case 0", type: "date", value: `${SEASON}-11-30`, help: "« day0 » tombe ce jour-là, « day1 » le lendemain, etc." })}
        <div class="field"><label for="files">Images</label><input class="input" id="files" name="files" type="file" accept="image/*" multiple required></div>
        <button class="btn btn--primary" type="submit">Envoyer les images</button></form></section>
    <section class="block panel"><h2 class="block__title">Ajouter ou remplacer une case</h2>
      <form data-form="day" class="stack">
        ${field({ name: "day", label: "Jour", type: "date", value: todayStr(), required: true })}
        ${field({ name: "title", label: "Titre", placeholder: "Facultatif" })}
        <div class="field"><label for="cover">Image de la porte</label><input class="input" id="cover" name="cover" type="file" accept="image/*"></div>
        <div class="field"><label for="inside">Image à l'intérieur</label><input class="input" id="inside" name="inside" type="file" accept="image/*"></div>
        ${field({ name: "text", label: "Texte à l'intérieur", type: "textarea", placeholder: "Facultatif : un texte, un verset, une méditation…" })}
        <button class="btn" type="submit">Enregistrer la case</button></form></section>
    <section class="block panel"><h2 class="block__title">Les cases ${SEASON} <span class="count">${days.length}</span></h2>
      ${days.length ? html`<ul class="advent-admin">${days.map((d) => html`<li>
        ${urls[d.cover] ? html`<img src="${urls[d.cover]}" alt="" loading="lazy">` : html`<span class="advent-admin__ph">${+d.day.slice(8)}</span>`}
        <span class="advent-admin__txt"><strong>${frDate(d.day, { weekday: "long", day: "numeric", month: "long" })}</strong>
          <span>${d.title || "Sans titre"}${d.inside ? ", image intérieure" : ""}${d.text ? ", texte" : ""}${!d.inside && !d.text ? ", intérieur vide" : ""}</span></span>
        <button class="iconbtn iconbtn--small" data-act="del-day" data-id="${d.id}" data-confirm="Supprimer la case du ${frDate(d.day)} ?" aria-label="Supprimer">${icon("trash")}</button></li>`)}</ul>`
        : html`<p class="field__help">Aucune case pour l'instant.</p>`}</section>`;
}

// ============================================================================ gestion
async function viewManage(famId) {
  const ctx = await loadFamily(famId);
  if (!ctx.isAdmin) throw new Error("Réservé aux organisateurs de la famille.");
  renderTopbar(ctx, "manage");
  const usernames = (await rpc("admin_usernames", { p_family: famId })) || {};
  const invite = `${location.origin}${location.pathname}#/invitation/${ctx.family.invite_code}`;
  const withAccount = ctx.members.filter((m) => m.user_id);
  state.handlers.copy = async (el) => {
    const input = main.querySelector(el.dataset.target);
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand("copy"); }
    toast("Lien copié");
  };
  state.handlers["new-invite"] = async () => { await rpc("admin_family", { p_family: famId, p_new_invite: true }); toast("Nouveau lien créé. L'ancien ne fonctionne plus."); await refresh(); };
  state.handlers["save-member"] = async (form) => {
    const fd = new FormData(form);
    await rpc("admin_update_member", { p_member: form.dataset.id, p_name: fd.get("name"), p_household: fd.get("household") || null,
      p_is_admin: !!fd.get("is_admin"), p_managers: fd.getAll("managers") });
    toast(`${fd.get("name")} mis à jour.`); await refresh();
  };
  state.handlers["reset-pwd"] = async (form) => {
    const pwd = new FormData(form).get("password");
    const uname = await rpc("admin_reset_password", { p_member: form.dataset.id, p_password: pwd });
    form.reset();
    toast(`Mot de passe provisoire enregistré. Dites à la personne de se connecter avec « ${uname} » et ce mot de passe, puis de le changer dans « Mon compte ».`);
  };
  state.handlers["remove-member"] = async (el) => { await rpc("admin_remove_member", { p_member: el.dataset.id }); toast("Membre retiré."); await refresh(); };
  state.handlers["add-profile"] = async (form) => {
    const fd = new FormData(form);
    await rpc("admin_add_profile", { p_family: famId, p_name: fd.get("name"), p_household: fd.get("household") || null });
    toast(`Profil « ${fd.get("name")} » créé. Vous pouvez tenir sa liste.`); await refresh();
  };
  state.handlers["add-house"] = async (form) => { await rpc("admin_household", { p_family: famId, p_name: formData(form).name }); toast("Foyer ajouté."); await refresh(); };
  state.handlers["del-house"] = async (el) => { await rpc("admin_household", { p_family: famId, p_name: "", p_delete: el.dataset.id }); toast("Foyer supprimé."); await refresh(); };
  state.handlers.rename = async (form) => { await rpc("admin_family", { p_family: famId, p_name: formData(form).name }); toast("Nom mis à jour."); await refresh(); };
  const houseSelect = (sel) => html`<select class="input" name="household"><option value="">— Aucun foyer —</option>
    ${ctx.households.map((h) => html`<option value="${h.id}" ${raw(h.id === sel ? "selected" : "")}>${h.name}</option>`)}</select>`;
  return html`<header class="pagehead"><h1 class="pagehead__title">Gérer la famille</h1>
      <p class="pagehead__sub">Invitations, foyers, profils sans compte et mots de passe oubliés.</p></header>
    <section class="block panel"><h2 class="block__title">Inviter</h2>
      <p class="panel__hint">Toute personne qui ouvre ce lien peut créer son compte et rejoindre ${ctx.family.name}. Les personnes déjà sur la liste choisissent leur prénom pour retrouver leurs idées.</p>
      <div class="copybox"><input class="input" readonly value="${invite}" id="invite-url"><button class="btn btn--primary" type="button" data-act="copy" data-target="#invite-url">${icon("copy")} Copier le lien</button></div>
      <button class="linkbtn" data-act="new-invite" data-confirm="Créer un nouveau lien ? L'ancien ne marchera plus." data-confirm-ok="Créer">Créer un nouveau lien</button></section>
    <section class="block panel"><h2 class="block__title">Membres</h2>
      <ul class="members">${ctx.members.map((m) => {
        const mgr = ctx.managersOf(m.id);
        return html`<li class="memberrow"><details><summary>${avatar(m, "sm")}<span class="memberrow__name">${m.name}</span>
          <span class="memberrow__meta">${m.household_id ? ctx.houseById[m.household_id]?.name : "Sans foyer"}${m.is_admin ? ", organisateur" : ""}${m.user_id ? `, se connecte avec « ${usernames[m.id] || "?"} »` : ", sans compte"}</span></summary>
          <form class="memberrow__form" data-form="save-member" data-id="${m.id}">
            ${field({ name: "name", label: "Prénom affiché", value: m.name, required: true })}
            <div class="field"><label>Foyer</label>${houseSelect(m.household_id)}</div>
            ${field({ name: "is_admin", label: "Organisateur (gère la famille, les tirages, le calendrier)", type: "checkbox", value: m.is_admin })}
            <fieldset class="field"><legend>Peuvent tenir sa liste</legend><ul>${withAccount.filter((u) => u.id !== m.id).map((u) => html`
              <li><label><input type="checkbox" name="managers" value="${u.user_id}" ${raw(mgr.has(u.user_id) ? "checked" : "")}> ${u.name}</label></li>`)}</ul></fieldset>
            <button class="btn btn--primary btn--small" type="submit">Enregistrer</button></form>
          <div class="memberrow__more">
            ${m.user_id ? html`<form data-form="reset-pwd" data-id="${m.id}" class="addline addline--row" style="margin:0;padding:0;border:0">
                ${field({ name: "password", label: "Mot de passe oublié : en donner un provisoire", type: "text", required: true, attrs: 'minlength="6" autocomplete="off"' })}
                <button class="btn btn--small" type="submit">Enregistrer</button></form>`
              : html`<p class="field__help">Sans compte : la personne récupérera ce profil en s'inscrivant avec le lien d'invitation.</p>`}
            ${m.id !== ctx.me.id ? html`<button class="btn btn--small btn--ghost btn--danger-text" data-act="remove-member" data-id="${m.id}" data-confirm="Retirer ${m.name} de la famille ? Sa liste sera supprimée." data-confirm-ok="Retirer">Retirer de la famille</button>` : ""}
          </div></details></li>`;
      })}</ul>
      <form data-form="add-profile" class="addline"><p class="panel__hint">Ajouter une personne sans compte (un enfant, une grand-mère…). Vous pourrez tenir sa liste.</p>
        ${field({ name: "name", label: "Prénom", required: true })}<div class="field"><label>Foyer</label>${houseSelect(null)}</div>
        <button class="btn" type="submit">${icon("plus")} Ajouter le profil</button></form></section>
    <section class="block panel"><h2 class="block__title">Foyers</h2>
      <p class="panel__hint">Les personnes d'un même foyer (couple, frères et sœurs…) ne se tirent pas entre elles aux amis secrets.</p>
      <ul class="households">${ctx.households.map((h) => html`<li><span>${h.name}</span><span class="count">${ctx.members.filter((m) => m.household_id === h.id).length}</span>
        <button class="iconbtn iconbtn--small" data-act="del-house" data-id="${h.id}" data-confirm="Supprimer le foyer « ${h.name} » ? Ses membres restent dans la famille." aria-label="Supprimer">${icon("trash")}</button></li>`)}</ul>
      <form data-form="add-house" class="addline addline--row">${field({ name: "name", label: "Nouveau foyer", placeholder: "Ex. Isabelle & Frédéric", required: true })}<button class="btn" type="submit">Ajouter</button></form></section>
    <section class="block panel"><h2 class="block__title">Nom de la famille</h2>
      <form data-form="rename" class="addline addline--row">${field({ name: "name", label: "Nom", value: ctx.family.name, required: true })}<button class="btn" type="submit">Renommer</button></form></section>`;
}

// ============================================================================ compte
async function viewAccount() {
  renderTopbar(null);
  const acc = (await rpc("my_account")) || {};
  const me = one(await q(sb.from("members").select("name").eq("user_id", state.session.user.id).limit(1)));
  state.handlers.rename = async (form) => { await rpc("rename_me", { p_name: formData(form).name }); toast("Prénom affiché mis à jour."); };
  state.handlers.pwd = async (form) => {
    const d = formData(form);
    if (d.password.length < 6) throw new Error("Au moins 6 caractères.");
    if (d.password !== d.password2) throw new Error("Les deux mots de passe ne sont pas identiques.");
    const { error } = await sb.auth.updateUser({ password: d.password });
    if (error) throw new Error(error.message);
    form.reset(); toast("Mot de passe modifié.");
  };
  return html`<a class="back" href="#/">${icon("arrow-left")} Accueil</a>
    <header class="pagehead"><h1 class="pagehead__title">Mon compte</h1><p class="pagehead__sub">Vous vous connectez avec « ${acc.username || ""} ».</p></header>
    <section class="block panel"><h2 class="block__title">Prénom affiché</h2>
      <form data-form="rename" class="addline addline--row">${field({ name: "name", label: "Prénom", value: me?.name || acc.username, required: true })}<button class="btn btn--primary">Enregistrer</button></form></section>
    <section class="block panel"><h2 class="block__title">Changer de mot de passe</h2>
      <form data-form="pwd" class="stack">
        ${field({ name: "password", label: "Nouveau mot de passe", type: "password", required: true, attrs: 'minlength="6" autocomplete="new-password"' })}
        ${field({ name: "password2", label: "Confirmation", type: "password", required: true, attrs: 'minlength="6" autocomplete="new-password"' })}
        <button class="btn btn--primary">Changer le mot de passe</button></form></section>`;
}

// ============================================================================ neige
const snow = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let on = !reduce;
  try { if (localStorage.getItem("snow") === "off") on = false; } catch {}
  let raf = null, canvases = [];
  const flakes = new Map();
  const setup = (c) => {
    const r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = r.width * dpr; c.height = r.height * dpr;
    flakes.set(c, Array.from({ length: Math.round(r.width / 28) }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height, r: (Math.random() * 1.6 + 0.6) * dpr,
      s: (Math.random() * 0.35 + 0.15) * dpr, d: Math.random() * 6.28 })));
  };
  const frame = () => {
    canvases.forEach((c) => {
      if (!c.isConnected) return;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      (flakes.get(c) || []).forEach((f) => {
        f.y += f.s; f.d += 0.01; f.x += Math.sin(f.d) * 0.25;
        if (f.y > c.height + 4) { f.y = -4; f.x = Math.random() * c.width; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill();
      });
    });
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!on || raf) return; frame(); };
  const stop = () => { cancelAnimationFrame(raf); raf = null; canvases.forEach((c) => c.getContext("2d").clearRect(0, 0, c.width, c.height)); };
  addEventListener("resize", () => canvases.forEach(setup));
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  return {
    attach() {
      canvases = [...document.querySelectorAll("canvas.snow")].filter((c) => c.offsetParent !== null || c.closest(".topbar:not([hidden])"));
      canvases.forEach(setup);
      document.documentElement.dataset.snow = on ? "on" : "off";
      start();
    },
    toggle() {
      on = !on;
      try { localStorage.setItem("snow", on ? "on" : "off"); } catch {}
      document.documentElement.dataset.snow = on ? "on" : "off";
      on ? start() : stop();
      toast(on ? "Neige activée" : "Neige coupée");
    },
  };
})();

// ============================================================================ démarrage
(async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((event, session) => {
    const was = !!state.session;
    state.session = session;
    if (event === "SIGNED_IN" && !was) afterLogin();
    if (event === "SIGNED_OUT") go("#/connexion");
  });
  addEventListener("hashchange", () => router());
  router();
})();

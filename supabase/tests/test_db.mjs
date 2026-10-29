// Tests de la base Supabase dans un Postgres local (PGlite).
// Lancer :  npm i @electric-sql/pglite  puis  node supabase/tests/test_db.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const dir = path.dirname(new URL(import.meta.url).pathname);
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(dir, "stub_supabase.sql"), "utf8"));
const mig = fs.readdirSync(path.join(dir, "../migrations")).sort();
for (const f of mig) await db.exec(fs.readFileSync(path.join(dir, "../migrations", f), "utf8"));

let failures = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (e) { failures++; console.log("  ✗", name, "\n     ", e.message); }
  finally { await db.exec("reset role"); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function as(uid, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  await db.exec(`set role ${role}`);
}
const one = async (sql, params) => (await q(sql, params))[0];

// --- données de départ (en super-utilisateur)
const fam = (await one("insert into families (name) values ('Famille Test') returning id, invite_code"));
const H = (await one("insert into households (family_id, name) values ($1, 'Isa & Fred') returning id", [fam.id])).id;
for (const n of ["Alice", "Bob", "Isabelle", "Frederic", "Carla", "David"])
  await q("insert into members (family_id, name, household_id, is_admin) values ($1, $2, $3, $4)",
          [fam.id, n, ["Isabelle", "Frederic"].includes(n) ? H : null, n === "Alice"]);
const M = Object.fromEntries((await q("select name, id from members")).map((r) => [r.name, r.id]));
const U = {};

console.log("Comptes");
await test("création de compte en récupérant un profil existant", async () => {
  await as(null, "anon");
  for (const n of Object.keys(M)) {
    const mail = (await one("select public.create_account($1, $2, 'motdepasse', $3) as m", [fam.invite_code, n, M[n]])).m;
    assert.match(mail, /@cadeaux-de-noel\.invalid$/);
  }
  await db.exec("reset role");
  for (const r of await q("select name, user_id from members")) U[r.name] = r.user_id;
  assert.ok(U.Alice && U.Bob);
  const u = await one("select encrypted_password from auth.users where id = $1", [U.Bob]);
  assert.ok(u.encrypted_password.startsWith("$2"));
});
await test("connexion par prénom, insensible à la casse", async () => {
  await as(null, "anon");
  assert.ok((await one("select public.login_email('alice') as e")).e);
});
await test("prénom déjà pris refusé", async () => {
  await as(null, "anon");
  await assert.rejects(q("select public.create_account($1, 'ALICE', 'motdepasse')", [fam.invite_code]), /déjà pris/);
});
await test("l'anonyme ne lit rien", async () => {
  await as(null, "anon");
  await assert.rejects(q("select * from ideas"));
});
await test("un intrus (autre famille) ne lit rien", async () => {
  const other = (await one("insert into families (name) values ('Autre') returning invite_code")).invite_code;
  await as(null, "anon");
  await q("select public.create_account($1, 'Intrus', 'motdepasse')", [other]);
  await db.exec("reset role");
  const intrus = (await one("select user_id from members where name = 'Intrus'")).user_id;
  await as(intrus);
  assert.equal((await q("select * from members where family_id = $1", [fam.id])).length, 0);
});

console.log("Idées et surprises");
let own, surprise;
await test("ajout d'idées par la personne et par un tiers", async () => {
  await as(U.Bob);
  own = (await one("select public.add_idea($1, 'Un pull vert') as id", [M.Bob])).id;
  await as(U.Alice);
  surprise = (await one("select public.add_idea($1, 'Une montre SURPRISE') as id", [M.Bob])).id;
});
await test("la personne ne lit ni les suggestions ni les réservations", async () => {
  await as(U.Alice);
  await q("select public.reservation_action($1, 'reserve')", [own]);
  await as(U.Bob);
  const titles = (await q("select title from ideas where recipient_id = $1", [M.Bob])).map((r) => r.title);
  assert.deepEqual(titles, ["Un pull vert"]);
  assert.equal((await q("select * from reservations")).length, 0);
  assert.equal((await q("select * from reservation_participants")).length, 0);
});
await test("les autres lisent tout, avec qui s'en occupe", async () => {
  await as(U.Carla);
  assert.equal((await q("select * from ideas where recipient_id = $1", [M.Bob])).length, 2);
  assert.equal((await one("select owner_id from reservations where idea_id = $1", [own])).owner_id, M.Alice);
});
await test("pas d'écriture directe dans les tables", async () => {
  await as(U.Carla);
  await assert.rejects(q("update ideas set title = 'x' where id = $1", [own]));
  await assert.rejects(q("delete from reservations"));
});
await test("on ne réserve pas ses propres idées", async () => {
  await as(U.Bob);
  await assert.rejects(q("select public.reservation_action($1, 'reserve')", [own]), /propres cadeaux/);
});
await test("personne ne vole une réservation, participer, acheter, annuler", async () => {
  await as(U.Carla);
  await q("select public.reservation_action($1, 'reserve')", [own]);
  assert.equal((await one("select owner_id from reservations where idea_id = $1", [own])).owner_id, M.Alice);
  await q("select public.reservation_action($1, 'join')", [own]);
  await as(U.David);
  await assert.rejects(q("select public.reservation_action($1, 'release')", [own]));
  await as(U.Alice);
  await q("select public.reservation_action($1, 'bought')", [own]);
  await q("select public.reservation_action($1, 'release')", [own]);
  await db.exec("reset role");
  const r = await one("select owner_id, status from reservations where idea_id = $1", [own]);
  assert.equal(r.owner_id, M.Carla);
  assert.equal(r.status, "bought");
});
await test("la personne ne peut pas modifier une suggestion d'un tiers", async () => {
  await as(U.Bob);
  await assert.rejects(q("select public.delete_idea($1)", [surprise]), /non autorisée/);
});
await test("supprimer une idée réservée la retire sans la détruire", async () => {
  await as(U.Bob);
  await q("select public.delete_idea($1)", [own]);
  assert.equal((await q("select * from ideas where id = $1", [own])).length, 0); // Bob ne la voit plus
  await as(U.Carla);
  assert.equal((await one("select archived from ideas where id = $1", [own])).archived, true);
});
await test("« Toujours d'actualité ? » : garder une ancienne idée", async () => {
  await db.exec("reset role");
  const old = (await one("insert into ideas (family_id, recipient_id, author_id, title, year) values ($1, $2, $2, 'Vieille', 2020) returning id", [fam.id, M.Bob])).id;
  await as(U.Bob);
  await q("select public.keep_idea($1, true)", [old]);
  assert.equal((await one("select year from ideas where id = $1", [old])).year, (await one("select public.current_season() y")).y);
});

console.log("Amis secrets");
await test("seul un organisateur peut tirer", async () => {
  await as(U.Bob);
  await assert.rejects(q("select public.run_draw($1, 'x', '', 1, $2)", [fam.id, Object.values(M)]), /organisateurs/);
});
await test("tirage en 2 boucles : règles respectées et chacun ne voit que les siens", async () => {
  await as(U.Alice);
  const t0 = Date.now();
  const res = (await one("select public.run_draw($1, 'Amis secrets', '30 €', 2, $2) as r", [fam.id, Object.values(M)])).r;
  const ms = Date.now() - t0;
  assert.deepEqual(res.relaxed, []);
  await db.exec("reset role");
  const pairs = await q("select round, giver_id g, receiver_id r from assignments");
  assert.equal(pairs.length, 12);
  const hh = Object.fromEntries((await q("select id, household_id h from members")).map((x) => [x.id, x.h]));
  const keys = new Set();
  for (const p of pairs) {
    assert.notEqual(p.g, p.r);
    if (hh[p.g]) assert.notEqual(hh[p.g], hh[p.r]);
    keys.add(p.g + p.r);
  }
  assert.equal(keys.size, 12, "doublon entre boucles");
  await as(U.Bob);
  const mine = await q("select * from assignments");
  assert.equal(mine.length, 2);
  assert.ok(mine.every((a) => a.giver_id === M.Bob));
  console.log(`     (tirage en ${ms} ms)`);
});
await test("tirage impossible : message clair", async () => {
  await as(U.Alice);
  await assert.rejects(q("select public.run_draw($1, 'x', '', 1, $2)", [fam.id, [M.Isabelle, M.Frederic]]), /foyer/);
});

console.log("Calendrier de l'Avent");
await test("les cases à venir sont fermées pour les membres, ouvertes pour l'organisateur", async () => {
  await as(U.Alice);
  const today = (await one("select public.paris_today()::text d")).d;
  const tomorrow = (await one("select (public.paris_today() + 1)::text d")).d;
  await q("select public.advent_save($1, $2::date, 'Jour 1', 'Texte du jour', 'c1', 'i1')", [fam.id, today]);
  await q("select public.advent_save($1, $2::date, 'Jour 2', 'SECRET', 'c2', 'i2')", [fam.id, tomorrow]);
  await as(U.Bob);
  const cal = (await one("select public.advent_calendar($1) c", [fam.id])).c;
  assert.equal(cal.length, 2);
  assert.equal(cal[0].text, "Texte du jour");
  assert.equal(cal[1].open, false);
  assert.equal(cal[1].text, "");
  assert.equal(cal[1].inside, "");
  await db.exec("reset role");
  await q("insert into storage.objects (bucket_id, name) values ('avent', $1), ('avent', $2)",
          [`${fam.id}/${today}/a.png`, `${fam.id}/${tomorrow}/b.png`]);
  await as(U.Bob);
  assert.equal((await q("select name from storage.objects")).length, 1);
  await assert.rejects(q("insert into storage.objects (bucket_id, name) values ('avent', $1)", [`${fam.id}/${today}/x.png`]));
  await as(U.Alice);
  assert.equal((await q("select name from storage.objects")).length, 2);
});

console.log("Gestion");
await test("mot de passe provisoire par l'organisateur", async () => {
  await as(U.Alice);
  assert.equal((await one("select public.admin_reset_password($1, 'nouveau1') u", [M.Bob])).u, "Bob");
  await as(U.Bob);
  await assert.rejects(q("select public.admin_reset_password($1, 'nouveau1')", [M.Alice]), /organisateurs/);
});
await test("un parent tient la liste de son enfant (idées non surprises)", async () => {
  await as(U.Alice);
  const kid = (await one("select public.admin_add_profile($1, 'Jules', null) id", [fam.id])).id;
  await q("select public.admin_update_member($1, 'Jules', null, false, $2)", [kid, [U.Isabelle]]);
  await as(U.Isabelle);
  const id = (await one("select public.add_idea($1, 'Lego') id", [kid])).id;
  assert.equal((await one("select public.is_surprise(recipient_id, author_id) s from ideas where id = $1", [id])).s, false);
});

console.log(`\n${passed} réussis, ${failures} en échec`);
process.exit(failures ? 1 : 0);

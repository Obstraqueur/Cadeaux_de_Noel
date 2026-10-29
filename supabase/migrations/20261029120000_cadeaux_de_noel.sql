-- =============================================================================
-- Cadeaux de Noël — base Supabase
--
-- À coller une fois dans Supabase : SQL Editor → New query → Run.
-- (Ou appliqué automatiquement si l'intégration GitHub de Supabase est active.)
--
-- Principe de sécurité : le navigateur ne peut QUE lire, et seulement ce que les
-- règles (RLS) autorisent. Toutes les écritures passent par des fonctions serveur
-- (« security definer ») qui vérifient les droits. En particulier :
--   * la personne concernée ne peut jamais lire les réservations sur ses idées,
--     ni les suggestions faites pour elle par les autres ;
--   * chacun ne lit que SES amis secrets ;
--   * une case du calendrier de l'Avent ne se lit qu'à partir de son jour.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------- tables

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  invite_code text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_at  timestamptz not null default now()
);

create table if not exists public.households (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families on delete cascade,
  name      text not null check (length(trim(name)) between 1 and 120)
);

create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families on delete cascade,
  user_id      uuid references auth.users on delete set null,
  name         text not null check (length(trim(name)) between 1 and 60),
  household_id uuid references public.households on delete set null,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (family_id, user_id)
);
create index if not exists members_user_idx on public.members (user_id);

-- Qui peut tenir la liste d'un membre (un parent pour son enfant…)
create table if not exists public.member_managers (
  member_id uuid not null references public.members on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  primary key (member_id, user_id)
);

-- Prénom de connexion → compte (lu uniquement par les fonctions serveur)
create table if not exists public.accounts (
  user_id  uuid primary key references auth.users on delete cascade,
  username text not null,
  email    text not null
);
create unique index if not exists accounts_username_idx on public.accounts (lower(username));

create table if not exists public.ideas (
  id            bigint generated always as identity primary key,
  family_id     uuid not null references public.families on delete cascade,
  recipient_id  uuid not null references public.members on delete cascade,
  author_id     uuid references public.members on delete set null,
  title         text not null check (length(trim(title)) between 1 and 200),
  details       text not null default '',
  url           text not null default '',
  price         text not null default '',
  preview_image text not null default '',
  favorite      boolean not null default false,
  year          int not null,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ideas_recipient_idx on public.ideas (recipient_id, year);

create table if not exists public.reservations (
  idea_id    bigint primary key references public.ideas on delete cascade,
  owner_id   uuid references public.members on delete set null,
  status     text not null default 'reserved' check (status in ('reserved', 'bought')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservation_participants (
  idea_id   bigint not null references public.reservations on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  primary key (idea_id, member_id)
);

create table if not exists public.draws (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families on delete cascade,
  title      text not null,
  year       int not null,
  budget     text not null default '',
  rounds     int not null default 1 check (rounds between 1 and 3),
  created_by uuid references public.members on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id          bigint generated always as identity primary key,
  draw_id     uuid not null references public.draws on delete cascade,
  round       int not null default 1,
  giver_id    uuid not null references public.members on delete cascade,
  receiver_id uuid not null references public.members on delete cascade,
  unique (draw_id, round, giver_id),
  unique (draw_id, round, receiver_id),
  unique (draw_id, giver_id, receiver_id)
);

create table if not exists public.advent_days (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  day         date not null,
  title       text not null default '',
  text        text not null default '',
  cover_path  text not null default '',
  inside_path text not null default '',
  unique (family_id, day)
);

-- ----------------------------------------------------------------------------- petites fonctions utiles

create or replace function public.paris_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Paris')::date $$;

create or replace function public.current_season() returns int
language sql stable as $$ select extract(year from public.paris_today())::int $$;

create or replace function public.is_member(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where family_id = fam and user_id = auth.uid())
$$;

create or replace function public.is_admin(fam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where family_id = fam and user_id = auth.uid() and is_admin)
$$;

create or replace function public.my_member(fam uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where family_id = fam and user_id = auth.uid()
$$;

-- La personne regarde-t-elle sa propre liste ?
create or replace function public.is_self(mem uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where id = mem and user_id = auth.uid())
$$;

create or replace function public.can_edit_list(mem uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_self(mem)
      or exists (select 1 from member_managers where member_id = mem and user_id = auth.uid())
$$;

-- Une idée est une « suggestion d'un tiers » si elle n'a pas été écrite par la personne
-- (ou par quelqu'un qui tient sa liste). Sans auteur connu (ancien site) : surprise.
create or replace function public.is_surprise(recipient uuid, author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when author is null then true
    when author = recipient then false
    else not exists (
      select 1 from members a join member_managers mm on mm.user_id = a.user_id
      where a.id = author and mm.member_id = recipient)
  end
$$;

create or replace function public.reservation_visible(idea bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ideas i where i.id = idea and public.is_member(i.family_id)
                 and not public.is_self(i.recipient_id))
$$;

-- ----------------------------------------------------------------------------- règles de lecture (RLS)

alter table public.families enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.member_managers enable row level security;
alter table public.accounts enable row level security;
alter table public.ideas enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_participants enable row level security;
alter table public.draws enable row level security;
alter table public.assignments enable row level security;
alter table public.advent_days enable row level security;

drop policy if exists "lecture famille" on public.families;
create policy "lecture famille" on public.families for select to authenticated using (public.is_member(id));

drop policy if exists "lecture foyers" on public.households;
create policy "lecture foyers" on public.households for select to authenticated using (public.is_member(family_id));

drop policy if exists "lecture membres" on public.members;
create policy "lecture membres" on public.members for select to authenticated using (public.is_member(family_id));

drop policy if exists "lecture gestionnaires" on public.member_managers;
create policy "lecture gestionnaires" on public.member_managers for select to authenticated
  using (exists (select 1 from public.members m where m.id = member_id and public.is_member(m.family_id)));

-- Idées : tout le monde dans la famille, sauf la personne concernée qui ne lit que
-- ses propres idées (jamais les suggestions des autres, jamais les idées retirées).
drop policy if exists "lecture idées" on public.ideas;
create policy "lecture idées" on public.ideas for select to authenticated
  using (public.is_member(family_id)
         and (not public.is_self(recipient_id)
              or (not archived and not public.is_surprise(recipient_id, author_id))));

drop policy if exists "lecture réservations" on public.reservations;
create policy "lecture réservations" on public.reservations for select to authenticated
  using (public.reservation_visible(idea_id));

drop policy if exists "lecture participants" on public.reservation_participants;
create policy "lecture participants" on public.reservation_participants for select to authenticated
  using (public.reservation_visible(idea_id));

drop policy if exists "lecture tirages" on public.draws;
create policy "lecture tirages" on public.draws for select to authenticated using (public.is_member(family_id));

-- Chacun ne lit que ses propres amis secrets (et ceux des enfants dont il tient la liste).
drop policy if exists "lecture attributions" on public.assignments;
create policy "lecture attributions" on public.assignments for select to authenticated
  using (exists (select 1 from public.members g where g.id = giver_id
                 and (g.user_id = auth.uid()
                      or exists (select 1 from public.member_managers mm
                                 where mm.member_id = g.id and mm.user_id = auth.uid()))));

-- accounts, advent_days : aucune lecture directe (fonctions serveur seulement).

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

-- ----------------------------------------------------------------------------- comptes

create or replace function public.login_email(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select email from accounts where lower(username) = lower(trim(p_username))
$$;

create or replace function public.invite_info(p_code text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'family', f.name,
    'profiles', coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name) order by m.name)
                          from members m where m.family_id = f.id and m.user_id is null), '[]'::json))
  from families f where f.invite_code = trim(p_code)
$$;

create or replace function public._join(fam uuid, p_claim uuid, p_name text, p_uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  select id into mid from members where family_id = fam and user_id = p_uid;
  if mid is not null then return mid; end if;
  if p_claim is not null then
    update members set user_id = p_uid
     where id = p_claim and family_id = fam and user_id is null returning id into mid;
    if mid is null then raise exception 'Ce profil a déjà été récupéré par quelqu''un.'; end if;
    return mid;
  end if;
  insert into members (family_id, user_id, name) values (fam, p_uid, p_name) returning id into mid;
  return mid;
end $$;

-- Création d'un compte « prénom + mot de passe », sans e-mail (aucun message n'est jamais envoyé).
create or replace function public.create_account(p_code text, p_username text, p_password text, p_claim uuid default null)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  fam uuid;
  uid uuid := gen_random_uuid();
  uname text := trim(p_username);
  mail text := 'u-' || replace(uid::text, '-', '') || '@cadeaux-de-noel.invalid';
begin
  select id into fam from families where invite_code = trim(p_code);
  if fam is null then raise exception 'Lien d''invitation inconnu ou expiré.'; end if;
  if length(uname) < 2 or length(uname) > 40 then raise exception 'Le prénom doit faire entre 2 et 40 caractères.'; end if;
  if length(p_password) < 6 then raise exception 'Le mot de passe doit faire au moins 6 caractères.'; end if;
  if exists (select 1 from accounts where lower(username) = lower(uname)) then
    raise exception 'Ce prénom est déjà pris. Ajoutez une initiale (ex. « Pierre B. ») ou connectez-vous.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', json_build_object('name', uname),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, json_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
          'email', now(), now(), now());
  insert into accounts (user_id, username, email) values (uid, uname, mail);

  perform public._join(fam, p_claim, uname, uid);
  return mail;
end $$;

-- Un compte existant rejoint une autre famille.
create or replace function public.join_family(p_code text, p_claim uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid; uname text;
begin
  if auth.uid() is null then raise exception 'Connectez-vous d''abord.'; end if;
  select id into fam from families where invite_code = trim(p_code);
  if fam is null then raise exception 'Lien d''invitation inconnu ou expiré.'; end if;
  select username into uname from accounts where user_id = auth.uid();
  perform public._join(fam, p_claim, coalesce(uname, 'Moi'), auth.uid());
  return fam;
end $$;

create or replace function public.create_family(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid; uname text;
begin
  if auth.uid() is null then raise exception 'Connectez-vous d''abord.'; end if;
  insert into families (name) values (trim(p_name)) returning id into fam;
  select username into uname from accounts where user_id = auth.uid();
  insert into members (family_id, user_id, name, is_admin) values (fam, auth.uid(), coalesce(uname, 'Moi'), true);
  return fam;
end $$;

create or replace function public.my_account() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('username', username) from accounts where user_id = auth.uid()
$$;

create or replace function public.rename_me(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(p_name)) < 1 then raise exception 'Prénom vide.'; end if;
  update members set name = trim(p_name) where user_id = auth.uid();
end $$;

-- ----------------------------------------------------------------------------- idées

create or replace function public._check_member(fam uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  me := public.my_member(fam);
  if me is null then raise exception 'Vous ne faites pas partie de cette famille.'; end if;
  return me;
end $$;

create or replace function public._can_edit_idea(i ideas) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin(i.family_id)
      or i.author_id = public.my_member(i.family_id)
      or (public.can_edit_list(i.recipient_id) and not public.is_surprise(i.recipient_id, i.author_id))
$$;

create or replace function public.add_idea(p_recipient uuid, p_title text, p_details text default '',
  p_url text default '', p_price text default '', p_favorite boolean default false, p_preview text default '')
returns bigint
language plpgsql security definer set search_path = public as $$
declare fam uuid; me uuid; new_id bigint;
begin
  select family_id into fam from members where id = p_recipient;
  me := public._check_member(fam);
  insert into ideas (family_id, recipient_id, author_id, title, details, url, price, favorite, preview_image, year)
  values (fam, p_recipient, me, trim(p_title), coalesce(trim(p_details), ''), coalesce(trim(p_url), ''),
          coalesce(trim(p_price), ''), coalesce(p_favorite, false), coalesce(p_preview, ''), public.current_season())
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.update_idea(p_id bigint, p_title text, p_details text, p_url text,
  p_price text, p_favorite boolean, p_preview text default null, p_renew boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare i ideas;
begin
  select * into i from ideas where id = p_id;
  if i.id is null or not public._can_edit_idea(i) then raise exception 'Action non autorisée.'; end if;
  update ideas set title = trim(p_title), details = coalesce(trim(p_details), ''), url = coalesce(trim(p_url), ''),
                   price = coalesce(trim(p_price), ''), favorite = coalesce(p_favorite, false),
                   preview_image = coalesce(p_preview, preview_image),
                   year = case when p_renew then public.current_season() else year end,
                   updated_at = now()
   where id = p_id;
end $$;

-- Supprimer : si quelqu'un d'autre a déjà réservé l'idée, elle est seulement retirée
-- (elle reste dans sa page « À acheter »). La personne n'en sait rien.
create or replace function public.delete_idea(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare i ideas; me uuid; r reservations;
begin
  select * into i from ideas where id = p_id;
  if i.id is null or not public._can_edit_idea(i) then raise exception 'Action non autorisée.'; end if;
  me := public.my_member(i.family_id);
  select * into r from reservations where idea_id = p_id;
  if r.idea_id is not null and coalesce(r.owner_id, '00000000-0000-0000-0000-000000000000') <> me
     and not exists (select 1 from reservation_participants where idea_id = p_id and member_id = me) then
    update ideas set archived = true, updated_at = now() where id = p_id;
  else
    delete from ideas where id = p_id;
  end if;
end $$;

-- « Toujours d'actualité ? » : garder (l'idée revient dans l'année en cours) ou retirer.
create or replace function public.keep_idea(p_id bigint, p_keep boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i ideas;
begin
  select * into i from ideas where id = p_id;
  if i.id is null or not (public.can_edit_list(i.recipient_id) or public._can_edit_idea(i)) then
    raise exception 'Action non autorisée.';
  end if;
  if p_keep then
    update ideas set year = public.current_season(), updated_at = now() where id = p_id;
  else
    update ideas set archived = true, updated_at = now() where id = p_id;
  end if;
end $$;

-- Ma liste est cachée : on ne retrouve ses idées que par la recherche, et les idées des
-- années passées sont proposées une fois (« Toujours d'actualité ? »). Ces deux fonctions
-- ne renvoient jamais les suggestions des autres, et excluent sans le dire les idées
-- déjà offertes (la personne ne doit pas savoir ce qui a été acheté).
create or replace function public.search_my_ideas(p_member uuid, p_query text) returns setof ideas
language sql stable security definer set search_path = public as $$
  select i.* from ideas i
   where i.recipient_id = p_member and public.can_edit_list(p_member)
     and not i.archived and not public.is_surprise(i.recipient_id, i.author_id)
     and (i.year >= public.current_season() or not exists (select 1 from reservations r where r.idea_id = i.id))
     and length(trim(p_query)) >= 2
     and (i.title ilike '%' || trim(p_query) || '%' or i.details ilike '%' || trim(p_query) || '%')
   order by i.year desc, i.created_at desc limit 20
$$;

create or replace function public.my_review(p_member uuid) returns setof ideas
language sql stable security definer set search_path = public as $$
  select i.* from ideas i
   where i.recipient_id = p_member and public.can_edit_list(p_member)
     and not i.archived and not public.is_surprise(i.recipient_id, i.author_id)
     and i.year < public.current_season()
     and not exists (select 1 from reservations r where r.idea_id = i.id)
   order by i.year desc, i.created_at desc
$$;

create or replace function public.my_count(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from ideas i
   where i.recipient_id = p_member and public.can_edit_list(p_member)
     and not i.archived and not public.is_surprise(i.recipient_id, i.author_id)
     and i.year >= public.current_season()
$$;

-- ----------------------------------------------------------------------------- réservations

create or replace function public.reservation_action(p_idea bigint, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare i ideas; me uuid; r reservations; nxt uuid; adm boolean;
begin
  select * into i from ideas where id = p_idea for update;
  if i.id is null then raise exception 'Idée introuvable.'; end if;
  me := public._check_member(i.family_id);
  if public.is_self(i.recipient_id) then raise exception 'On ne réserve pas ses propres cadeaux.'; end if;
  adm := public.is_admin(i.family_id);
  select * into r from reservations where idea_id = p_idea;

  if p_action = 'reserve' then
    if r.idea_id is null then
      insert into reservations (idea_id, owner_id) values (p_idea, me);
      return 'C''est noté, vous vous en occupez';
    end if;
    return 'Déjà pris par quelqu''un';
  end if;
  if r.idea_id is null then return 'Cette idée n''est plus réservée'; end if;

  if p_action = 'release' then
    if r.owner_id is distinct from me and not adm and r.owner_id is not null then
      raise exception 'Action non autorisée.';
    end if;
    select member_id into nxt from reservation_participants where idea_id = p_idea limit 1;
    if nxt is not null then
      update reservations set owner_id = nxt, updated_at = now() where idea_id = p_idea;
      delete from reservation_participants where idea_id = p_idea and member_id = nxt;
    else
      delete from reservations where idea_id = p_idea;
    end if;
    return 'Réservation annulée';
  elsif p_action = 'bought' then
    if not (r.owner_id = me or adm or exists (select 1 from reservation_participants where idea_id = p_idea and member_id = me)) then
      raise exception 'Action non autorisée.';
    end if;
    update reservations set status = case when status = 'bought' then 'reserved' else 'bought' end, updated_at = now()
     where idea_id = p_idea returning * into r;
    return case when r.status = 'bought' then 'Marqué comme acheté 🎁' else 'Remis à « je m''en occupe »' end;
  elsif p_action = 'join' then
    if r.owner_id is distinct from me then
      insert into reservation_participants values (p_idea, me) on conflict do nothing;
    end if;
    return 'Vous participez à ce cadeau';
  elsif p_action = 'leave' then
    delete from reservation_participants where idea_id = p_idea and member_id = me;
    return 'Vous ne participez plus';
  end if;
  raise exception 'Action inconnue.';
end $$;

-- ----------------------------------------------------------------------------- amis secrets
--
-- Règles obligatoires : pas soi-même, pas son foyer, jamais deux fois la même personne d'une
-- boucle à l'autre. Règles « si possible », assouplies une à une seulement si nécessaire :
--   1. ne pas retomber sur une personne qu'on a soi-même tirée l'an dernier ;
--   2. deux personnes d'un même foyer n'offrent pas à la même personne ;
--   3. pas d'échange réciproque ;
--   4. ne pas tomber sur une personne tirée l'an dernier par quelqu'un de son foyer.
-- Le tirage est fait ici, sur le serveur : personne, pas même l'organisateur, ne voit le résultat.

create or replace function public.run_draw(p_family uuid, p_title text, p_budget text, p_rounds int, p_participants uuid[])
returns json
language plpgsql security definer set search_path = public as $$
declare
  people uuid[];
  houses uuid[];
  n int;
  me uuid;
  season int := public.current_season();
  prev text[] := '{}';
  prevh text[] := '{}';
  banned text[];
  levels boolean[][] := array[
    [true, true, true, true], [true, true, true, false], [false, true, true, false], [true, false, true, false],
    [false, false, true, false], [true, true, false, false], [false, true, false, false], [false, false, false, false]];
  lv int; attempt int; t int; k int;
  a_recip boolean; a_share boolean; a_prev boolean; a_prevh boolean;
  used text[]; pairs text[]; ok boolean;
  taken uuid[]; assigned_g uuid[]; assigned_r uuid[];
  remaining int[]; best int; best_cands uuid[]; cands uuid[]; g uuid; r uuid; gi int;
  draw_id uuid; relaxed text[] := '{}'; p text; has_mates boolean; lv_start timestamptz;
begin
  if not public.is_admin(p_family) then raise exception 'Réservé aux organisateurs de la famille.'; end if;
  me := public.my_member(p_family);
  select array_agg(m.id order by m.id), array_agg(m.household_id order by m.id) into people, houses
    from members m where m.family_id = p_family and m.id = any(p_participants);
  n := coalesce(array_length(people, 1), 0);
  if n < 2 then raise exception 'Il faut au moins deux participants.'; end if;
  if p_rounds < 1 or p_rounds > 3 then raise exception 'Entre 1 et 3 boucles.'; end if;
  for k in 1..n loop
    if n - (case when houses[k] is null then 1
                 else (select count(*) from unnest(houses) h where h = houses[k]) end) < p_rounds then
      raise exception 'Impossible de faire % boucle(s) : certains participants n''ont pas assez de personnes hors de leur foyer.', p_rounds;
    end if;
  end loop;
  has_mates := exists (select 1 from unnest(houses) h where h is not null group by h having count(*) > 1);

  -- tirages de l'an dernier
  select coalesce(array_agg(a.giver_id || '|' || a.receiver_id), '{}') into prev
    from assignments a join draws d on d.id = a.draw_id where d.family_id = p_family and d.year = season - 1;
  select coalesce(array_agg(distinct pm.id || '|' || a.receiver_id), '{}') into prevh
    from assignments a join draws d on d.id = a.draw_id
    join members g0 on g0.id = a.giver_id
    join members pm on pm.household_id = g0.household_id and pm.id = any(people)
   where d.family_id = p_family and d.year = season - 1 and g0.household_id is not null;
  prevh := prevh || prev;

  for lv in 1..array_length(levels, 1) loop
    a_recip := levels[lv][1] and n > 2; a_share := levels[lv][2]; a_prev := levels[lv][3]; a_prevh := levels[lv][4];
    banned := case when a_prevh then prevh when a_prev then prev else '{}'::text[] end;
    -- test rapide : chacun a-t-il assez de personnes possibles pour toutes les boucles ?
    if exists (
      select 1 from generate_series(1, n) gi2
       where (select count(*) from generate_series(1, n) j3
               where j3 <> gi2 and (houses[gi2] is null or houses[j3] is distinct from houses[gi2])
                 and not ((people[gi2] || '|' || people[j3]) = any(banned))) < p_rounds) then
      continue;
    end if;
    lv_start := clock_timestamp();
    for attempt in 1..150 loop
      -- au plus ~0,6 s par niveau de règles, pour rester rapide même quand un niveau est impossible
      exit when attempt > 20 and clock_timestamp() - lv_start > interval '600 milliseconds';
      used := '{}'; pairs := '{}'; ok := true;
      for t in 1..p_rounds loop
        taken := '{}'; assigned_g := '{}'; assigned_r := '{}';
        remaining := array(select generate_series(1, n) order by random());
        -- glouton « le plus contraint d'abord », relancé plusieurs fois au hasard
        while array_length(remaining, 1) > 0 loop
          best := null; best_cands := null;
          foreach gi in array remaining loop
            g := people[gi];
            cands := array(
              select people[j2] from generate_series(1, n) j2
               where people[j2] <> g
                 and (houses[gi] is null or houses[j2] is distinct from houses[gi])
                 and not (people[j2] = any(taken))
                 and not ((g || '|' || people[j2]) = any(used))
                 and not ((g || '|' || people[j2]) = any(banned))
                 and not (a_recip and (people[j2] || '|' || g) = any(used))
                 and not (a_recip and exists (select 1 from generate_series(1, coalesce(array_length(assigned_g, 1), 0)) q
                                              where assigned_g[q] = people[j2] and assigned_r[q] = g))
                 and not (a_share and houses[gi] is not null and exists (
                       select 1 from generate_series(1, n) mm
                        where mm <> gi and houses[mm] = houses[gi]
                          and (people[mm] || '|' || people[j2]) = any(used)))
               order by random());
            if best_cands is null or coalesce(array_length(cands, 1), 0) < coalesce(array_length(best_cands, 1), 0) then
              best := gi; best_cands := cands;
            end if;
          end loop;
          if coalesce(array_length(best_cands, 1), 0) = 0 then ok := false; exit; end if;
          g := people[best]; r := best_cands[1];
          taken := taken || r; assigned_g := assigned_g || g; assigned_r := assigned_r || r;
          remaining := array_remove(remaining, best);
        end loop;
        exit when not ok;
        for k in 1..n loop
          used := used || (assigned_g[k] || '|' || assigned_r[k]);
          pairs := pairs || (t || '|' || assigned_g[k] || '|' || assigned_r[k]);
        end loop;
      end loop;
      if ok then
        insert into draws (family_id, title, year, budget, rounds, created_by)
        values (p_family, coalesce(nullif(trim(p_title), ''), 'Amis secrets ' || season), season,
                coalesce(trim(p_budget), ''), p_rounds, me)
        returning id into draw_id;
        foreach p in array pairs loop
          insert into assignments (draw_id, round, giver_id, receiver_id)
          values (draw_id, split_part(p, '|', 1)::int, split_part(p, '|', 2)::uuid, split_part(p, '|', 3)::uuid);
        end loop;
        if not a_prev and array_length(prev, 1) > 0 then relaxed := relaxed || 'personnes tirées l’an dernier'::text; end if;
        if not a_share and has_mates then relaxed := relaxed || 'deux personnes d’un même foyer pour le même ami secret'::text; end if;
        if not a_recip and n > 2 then relaxed := relaxed || 'échanges réciproques'::text; end if;
        if not a_prevh and coalesce(array_length(prevh, 1), 0) > coalesce(array_length(prev, 1), 0) then
          relaxed := relaxed || 'personnes tirées l’an dernier par son foyer'::text;
        end if;
        return json_build_object('draw', draw_id, 'relaxed', to_json(relaxed));
      end if;
    end loop;
  end loop;
  raise exception 'Aucun tirage possible avec ces participants et ces foyers. Ajoutez des participants ou réduisez le nombre de boucles.';
end $$;

create or replace function public.delete_draw(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  select family_id into fam from draws where id = p_id;
  if not public.is_admin(fam) then raise exception 'Réservé aux organisateurs.'; end if;
  delete from draws where id = p_id;
end $$;

-- Participants du dernier tirage (pour pré-cocher le formulaire)
create or replace function public.last_draw_participants(p_family uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('rounds', d.rounds,
         'participants', (select json_agg(distinct a.giver_id) from assignments a where a.draw_id = d.id))
    from draws d where d.family_id = p_family and d.year < public.current_season() and public.is_member(p_family)
   order by d.year desc, d.created_at desc limit 1
$$;

-- ----------------------------------------------------------------------------- gestion (organisateurs)

create or replace function public._require_admin(fam uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(fam) then raise exception 'Réservé aux organisateurs de la famille.'; end if;
end $$;

create or replace function public.admin_update_member(p_member uuid, p_name text, p_household uuid, p_is_admin boolean, p_managers uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  select family_id into fam from members where id = p_member;
  perform public._require_admin(fam);
  if p_household is not null and not exists (select 1 from households where id = p_household and family_id = fam) then
    raise exception 'Foyer inconnu.';
  end if;
  update members set name = trim(p_name), household_id = p_household, is_admin = p_is_admin where id = p_member;
  delete from member_managers where member_id = p_member;
  insert into member_managers (member_id, user_id)
  select p_member, m.user_id from members m where m.family_id = fam and m.user_id = any(coalesce(p_managers, '{}'));
end $$;

create or replace function public.admin_add_profile(p_family uuid, p_name text, p_household uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  perform public._require_admin(p_family);
  insert into members (family_id, name, household_id) values (p_family, trim(p_name), p_household) returning id into mid;
  insert into member_managers values (mid, auth.uid());
  return mid;
end $$;

create or replace function public.admin_remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  select family_id into fam from members where id = p_member;
  perform public._require_admin(fam);
  if public.is_self(p_member) then raise exception 'Vous ne pouvez pas vous retirer vous-même.'; end if;
  delete from members where id = p_member;
end $$;

create or replace function public.admin_household(p_family uuid, p_name text, p_delete uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin(p_family);
  if p_delete is not null then
    delete from households where id = p_delete and family_id = p_family;
  else
    insert into households (family_id, name) values (p_family, trim(p_name));
  end if;
end $$;

create or replace function public.admin_family(p_family uuid, p_name text default null, p_new_invite boolean default false)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare code text;
begin
  perform public._require_admin(p_family);
  if p_name is not null and length(trim(p_name)) > 0 then update families set name = trim(p_name) where id = p_family; end if;
  if p_new_invite then update families set invite_code = encode(gen_random_bytes(9), 'hex') where id = p_family; end if;
  select invite_code into code from families where id = p_family;
  return code;
end $$;

-- Mot de passe oublié : l'organisateur donne un mot de passe provisoire.
create or replace function public.admin_reset_password(p_member uuid, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare fam uuid; uid uuid; uname text;
begin
  select family_id, user_id into fam, uid from members where id = p_member;
  perform public._require_admin(fam);
  if uid is null then raise exception 'Cette personne n''a pas encore de compte.'; end if;
  if length(p_password) < 6 then raise exception 'Au moins 6 caractères.'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = uid;
  select username into uname from accounts where user_id = uid;
  return uname;
end $$;

create or replace function public.admin_invite_code(p_family uuid) returns text
language sql stable security definer set search_path = public as $$
  select invite_code from families where id = p_family and public.is_admin(p_family)
$$;

create or replace function public.admin_usernames(p_family uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_object_agg(m.id, a.username) from members m join accounts a on a.user_id = m.user_id
   where m.family_id = p_family and public.is_admin(p_family)
$$;

-- ----------------------------------------------------------------------------- calendrier de l'Avent

create or replace function public.advent_calendar(p_family uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'day', a.day, 'open', a.day <= public.paris_today(),
           'title', case when a.day <= public.paris_today() or public.is_admin(p_family) then a.title else '' end,
           'text', case when a.day <= public.paris_today() or public.is_admin(p_family) then a.text else '' end,
           'cover', case when a.day <= public.paris_today() or public.is_admin(p_family) then a.cover_path else '' end,
           'inside', case when a.day <= public.paris_today() or public.is_admin(p_family) then a.inside_path else '' end)
         order by a.day), '[]'::json)
    from advent_days a
   where a.family_id = p_family and public.is_member(p_family)
     and extract(year from a.day) = public.current_season()
$$;

create or replace function public.advent_save(p_family uuid, p_day date, p_title text default null, p_text text default null,
  p_cover text default null, p_inside text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin(p_family);
  insert into advent_days (family_id, day, title, text, cover_path, inside_path)
  values (p_family, p_day, coalesce(p_title, ''), coalesce(p_text, ''), coalesce(p_cover, ''), coalesce(p_inside, ''))
  on conflict (family_id, day) do update set
    title = coalesce(p_title, advent_days.title), text = coalesce(p_text, advent_days.text),
    cover_path = coalesce(p_cover, advent_days.cover_path), inside_path = coalesce(p_inside, advent_days.inside_path);
end $$;

create or replace function public.advent_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid;
begin
  select family_id into fam from advent_days where id = p_id;
  perform public._require_admin(fam);
  delete from advent_days where id = p_id;
end $$;

-- Images : espace de stockage privé « avent ». Chemin : <famille>/<AAAA-MM-JJ>/<fichier>.
-- Lecture seulement à partir du jour (ou par un organisateur), écriture par les organisateurs.
insert into storage.buckets (id, name, public) values ('avent', 'avent', false) on conflict (id) do nothing;

create or replace function public.advent_file_ok(path text, for_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare fam uuid; d date;
begin
  begin
    fam := split_part(path, '/', 1)::uuid;
    d := split_part(path, '/', 2)::date;
  exception when others then return false;
  end;
  if for_write then return public.is_admin(fam); end if;
  return public.is_member(fam) and (d <= public.paris_today() or public.is_admin(fam));
end $$;

drop policy if exists "avent lecture" on storage.objects;
create policy "avent lecture" on storage.objects for select to authenticated
  using (bucket_id = 'avent' and public.advent_file_ok(name, false));
drop policy if exists "avent envoi" on storage.objects;
create policy "avent envoi" on storage.objects for insert to authenticated
  with check (bucket_id = 'avent' and public.advent_file_ok(name, true));
drop policy if exists "avent modification" on storage.objects;
create policy "avent modification" on storage.objects for update to authenticated
  using (bucket_id = 'avent' and public.advent_file_ok(name, true));
drop policy if exists "avent suppression" on storage.objects;
create policy "avent suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'avent' and public.advent_file_ok(name, true));

-- ----------------------------------------------------------------------------- droits d'exécution

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.login_email(text), public.invite_info(text),
  public.create_account(text, text, text, uuid) to anon;

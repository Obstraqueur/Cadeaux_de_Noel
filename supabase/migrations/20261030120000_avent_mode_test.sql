-- Calendrier de l'Avent : « mode test » (l'organisateur ouvre toutes les cases pour vérifier).
-- À coller dans Supabase : SQL Editor → New query → Run.

alter table public.families add column if not exists advent_open_all boolean not null default false;

create or replace function public.advent_is_open(fam uuid, d date) returns boolean
language sql stable security definer set search_path = public as $$
  select d <= public.paris_today() or coalesce((select advent_open_all from families where id = fam), false)
$$;

create or replace function public.advent_calendar(p_family uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'id', a.id, 'day', a.day,
           'open', public.advent_is_open(p_family, a.day),
           'preview', (select advent_open_all from families where id = p_family),
           'title', case when public.advent_is_open(p_family, a.day) or public.is_admin(p_family) then a.title else '' end,
           'text', case when public.advent_is_open(p_family, a.day) or public.is_admin(p_family) then a.text else '' end,
           'cover', case when public.advent_is_open(p_family, a.day) or public.is_admin(p_family) then a.cover_path else '' end,
           'inside', case when public.advent_is_open(p_family, a.day) or public.is_admin(p_family) then a.inside_path else '' end)
         order by a.day), '[]'::json)
    from advent_days a
   where a.family_id = p_family and public.is_member(p_family)
     and extract(year from a.day) = public.current_season()
$$;

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
  return public.is_member(fam) and (public.advent_is_open(fam, d) or public.is_admin(fam));
end $$;

create or replace function public.advent_test_mode(p_family uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_admin(p_family);
  update families set advent_open_all = p_on where id = p_family;
end $$;

revoke execute on function public.advent_test_mode(uuid, boolean), public.advent_is_open(uuid, date) from public, anon;
grant execute on function public.advent_test_mode(uuid, boolean), public.advent_is_open(uuid, date) to authenticated;

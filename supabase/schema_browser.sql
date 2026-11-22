-- ============================================================================
-- Lalu lintas browser.gowithdme.com -> Panel Admin (Statistik > Browser)
-- Jalankan di Supabase > SQL Editor SETELAH schema_rbac.sql (butuh has_perm / is_owner / _rbac_log).
-- Aman dijalankan berulang.
--
-- Alur:  browser.gowithdme.com (js/track.js) ──┐
--        Cloudflare Worker proxy (worker/proxy.js) ──┴─> RPC browser_log() ─> tabel browser_events
--        Panel admin ─> RPC admin_browser_stats() / admin_browser_recent()  (izin 'stats.view')
--
-- Privasi: yang dicatat hanya nama situs (host), path TANPA query/hash, jenis aksi, mode, status,
-- waktu muat, ukuran layar, dan kode acak per browser. TIDAK dicatat: IP, cookie, kata pencarian,
-- isi halaman, atau akun. Perbarui Kebijakan Privasi agar menyebut ini.
-- ============================================================================

-- 1) Tabel -------------------------------------------------------------------------
create table if not exists browser_events(
  id        bigserial primary key,
  at        timestamptz not null default now(),
  src       text not null check (src in ('client','proxy')),
  kind      text not null check (kind in
              ('open','nav','search','reload','load','notice','newtab','closetab','mode','size','bookmark','heartbeat','doc','asset','error')),
  sid       text,            -- kode acak per kunjungan (sessionStorage)
  vid       text,            -- kode acak per perangkat (localStorage)
  host      text,
  path      text,
  mode      text,            -- proxy | direct
  status    int,
  ms        int,
  bytes     bigint,
  width     int,
  device    text,            -- mobile | tablet | desktop
  lang      text,
  ref_host  text,
  meta      jsonb not null default '{}'::jsonb
);
create index if not exists browser_events_at   on browser_events(at desc);
create index if not exists browser_events_sid  on browser_events(sid, at);
create index if not exists browser_events_host on browser_events(host, at desc);
create index if not exists browser_events_kind on browser_events(kind, at desc);

-- Pengaturan rahasia (rahasia Worker). Tidak bisa dibaca lewat API.
create table if not exists browser_settings(key text primary key, value text not null);
alter table browser_events   enable row level security;
alter table browser_settings enable row level security;
revoke all on browser_events, browser_settings from anon, authenticated;
-- Tanpa policy = tidak ada akses langsung dari klien. Semua lewat fungsi security definer di bawah.

insert into browser_settings(key, value)
  select 'proxy_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  on conflict (key) do nothing;
-- Lihat rahasia untuk Worker:  select value from browser_settings where key='proxy_secret';

-- 2) Penulisan: browser_log (publik, dibatasi ketat) -----------------------------------
create or replace function _bl_txt(x jsonb, n int) returns text language sql immutable as $$
  select nullif(left(regexp_replace(coalesce(x #>> '{}', ''), '[[:cntrl:]]', '', 'g'), n), '') $$;

create or replace function _bl_int(x jsonb, lo bigint, hi bigint) returns bigint language plpgsql immutable as $$
declare v numeric;
begin
  if x is null or jsonb_typeof(x) <> 'number' then return null; end if;
  v := (x #>> '{}')::numeric;
  return greatest(lo, least(hi, floor(v)::bigint));
exception when others then return null;
end $$;

create or replace function browser_log(p_events jsonb, p_secret text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  e jsonb; n int := 0; srcv text; k text; s text; h text; secret_ok boolean := false; recent int;
  kinds_client constant text[] := array['open','nav','search','reload','load','notice','newtab','closetab','mode','size','bookmark','heartbeat'];
  kinds_proxy  constant text[] := array['doc','asset','error'];
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  if jsonb_array_length(p_events) > 25 then p_events := (select jsonb_agg(x) from (select x from jsonb_array_elements(p_events) x limit 25) q); end if;
  select exists(select 1 from browser_settings where key = 'proxy_secret' and value = p_secret and p_secret is not null) into secret_ok;

  for e in select * from jsonb_array_elements(p_events) loop
    srcv := case when secret_ok and e->>'src' = 'proxy' then 'proxy' else 'client' end;
    k := e->>'kind';
    if k is null then continue; end if;
    if srcv = 'client' and not (k = any(kinds_client)) then continue; end if;
    if srcv = 'proxy'  and not (k = any(kinds_proxy))  then continue; end if;
    s := _bl_txt(e->'sid', 40);
    h := lower(_bl_txt(e->'host', 120));
    if h is not null and (h !~ '^[a-z0-9.\-]+(:[0-9]+)?$' or h ~ '(^|\.)(localhost|local|internal)$') then h := null; end if;

    -- Batas kasar per kunjungan: maks 150 peristiwa per menit (cegah banjir)
    if srcv = 'client' and s is not null and n = 0 then
      select count(*) into recent from browser_events where sid = s and at > now() - interval '1 minute';
      if recent >= 150 then return 0; end if;
    end if;

    insert into browser_events(src, kind, sid, vid, host, path, mode, status, ms, bytes, width, device, lang, ref_host, meta)
    values (
      srcv, k, s, _bl_txt(e->'vid', 40), h, left(split_part(split_part(coalesce(e->>'path',''), '?', 1), '#', 1), 160),
      case when e->>'mode' in ('proxy','direct') then e->>'mode' end,
      _bl_int(e->'status', 0, 999), _bl_int(e->'ms', 0, 600000), _bl_int(e->'bytes', 0, 100000000000), _bl_int(e->'width', 0, 10000),
      case when e->>'device' in ('mobile','tablet','desktop') then e->>'device' end,
      lower(left(coalesce(e->>'lang',''), 2)),
      lower(_bl_txt(e->'ref_host', 120)),
      case when jsonb_typeof(e->'meta') = 'object' and length((e->'meta')::text) <= 300 then e->'meta' else '{}'::jsonb end
    );
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function browser_log(jsonb, text) from public;
grant execute on function browser_log(jsonb, text) to anon, authenticated;

-- 3) Membaca: ringkasan statistik (izin stats.view) --------------------------------------
create or replace function admin_browser_stats(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d int := greatest(1, least(coalesce(p_days, 30), 365));
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  prev  timestamptz := now() - make_interval(days => 2 * greatest(1, least(coalesce(p_days, 30), 365)));
  today date := (now() at time zone 'Asia/Jakarta')::date;
  r jsonb;
begin
  if not has_perm('stats.view') then raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501'; end if;

  with ev as (select * from browser_events where at >= prev),
  cur as (select * from ev where at >= since),
  sess as (select sid, min(at) a, max(at) b from cur where src = 'client' and sid is not null group by sid),
  px as (select * from cur where src = 'proxy')
  select jsonb_build_object(
    'days', d,
    'first_hit', (select min(at) from browser_events),
    'live_now', (select count(distinct sid) from browser_events where src = 'client' and at > now() - interval '2 minutes'),
    'sessions', (select count(*) from sess),
    'prev_sessions', (select count(distinct sid) from ev where src = 'client' and at < since),
    'visitors', (select count(distinct vid) from cur where src = 'client'),
    'prev_visitors', (select count(distinct vid) from ev where src = 'client' and at < since),
    'new_visitors', (select count(*) from (select vid from browser_events where src = 'client' and vid is not null group by vid having min(at) >= since) q),
    'navs', (select count(*) from cur where src = 'client' and kind in ('nav','search','reload')),
    'prev_navs', (select count(*) from ev where src = 'client' and at < since and kind in ('nav','search','reload')),
    'searches', (select count(*) from cur where kind = 'search'),
    'problems', (select count(*) from cur where kind = 'notice'),
    'today_navs', (select count(*) from cur where src = 'client' and kind in ('nav','search','reload') and (at at time zone 'Asia/Jakarta')::date = today),
    'today_sessions', (select count(distinct sid) from cur where src = 'client' and (at at time zone 'Asia/Jakarta')::date = today),
    'avg_sec', (select coalesce(round(avg(extract(epoch from b - a)))::int, 0) from sess),
    'avg_load_ms', (select coalesce(round(avg(ms))::int, 0) from cur where kind = 'load' and ms is not null),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('d', gs.g::text,
        'navs', coalesce(c.navs, 0), 'sessions', coalesce(c.sess, 0), 'proxy', coalesce(c.px, 0)) order by gs.g), '[]'::jsonb)
      from (select today - (d - 1 - i) as g from generate_series(0, d - 1) i) gs
      left join (
        select (at at time zone 'Asia/Jakarta')::date dd,
               count(*) filter (where src = 'client' and kind in ('nav','search','reload')) navs,
               count(distinct sid) filter (where src = 'client') sess,
               count(*) filter (where src = 'proxy' and kind = 'doc') px
        from cur group by 1) c on c.dd = gs.g),
    'hours', (
      select coalesce(jsonb_agg(coalesce(c.n, 0) order by h), '[]'::jsonb) from generate_series(0, 23) h
      left join (select extract(hour from at at time zone 'Asia/Jakarta')::int hh, count(*) n
                 from cur where src = 'client' and kind in ('nav','search','reload') group by 1) c on c.hh = h),
    'hosts', (select coalesce(jsonb_agg(jsonb_build_object('k', host, 'n', n, 'u', u)), '[]'::jsonb) from (
      select host, count(*) n, count(distinct sid) u from cur
      where src = 'client' and kind in ('nav','reload') and host is not null group by host order by n desc limit 15) q),
    'modes', (select coalesce(jsonb_agg(jsonb_build_object('k', mode, 'n', n)), '[]'::jsonb) from (
      select mode, count(*) n from cur where src = 'client' and kind in ('nav','search','reload') and mode is not null group by mode order by n desc) q),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('k', coalesce(device, '?'), 'n', n)), '[]'::jsonb) from (
      select device, count(distinct sid) n from cur where src = 'client' and kind = 'open' group by device order by n desc) q),
    'sizes', (select coalesce(jsonb_agg(jsonb_build_object('k', coalesce(width::text, '0'), 'n', n)), '[]'::jsonb) from (
      select width, count(*) n from cur where kind = 'size' group by width order by n desc limit 6) q),
    'refs', (select coalesce(jsonb_agg(jsonb_build_object('k', ref_host, 'n', n)), '[]'::jsonb) from (
      select ref_host, count(distinct sid) n from cur where kind = 'open' and ref_host is not null group by ref_host order by n desc limit 8) q),
    'problem_hosts', (select coalesce(jsonb_agg(jsonb_build_object('k', host, 'n', n, 'why', why)), '[]'::jsonb) from (
      select host, count(*) n, mode() within group (order by meta->>'type') why from cur
      where kind = 'notice' and host is not null group by host order by n desc limit 10) q),
    'proxy', jsonb_build_object(
      'requests', (select count(*) from px),
      'docs', (select count(*) from px where kind = 'doc'),
      'errors', (select count(*) from px where kind = 'error' or status >= 400),
      'bytes', (select coalesce(sum(bytes), 0) from px),
      'avg_ms', (select coalesce(round(avg(ms))::int, 0) from px where ms is not null),
      'p95_ms', (select coalesce(round(percentile_cont(0.95) within group (order by ms))::int, 0) from px where ms is not null),
      'status', (select coalesce(jsonb_agg(jsonb_build_object('k', cls, 'n', n)), '[]'::jsonb) from (
        select case when status is null then 'gagal' else (status / 100)::text || 'xx' end cls, count(*) n from px group by 1 order by 1) q),
      'err_hosts', (select coalesce(jsonb_agg(jsonb_build_object('k', host, 'n', n, 'st', st)), '[]'::jsonb) from (
        select host, count(*) n, mode() within group (order by status) st from px
        where (kind = 'error' or status >= 400) and host is not null group by host order by n desc limit 10) q),
      'slow_hosts', (select coalesce(jsonb_agg(jsonb_build_object('k', host, 'n', n, 'ms', ms)), '[]'::jsonb) from (
        select host, count(*) n, round(avg(ms))::int ms from px
        where kind = 'doc' and ms is not null and host is not null group by host having count(*) >= 2 order by avg(ms) desc limit 8) q),
      'top_hosts', (select coalesce(jsonb_agg(jsonb_build_object('k', host, 'n', n, 'b', b)), '[]'::jsonb) from (
        select host, count(*) n, coalesce(sum(bytes), 0) b from px where host is not null group by host order by n desc limit 10) q)
    )
  ) into r;
  return r;
end $$;
revoke all on function admin_browser_stats(int) from public, anon;
grant execute on function admin_browser_stats(int) to authenticated;

-- 4) Membaca: aliran peristiwa terbaru (izin stats.view) -------------------------------
create or replace function admin_browser_recent(
  p_limit int default 40, p_before bigint default null, p_host text default null, p_src text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_perm('stats.view') then raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501'; end if;
  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(q) order by q.id desc), '[]'::jsonb)) into r from (
    select id, at, src, kind, left(sid, 6) as sid, host, path, mode, status, ms, bytes, width, device
    from browser_events
    where (p_before is null or id < p_before)
      and (nullif(p_host, '') is null or host = lower(p_host))
      and (nullif(p_src, '') is null or src = p_src)
    order by id desc limit greatest(1, least(coalesce(p_limit, 40), 200))) q;
  return r;
end $$;
revoke all on function admin_browser_recent(int, bigint, text, text) from public, anon;
grant execute on function admin_browser_recent(int, bigint, text, text) to authenticated;

-- 5) Pembersihan data lama (khusus pemilik) -------------------------------------------
create or replace function admin_browser_purge(p_days int default 90) returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if not is_owner() then raise exception 'Hanya pemilik yang boleh menghapus data lalu lintas.' using errcode = '42501'; end if;
  delete from browser_events where at < now() - make_interval(days => greatest(7, coalesce(p_days, 90)));
  get diagnostics c = row_count;
  perform _rbac_log('browser_purge', null, jsonb_build_object('days', greatest(7, coalesce(p_days, 90)), 'deleted', c));
  return c;
end $$;
revoke all on function admin_browser_purge(int) from public, anon;
grant execute on function admin_browser_purge(int) to authenticated;

-- Opsional (Supabase > Database > Extensions > pg_cron), hapus otomatis data > 90 hari tiap malam:
-- select cron.schedule('browser-events-purge', '17 20 * * *', $$delete from public.browser_events where at < now() - interval '90 days'$$);

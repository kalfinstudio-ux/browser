-- ============================================================================
-- Moderasi browser.gowithdme.com: daftar blokir/peringatan host, laporan pengguna, statistik.
-- Jalankan di Supabase > SQL Editor SETELAH schema_rbac.sql dan schema_browser.sql. Aman diulang.
--
-- Alur:
--   Admin (Pemilik) kelola daftar ──> tabel browser_blocklist
--   Worker proxy ──> RPC browser_blocklist_get(secret) tiap ~60 detik ──> blokir / peringatkan di proxy
--   Halaman browser ──> RPC browser_blocklist_public() ──> cek lunak (berlaku juga untuk mode Langsung)
--   Pengguna "Laporkan situs" ──> RPC browser_report() ──> tabel browser_reports ──> panel admin
--
-- Yang dinilai hanya host (dan path tanpa query). Isi halaman, ketikan, dan IP tidak dibaca/disimpan.
-- Membaca: izin 'stats.view'. Mengubah daftar / menutup laporan / menghapus: khusus Pemilik (is_owner).
-- Semua perubahan dicatat ke log audit (_rbac_log).
-- ============================================================================

-- 1) Tabel ----------------------------------------------------------------------------
create table if not exists browser_blocklist(
  host       text primary key
             check (length(host) <= 120 and host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and position('.' in host) > 0),
  action     text not null check (action in ('block','warn')),
  reason     text check (reason is null or length(reason) <= 200),
  added_by   uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists browser_reports(
  id         bigserial primary key,
  at         timestamptz not null default now(),
  host       text not null,
  path       text,
  reason     text not null check (reason in ('berbahaya','penipuan','dewasa','lainnya')),
  sid        text,
  status     text not null default 'open' check (status in ('open','done')),
  handled_by uuid,
  handled_at timestamptz
);
create index if not exists browser_reports_open on browser_reports(status, at desc);
create index if not exists browser_reports_host on browser_reports(host, at desc);

alter table browser_blocklist enable row level security;
alter table browser_reports   enable row level security;
revoke all on browser_blocklist, browser_reports from anon, authenticated;
-- Tanpa policy = tidak ada akses langsung dari klien. Semua lewat fungsi security definer di bawah.

-- 2) Pembantu: normalisasi host ---------------------------------------------------------
-- "https://www.Contoh.com:8080/a?x" -> "contoh.com". Subdomain ikut tercakup saat dicocokkan.
create or replace function _mod_host(t text) returns text language sql immutable as $$
  select nullif(regexp_replace(lower(split_part(split_part(split_part(
           regexp_replace(btrim(coalesce(t, '')), '^[a-zA-Z]+://', ''), '/', 1), '?', 1), ':', 1)), '^www\.', ''), '')
$$;

-- 3) Dibaca Worker (butuh rahasia proxy) ------------------------------------------------
create or replace function browser_blocklist_get(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_secret is null or not exists(select 1 from browser_settings where key = 'proxy_secret' and value = p_secret) then
    raise exception 'Rahasia proxy salah.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('host', host, 'action', action, 'reason', reason)) from browser_blocklist), '[]'::jsonb);
end $$;
revoke all on function browser_blocklist_get(text) from public;
grant execute on function browser_blocklist_get(text) to anon, authenticated;

-- 4) Dibaca halaman browser (publik, tanpa alasan) -----------------------------------------
create or replace function browser_blocklist_public() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('host', host, 'action', action)), '[]'::jsonb) from browser_blocklist
$$;
revoke all on function browser_blocklist_public() from public;
grant execute on function browser_blocklist_public() to anon, authenticated;

-- 5) Laporan dari pengguna (publik, dibatasi ketat) -----------------------------------------
create or replace function browser_report(p_host text, p_path text default null, p_reason text default 'lainnya', p_sid text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare h text := _mod_host(p_host); s text := left(nullif(regexp_replace(coalesce(p_sid, ''), '[[:cntrl:]]', '', 'g'), ''), 40);
begin
  if h is null or length(h) > 120 or h !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or position('.' in h) = 0
     or h ~ '(^|\.)(localhost|local|internal)$' then return false; end if;
  if p_reason is null or p_reason not in ('berbahaya','penipuan','dewasa','lainnya') then return false; end if;
  -- Batas: 5 laporan / 10 menit per kunjungan, 300 laporan / jam secara global
  if s is not null and (select count(*) from browser_reports where sid = s and at > now() - interval '10 minutes') >= 5 then return false; end if;
  if (select count(*) from browser_reports where at > now() - interval '1 hour') >= 300 then return false; end if;
  -- Laporan yang sama dari kunjungan yang sama dalam 1 hari tidak digandakan
  if exists(select 1 from browser_reports where host = h and coalesce(sid, '') = coalesce(s, '') and at > now() - interval '1 day') then return true; end if;
  insert into browser_reports(host, path, reason, sid)
  values (h, left(split_part(split_part(coalesce(p_path, ''), '?', 1), '#', 1), 160), p_reason, s);
  return true;
end $$;
revoke all on function browser_report(text, text, text, text) from public;
grant execute on function browser_report(text, text, text, text) to anon, authenticated;

-- 6) Panel admin: daftar aturan ----------------------------------------------------------
create or replace function admin_blocklist_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('stats.view') then raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501'; end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(to_jsonb(q) order by q.updated_at desc) from (
      select host, action, reason, created_at, updated_at from browser_blocklist) q), '[]'::jsonb));
end $$;
revoke all on function admin_blocklist_list() from public, anon;
grant execute on function admin_blocklist_list() to authenticated;

create or replace function admin_blocklist_set(p_host text, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare h text := _mod_host(p_host); r text := left(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), ''), 200);
begin
  if not is_owner() then raise exception 'Hanya pemilik yang boleh mengubah daftar blokir.' using errcode = '42501'; end if;
  if p_action not in ('block','warn') then raise exception 'Aksi harus block atau warn.' using errcode = '22023'; end if;
  if h is null or length(h) > 120 or h !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or position('.' in h) = 0 then
    raise exception 'Nama situs tidak valid. Contoh: contoh.com' using errcode = '22023'; end if;
  insert into browser_blocklist(host, action, reason) values (h, p_action, r)
  on conflict (host) do update set action = excluded.action, reason = excluded.reason, updated_at = now();
  perform _rbac_log('browser_blocklist_set', null, jsonb_build_object('host', h, 'action', p_action));
end $$;
revoke all on function admin_blocklist_set(text, text, text) from public, anon;
grant execute on function admin_blocklist_set(text, text, text) to authenticated;

create or replace function admin_blocklist_remove(p_host text) returns boolean
language plpgsql security definer set search_path = public as $$
declare h text := _mod_host(p_host); c int;
begin
  if not is_owner() then raise exception 'Hanya pemilik yang boleh mengubah daftar blokir.' using errcode = '42501'; end if;
  delete from browser_blocklist where host = h;
  get diagnostics c = row_count;
  if c > 0 then perform _rbac_log('browser_blocklist_remove', null, jsonb_build_object('host', h)); end if;
  return c > 0;
end $$;
revoke all on function admin_blocklist_remove(text) from public, anon;
grant execute on function admin_blocklist_remove(text) to authenticated;

-- 7) Panel admin: laporan pengguna (dikelompokkan per situs) ---------------------------------
create or replace function admin_reports_list(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('stats.view') then raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501'; end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(to_jsonb(q) order by q.last_at desc) from (
      select r.host, count(*) as n, count(distinct r.sid) as u, max(r.at) as last_at,
             mode() within group (order by r.reason) as top_reason,
             (select b.action from browser_blocklist b where b.host = r.host) as listed
      from browser_reports r where r.status = 'open'
      group by r.host order by max(r.at) desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))) q), '[]'::jsonb));
end $$;
revoke all on function admin_reports_list(int) from public, anon;
grant execute on function admin_reports_list(int) to authenticated;

create or replace function admin_reports_resolve(p_host text) returns int
language plpgsql security definer set search_path = public as $$
declare h text := _mod_host(p_host); c int;
begin
  if not is_owner() then raise exception 'Hanya pemilik yang boleh menutup laporan.' using errcode = '42501'; end if;
  update browser_reports set status = 'done', handled_by = auth.uid(), handled_at = now() where host = h and status = 'open';
  get diagnostics c = row_count;
  if c > 0 then perform _rbac_log('browser_reports_resolve', null, jsonb_build_object('host', h, 'count', c)); end if;
  return c;
end $$;
revoke all on function admin_reports_resolve(text) from public, anon;
grant execute on function admin_reports_resolve(text) to authenticated;

-- 8) Panel admin: statistik moderasi (dari catatan proxy: meta.type = blocked | warned | limited) ----
create or replace function admin_moderation_stats(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not has_perm('stats.view') then raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'blocked', (select count(*) from browser_events where src = 'proxy' and at >= since and meta->>'type' = 'blocked'),
    'warned',  (select count(*) from browser_events where src = 'proxy' and at >= since and meta->>'type' = 'warned'),
    'limited', (select count(*) from browser_events where src = 'proxy' and at >= since and meta->>'type' = 'limited'),
    'listed',  (select count(*) from browser_blocklist),
    'reports_open', (select count(distinct host) from browser_reports where status = 'open'),
    'top_blocked', (select coalesce(jsonb_agg(jsonb_build_object('k', host, 'n', n)), '[]'::jsonb) from (
        select host, count(*) n from browser_events
        where src = 'proxy' and at >= since and meta->>'type' = 'blocked' and host is not null
        group by host order by n desc limit 10) q));
end $$;
revoke all on function admin_moderation_stats(int) from public, anon;
grant execute on function admin_moderation_stats(int) to authenticated;

-- 9) Pembersihan laporan lama (khusus pemilik) -------------------------------------------
create or replace function admin_reports_purge(p_days int default 90) returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if not is_owner() then raise exception 'Hanya pemilik yang boleh menghapus laporan.' using errcode = '42501'; end if;
  delete from browser_reports where at < now() - make_interval(days => greatest(30, coalesce(p_days, 90)));
  get diagnostics c = row_count;
  perform _rbac_log('browser_reports_purge', null, jsonb_build_object('days', greatest(30, coalesce(p_days, 90)), 'deleted', c));
  return c;
end $$;
revoke all on function admin_reports_purge(int) from public, anon;
grant execute on function admin_reports_purge(int) to authenticated;

-- Opsional (pg_cron): hapus otomatis laporan > 90 hari tiap malam, bersama data lalu lintas:
-- select cron.schedule('browser-reports-purge', '19 20 * * *', $$delete from public.browser_reports where at < now() - interval '90 days'$$);

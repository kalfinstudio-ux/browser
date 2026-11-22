-- ============================================================================
-- Aktivitas per kunjungan browser.gowithdme.com -> Panel Admin (Statistik > Browser)
-- Jalankan di Supabase > SQL Editor SETELAH schema_rbac.sql dan schema_browser.sql.
-- Aman dijalankan berulang.
--
-- Menambah dua fungsi (izin 'stats.view'):
--   admin_browser_sessions(...)  daftar kunjungan terbaru: kapan, berapa lama, perangkat, situs yang dibuka
--   admin_browser_session(sid)   linimasa satu kunjungan: urutan situs/aksi dari "open" sampai terakhir
--
-- Batas privasi TIDAK diubah: data tetap hanya host, path tanpa query/hash, jenis aksi, mode,
-- status, waktu muat, ukuran layar, dan kode acak per kunjungan. Tidak ada IP, akun, cookie,
-- atau kata pencarian. "Pengguna" di sini = satu kunjungan anonim (kode acak), bukan orang.
-- Setiap pembukaan linimasa dicatat ke log audit admin (_rbac_log).
-- ============================================================================

-- Daftar kunjungan ----------------------------------------------------------------------
create or replace function admin_browser_sessions(
  p_days   int         default 7,
  p_limit  int         default 30,
  p_before timestamptz default null,   -- paginasi: isi dengan last_at baris terakhir
  p_host   text        default null    -- hanya kunjungan yang pernah membuka situs ini
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
  r jsonb;
begin
  if not has_perm('stats.view') then
    raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501';
  end if;

  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(q) order by q.last_at desc), '[]'::jsonb)) into r
  from (
    select
      sid,
      min(at)                                                        as first_at,
      max(at)                                                        as last_at,
      extract(epoch from max(at) - min(at))::int                     as duration_sec,
      count(*)                                                       as events,
      count(*) filter (where kind in ('nav','search','reload'))      as pages,
      count(*) filter (where kind = 'search')                        as searches,
      count(*) filter (where kind = 'notice')                        as problems,
      (array_agg(device   order by at) filter (where device   is not null))[1] as device,
      (array_agg(lang     order by at) filter (where lang     is not null and lang <> ''))[1] as lang,
      (array_agg(ref_host order by at) filter (where kind = 'open' and ref_host is not null))[1] as ref_host,
      (array_agg(distinct host) filter (where kind in ('nav','reload') and host is not null))[1:5] as hosts,
      max(at) > now() - interval '2 minutes'                         as live
    from browser_events
    where src = 'client' and sid is not null and at >= since
    group by sid
    having (p_before is null or max(at) < p_before)
       and (nullif(p_host, '') is null or bool_or(host = lower(p_host)))
    order by max(at) desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) q;
  return r;
end $$;
revoke all on function admin_browser_sessions(int, int, timestamptz, text) from public, anon;
grant execute on function admin_browser_sessions(int, int, timestamptz, text) to authenticated;

-- Linimasa satu kunjungan -----------------------------------------------------------------
-- Volatile (bukan stable) karena menulis log audit.
create or replace function admin_browser_session(p_sid text, p_limit int default 300) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s text := left(coalesce(p_sid, ''), 40);
  r jsonb;
begin
  if not has_perm('stats.view') then
    raise exception 'Tidak punya izin melihat statistik.' using errcode = '42501';
  end if;
  if s = '' then
    raise exception 'sid wajib diisi.' using errcode = '22023';
  end if;

  perform _rbac_log('browser_session_view', null, jsonb_build_object('sid', left(s, 6)));

  select jsonb_build_object(
    'sid', s,
    'rows', coalesce(jsonb_agg(to_jsonb(q) order by q.at), '[]'::jsonb)
  ) into r
  from (
    select id, at, kind, host, path, mode, status, ms, width, device, meta,
           -- jeda dari peristiwa sebelumnya (detik): berguna untuk melihat lama di satu halaman
           extract(epoch from at - lag(at) over (order by at, id))::int as gap_sec
    from browser_events
    where src = 'client' and sid = s and kind <> 'heartbeat'
    order by at, id
    limit greatest(1, least(coalesce(p_limit, 300), 1000))
  ) q;
  return r;
end $$;
revoke all on function admin_browser_session(text, int) from public, anon;
grant execute on function admin_browser_session(text, int) to authenticated;

-- Contoh (dari panel admin / SQL Editor):
--   select admin_browser_sessions(7, 30);
--   select admin_browser_session('<sid dari daftar di atas>');
-- Dari JavaScript (sama seperti admin_browser_recent di js/admin-stats.js):
--   sb.rpc("admin_browser_sessions", { p_days: 7, p_limit: 30, p_before: null, p_host: null })
--   sb.rpc("admin_browser_session",  { p_sid: sid })

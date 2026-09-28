-- ============================================================
--  Giai đoạn K — QR CHUNG THEO CA (shared-shift check-in)
--  • shift_timeframes: các ca làm việc (vd Ca sáng 07:30–11:30).
--  • RPC shift_check_in(p_shift): GV quét 1 QR chung của ca → hệ thống
--    tự tìm buổi dạy của GV đó trong ca, kiểm tra giờ phía máy chủ
--    (chống dùng ảnh chụp ngoài giờ), ghi check-in đúng giờ / đi trễ.
--  Chạy sau phaseC-checkin.sql. An toàn chạy lại. Supabase → SQL Editor.
-- ============================================================
begin;

create table if not exists public.shift_timeframes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null default '',
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists shift_timeframes_tenant_idx on public.shift_timeframes(tenant_id);

do $$ declare t text := 'shift_timeframes';
begin
  execute format('drop trigger if exists set_tenant_%1$s on public.%1$s', t);
  execute format('create trigger set_tenant_%1$s before insert on public.%1$s for each row execute function public.set_tenant()', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists "%1$s tenant read" on public.%1$s', t);
  execute format('drop policy if exists "%1$s tenant write" on public.%1$s', t);
  execute format('create policy "%1$s tenant read" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant())', t);
  execute format('create policy "%1$s tenant write" on public.%1$s for all to authenticated using (tenant_id = public.current_tenant() and public.is_staff()) with check (tenant_id = public.current_tenant() and public.is_staff())', t);
end $$;

-- RPC: GV quét QR chung của một ca → check-in buổi của mình trong ca đó.
-- SECURITY DEFINER để GV (không phải staff) tự ghi được. Kiểm tra giờ phía máy chủ.
create or replace function public.shift_check_in(p_shift uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_caller uuid;
  v_shift record; v_sess record;
  v_now_ts timestamptz := now();
  v_now_time time := (v_now_ts at time zone 'Asia/Ho_Chi_Minh')::time;
  v_today date := (v_now_ts at time zone 'Asia/Ho_Chi_Minh')::date;
  v_grace_win interval := interval '20 minutes';   -- biên giờ cho phép quét quanh ca
  v_grace_late int := 10;                          -- phút được coi là "đúng giờ"
  v_status text; v_sched timestamptz;
begin
  if v_tenant is null then raise exception 'Chưa xác định workspace.'; end if;
  select id into v_caller from public.teachers where user_id = auth.uid() and tenant_id = v_tenant;
  if v_caller is null then raise exception 'Tài khoản chưa liên kết giáo viên.'; end if;

  select * into v_shift from public.shift_timeframes where id = p_shift and tenant_id = v_tenant and active;
  if not found then raise exception 'Ca làm việc không hợp lệ hoặc đã tắt.'; end if;

  -- Chống ảnh chụp ngoài giờ: chỉ quét được trong khung giờ ca (± biên).
  if v_now_time < v_shift.start_time - v_grace_win or v_now_time > v_shift.end_time + v_grace_win then
    raise exception 'Ngoài giờ ca % (%–%). Giờ hiện tại %.',
      v_shift.label, to_char(v_shift.start_time,'HH24:MI'), to_char(v_shift.end_time,'HH24:MI'), to_char(v_now_time,'HH24:MI');
  end if;

  -- Tìm buổi dạy CỦA GV trong ca hôm nay: giờ bắt đầu nằm trong khung ca.
  -- Ưu tiên buổi CHƯA check-in, rồi tới buổi gần giờ hiện tại nhất.
  select s.id, s.date, s.start_time,
         exists(select 1 from public.teacher_checkins tc where tc.session_id = s.id) as has_ck
    into v_sess
  from public.sessions s join public.classes c on c.id = s.class_id
  where s.tenant_id = v_tenant and s.date = v_today and s.status <> 'cancelled'
    and coalesce(s.teacher_id, c.teacher_id) = v_caller
    and s.start_time >= v_shift.start_time - v_grace_win
    and s.start_time <= v_shift.end_time + v_grace_win
  order by has_ck asc, abs(extract(epoch from (s.start_time - v_now_time))) asc
  limit 1;
  if not found then raise exception 'Bạn không có buổi dạy nào trong ca % hôm nay.', v_shift.label; end if;

  v_sched := (v_sess.date::timestamp + v_sess.start_time) at time zone 'Asia/Ho_Chi_Minh';
  v_status := case when v_now_ts > v_sched + make_interval(mins => v_grace_late) then 'late' else 'on_time' end;

  insert into public.teacher_checkins(tenant_id, session_id, teacher_id, status, source, scheduled_at, checked_in_at, note, created_by)
  values (v_tenant, v_sess.id, v_caller, v_status, 'qr', v_sched, v_now_ts, '', auth.uid())
  on conflict (tenant_id, session_id) do update
    set teacher_id = excluded.teacher_id, status = excluded.status, source = 'qr',
        checked_in_at = coalesce(public.teacher_checkins.checked_in_at, excluded.checked_in_at), updated_at = now();
  return v_sess.id;
end $$;
grant execute on function public.shift_check_in(uuid) to authenticated;

commit;
select 'phaseK OK — QR chung theo ca sẵn sàng (shift_timeframes, shift_check_in)' as status;

-- ============================================================
--  Giai đoạn L — Dạy thay (Substitute) + phân bổ lương
--  • sessions.sub_needed  : buổi cần dạy thay (cờ).
--  • sessions.substitute_id: giáo viên dạy thay cho buổi đó.
--  • Check-in: GV dạy thay là "người dạy thực tế" của buổi → cập nhật RPC
--    teacher_check_in và shift_check_in dùng người phụ trách hiệu lực =
--    coalesce(substitute_id, teacher_id, class.teacher_id).
--  Lương phân bổ (0đ cho GV chính vắng, credit cho GV dạy thay) xử lý ở
--  tầng ứng dụng (sm-payroll.js) — không cần đổi bảng lương.
--  Chạy sau phaseK-shifts.sql. An toàn chạy lại. Supabase → SQL Editor.
-- ============================================================
begin;

alter table public.sessions add column if not exists sub_needed boolean not null default false;
alter table public.sessions add column if not exists substitute_id uuid references public.teachers(id) on delete set null;

-- Check-in 1 buổi: người phụ trách hiệu lực gồm cả GV dạy thay.
create or replace function public.teacher_check_in(p_session uuid, p_teacher uuid default null, p_status text default null, p_note text default '')
  returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_sess record; v_caller uuid; v_eff uuid; v_target uuid; v_staff boolean; v_status text; v_sched timestamptz;
  v_grace int := 10;
begin
  if v_tenant is null then raise exception 'Chưa xác định workspace.'; end if;
  select s.id, s.teacher_id, s.substitute_id, s.date, s.start_time, s.status, c.teacher_id as class_teacher
    into v_sess from public.sessions s join public.classes c on c.id = s.class_id
    where s.id = p_session and s.tenant_id = v_tenant;
  if not found then raise exception 'Không tìm thấy buổi học trong workspace.'; end if;

  v_staff := public.is_staff();
  select id into v_caller from public.teachers where user_id = auth.uid() and tenant_id = v_tenant;
  v_eff := coalesce(v_sess.substitute_id, v_sess.teacher_id, v_sess.class_teacher);   -- gồm cả GV dạy thay
  v_target := coalesce(p_teacher, v_caller, v_eff);

  if not v_staff then
    if v_caller is null then raise exception 'Tài khoản chưa liên kết giáo viên.'; end if;
    if v_eff is distinct from v_caller then raise exception 'Bạn không phụ trách buổi học này.'; end if;
    v_target := v_caller;
  end if;
  if v_target is null then raise exception 'Buổi học chưa gán giáo viên.'; end if;

  v_sched := (v_sess.date::timestamp + v_sess.start_time) at time zone 'Asia/Ho_Chi_Minh';
  if p_status is not null then v_status := p_status;
  else v_status := case when now() > v_sched + make_interval(mins => v_grace) then 'late' else 'on_time' end;
  end if;

  insert into public.teacher_checkins(tenant_id, session_id, teacher_id, status, source, scheduled_at, checked_in_at, note, created_by)
  values (v_tenant, p_session, v_target, v_status,
          case when v_staff and p_status is not null then 'admin' when v_staff then 'manual' else 'qr' end,
          v_sched,
          case when v_status in ('absent_excused','confirmed','absent') then null else now() end,
          coalesce(p_note, ''), auth.uid())
  on conflict (tenant_id, session_id) do update
    set teacher_id = excluded.teacher_id, status = excluded.status, source = excluded.source,
        checked_in_at = coalesce(excluded.checked_in_at, public.teacher_checkins.checked_in_at),
        note = excluded.note, updated_at = now();
  return v_status;
end $$;
grant execute on function public.teacher_check_in(uuid, uuid, text, text) to authenticated;

-- QR chung theo ca: khớp buổi theo người phụ trách hiệu lực (gồm GV dạy thay).
create or replace function public.shift_check_in(p_shift uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_caller uuid; v_shift record; v_sess record;
  v_now_ts timestamptz := now();
  v_now_time time := (v_now_ts at time zone 'Asia/Ho_Chi_Minh')::time;
  v_today date := (v_now_ts at time zone 'Asia/Ho_Chi_Minh')::date;
  v_grace_win interval := interval '20 minutes';
  v_grace_late int := 10;
  v_status text; v_sched timestamptz;
begin
  if v_tenant is null then raise exception 'Chưa xác định workspace.'; end if;
  select id into v_caller from public.teachers where user_id = auth.uid() and tenant_id = v_tenant;
  if v_caller is null then raise exception 'Tài khoản chưa liên kết giáo viên.'; end if;

  select * into v_shift from public.shift_timeframes where id = p_shift and tenant_id = v_tenant and active;
  if not found then raise exception 'Ca làm việc không hợp lệ hoặc đã tắt.'; end if;

  if v_now_time < v_shift.start_time - v_grace_win or v_now_time > v_shift.end_time + v_grace_win then
    raise exception 'Ngoài giờ ca % (%–%). Giờ hiện tại %.',
      v_shift.label, to_char(v_shift.start_time,'HH24:MI'), to_char(v_shift.end_time,'HH24:MI'), to_char(v_now_time,'HH24:MI');
  end if;

  select s.id, s.date, s.start_time,
         exists(select 1 from public.teacher_checkins tc where tc.session_id = s.id) as has_ck
    into v_sess
  from public.sessions s join public.classes c on c.id = s.class_id
  where s.tenant_id = v_tenant and s.date = v_today and s.status <> 'cancelled'
    and coalesce(s.substitute_id, s.teacher_id, c.teacher_id) = v_caller     -- gồm cả GV dạy thay
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
select 'phaseL OK — dạy thay + phân bổ lương sẵn sàng (sessions.substitute_id/sub_needed)' as status;

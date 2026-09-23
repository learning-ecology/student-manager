-- ============================================================
--  Giai đoạn C — CHECK-IN GIÁO VIÊN (QR / thủ công)
--  • teacher_checkins: 1 bản ghi / buổi — GV nào dạy, đúng giờ/muộn/vắng/đã xác nhận,
--    nguồn (qr/manual/admin), giờ theo lịch, giờ check-in thực tế.
--  • RPC teacher_check_in: GV tự quét QR check-in buổi CỦA MÌNH (chống check-in nhầm lớp),
--    hoặc nhân viên (staff) chấm cho GV. Chống trùng: 1 buổi 1 bản ghi (idempotent).
--  Không tự trừ lương khi thiếu check-in — chỉ để đối chiếu/xác nhận (Giai đoạn D).
--  Chạy sau multitenant.sql. An toàn chạy lại. Supabase → SQL Editor → Run.
-- ============================================================
begin;

create table if not exists public.teacher_checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  status text not null default 'on_time'
    check (status in ('on_time','late','absent_excused','confirmed','absent')),
  source text not null default 'manual' check (source in ('qr','manual','admin')),
  scheduled_at timestamptz,              -- giờ dạy theo lịch (ngày + giờ bắt đầu)
  checked_in_at timestamptz,             -- thời điểm check-in thực tế (null nếu xác nhận thủ công/vắng)
  note text default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id)
);
create index if not exists teacher_checkins_tenant_idx on public.teacher_checkins(tenant_id);
create index if not exists teacher_checkins_session_idx on public.teacher_checkins(session_id);

-- tenant tự động + RLS (đọc: cùng tenant; ghi trực tiếp: nhân viên — cho bảng chấm công thủ công)
do $$ declare t text := 'teacher_checkins';
begin
  execute format('drop trigger if exists set_tenant_%1$s on public.%1$s', t);
  execute format('create trigger set_tenant_%1$s before insert on public.%1$s for each row execute function public.set_tenant()', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists "%1$s tenant read" on public.%1$s', t);
  execute format('drop policy if exists "%1$s tenant write" on public.%1$s', t);
  execute format('create policy "%1$s tenant read" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant())', t);
  execute format('create policy "%1$s tenant write" on public.%1$s for all to authenticated using (tenant_id = public.current_tenant() and public.is_staff()) with check (tenant_id = public.current_tenant() and public.is_staff())', t);
end $$;

-- RPC: check-in an toàn (GV tự quét, hoặc staff chấm hộ). SECURITY DEFINER để GV (không phải staff) vẫn ghi được đúng buổi của mình.
create or replace function public.teacher_check_in(p_session uuid, p_teacher uuid default null, p_status text default null, p_note text default '')
  returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant();
  v_sess record; v_caller uuid; v_eff uuid; v_target uuid; v_staff boolean; v_status text; v_sched timestamptz;
  v_grace int := 10;                                  -- phút được coi là "đúng giờ"
begin
  if v_tenant is null then raise exception 'Chưa xác định workspace.'; end if;
  select s.id, s.teacher_id, s.date, s.start_time, s.status, c.teacher_id as class_teacher
    into v_sess from public.sessions s join public.classes c on c.id = s.class_id
    where s.id = p_session and s.tenant_id = v_tenant;
  if not found then raise exception 'Không tìm thấy buổi học trong workspace.'; end if;

  v_staff := public.is_staff();
  select id into v_caller from public.teachers where user_id = auth.uid() and tenant_id = v_tenant;
  v_eff := coalesce(v_sess.teacher_id, v_sess.class_teacher);          -- GV phụ trách buổi
  v_target := coalesce(p_teacher, v_caller, v_eff);

  if not v_staff then                                                  -- GV tự check-in: chỉ buổi của mình
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

commit;
select 'phaseC OK — check-in giáo viên sẵn sàng (teacher_checkins, teacher_check_in)' as status;

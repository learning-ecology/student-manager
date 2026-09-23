-- ============================================================
--  Giai đoạn E — TÀI KHOẢN GIÁO VIÊN & PHÂN QUYỀN (RBAC)
--  Giáo viên (app_users.role='teacher', liên kết teachers.user_id) khi đăng nhập
--  CHỈ thấy dữ liệu của mình: lớp mình dạy, buổi/lịch, học viên trong lớp đó,
--  chấm công của mình, và LƯƠNG của mình. KHÔNG thấy lương/định mức của GV khác,
--  không thấy học phí/hóa đơn/thanh toán của học viên.
--
--  AN TOÀN: mọi policy dạng "is_staff() OR <phạm vi GV>" nên CHỦ/QUẢN TRỊ
--  (owner/admin) GIỮ NGUYÊN toàn quyền như cũ. Chạy sau các phase trước.
--  Idempotent. Supabase → SQL Editor → Run.
-- ============================================================
begin;

-- ---------- Hàm tiện ích (security definer → bỏ qua RLS khi kiểm tra) ----------
create or replace function public.my_teacher_id() returns uuid
  language sql security definer stable set search_path=public as $$
  select id from public.teachers where user_id = auth.uid() and tenant_id = public.current_tenant() limit 1; $$;

create or replace function public.teacher_sees_class(p_class uuid) returns boolean
  language sql security definer stable set search_path=public as $$
  select public.my_teacher_id() is not null and (
      exists(select 1 from public.classes  c where c.id = p_class and c.teacher_id = public.my_teacher_id())
   or exists(select 1 from public.sessions s where s.class_id = p_class and s.teacher_id = public.my_teacher_id())); $$;

create or replace function public.teacher_sees_session(p_session uuid) returns boolean
  language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.sessions s join public.classes c on c.id = s.class_id
    where s.id = p_session and public.my_teacher_id() is not null
      and (coalesce(s.teacher_id, c.teacher_id) = public.my_teacher_id() or c.teacher_id = public.my_teacher_id())); $$;

create or replace function public.teacher_sees_student(p_student uuid) returns boolean
  language sql security definer stable set search_path=public as $$
  select public.my_teacher_id() is not null and exists(
    select 1 from public.enrollments e where e.student_id = p_student and public.teacher_sees_class(e.class_id)); $$;

grant execute on function public.my_teacher_id(), public.teacher_sees_class(uuid), public.teacher_sees_session(uuid), public.teacher_sees_student(uuid) to authenticated;

-- ---------- Policy ĐỌC theo phạm vi (staff full, GV chỉ của mình) ----------
do $$
declare rec record; t text;
begin
  -- bảng : điều kiện phạm vi GV
  for rec in select * from (values
      ('classes',         'public.teacher_sees_class(id)'),
      ('sessions',        'public.teacher_sees_class(class_id)'),
      ('class_schedules', 'public.teacher_sees_class(class_id)'),
      ('enrollments',     'public.teacher_sees_class(class_id)'),
      ('students',        'public.teacher_sees_student(id)'),
      ('attendance',      'public.teacher_sees_session(session_id)'),
      ('teacher_checkins','teacher_id = public.my_teacher_id()'),
      ('teacher_rates',   'teacher_id = public.my_teacher_id()'),
      ('teacher_payslips','teacher_id = public.my_teacher_id()')
    ) as x(tbl, cond)
  loop
    execute format('drop policy if exists "%1$s tenant read" on public.%1$s', rec.tbl);
    execute format('create policy "%1$s tenant read" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant() and (public.is_staff() or %2$s))', rec.tbl, rec.cond);
  end loop;

  -- Tài chính học viên: CHỈ nhân viên được đọc (GV không thấy)
  foreach t in array array['tuition_rates','invoices','invoice_lines','payments','adjustments','transfers']
  loop
    execute format('drop policy if exists "%1$s tenant read" on public.%1$s', t);
    execute format('create policy "%1$s tenant read" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant() and public.is_staff())', t);
  end loop;
end $$;
-- teachers / holidays / settings: giữ ĐỌC theo tenant cho mọi người (tên GV, ngày lễ, tên trung tâm) — không đổi.

-- ---------- Liên kết tài khoản đăng nhập cho giáo viên (chủ sở hữu) ----------
-- Chủ tạo tài khoản (email + mật khẩu) trong Supabase → Authentication, rồi liên kết ở đây bằng email.
create or replace function public.link_teacher_account(p_teacher uuid, p_email text)
  returns text language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_tenant uuid := public.current_tenant();
begin
  if not public.is_owner() then raise exception 'Chỉ chủ sở hữu được liên kết tài khoản.'; end if;
  if not exists(select 1 from public.teachers where id = p_teacher and tenant_id = v_tenant) then raise exception 'Không tìm thấy giáo viên.'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'Chưa có tài khoản đăng nhập với email này. Hãy tạo trong Supabase → Authentication trước, rồi liên kết lại.'; end if;
  if exists(select 1 from public.teachers where user_id = v_uid and id <> p_teacher) then raise exception 'Tài khoản này đã liên kết với giáo viên khác.'; end if;
  if exists(select 1 from public.app_users where id = v_uid and tenant_id is not null and tenant_id <> v_tenant) then raise exception 'Tài khoản này thuộc workspace khác.'; end if;
  insert into public.app_users(id, full_name, role, active, tenant_id)
    values (v_uid, coalesce((select full_name from public.teachers where id = p_teacher), ''), 'teacher', true, v_tenant)
    on conflict (id) do update
      set role = case when public.app_users.role = 'owner' then 'owner' else 'teacher' end,
          tenant_id = v_tenant, active = true;
  update public.teachers set user_id = v_uid where id = p_teacher and tenant_id = v_tenant;
  return 'ok';
end $$;
grant execute on function public.link_teacher_account(uuid, text) to authenticated;

create or replace function public.unlink_teacher_account(p_teacher uuid)
  returns text language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_tenant uuid := public.current_tenant();
begin
  if not public.is_owner() then raise exception 'Chỉ chủ sở hữu được thao tác.'; end if;
  select user_id into v_uid from public.teachers where id = p_teacher and tenant_id = v_tenant;
  update public.teachers set user_id = null where id = p_teacher and tenant_id = v_tenant;
  if v_uid is not null then update public.app_users set active = false where id = v_uid and role = 'teacher'; end if;
  return 'ok';
end $$;
grant execute on function public.unlink_teacher_account(uuid) to authenticated;

commit;
select 'phaseE OK — phân quyền giáo viên sẵn sàng. Chủ/Quản trị giữ nguyên toàn quyền.' as status;

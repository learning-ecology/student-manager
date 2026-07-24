-- ============================================================
--  QUẢN LÝ HỌC VIÊN — Lược đồ cơ sở dữ liệu (v1, nền tảng GĐ 0)
--  Chạy MỘT LẦN trên một project Supabase MỚI (SQL Editor → Run).
--  Ngày DD/MM/YYYY · giờ Asia/Ho_Chi_Minh · tiền VND (lưu số nguyên đồng).
--
--  ⚠️ Đây là nền tảng — từng giai đoạn có thể bổ sung cột/bảng nhỏ.
--     Đã rà soát bằng mắt; chạy trên project trống rồi kiểm thử.
-- ============================================================
begin;

-- ---------- 0. Người dùng ứng dụng & phân quyền ----------
create table if not exists public.app_users (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'teacher' check (role in ('owner','admin','teacher')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
  language sql security definer stable set search_path=public as $$
  select exists(select 1 from app_users u where u.id=auth.uid() and u.active and u.role in ('owner','admin')); $$;
create or replace function public.is_owner() returns boolean
  language sql security definer stable set search_path=public as $$
  select exists(select 1 from app_users u where u.id=auth.uid() and u.active and u.role='owner'); $$;
create or replace function public.my_role() returns text
  language sql security definer stable set search_path=public as $$
  select role from app_users where id=auth.uid(); $$;
-- gán role khi tạo tài khoản (mặc định teacher; Owner đặt tay bằng SQL cho tài khoản đầu tiên)
create or replace function public.on_auth_user_created() returns trigger
  language plpgsql security definer set search_path=public as $$
  begin insert into public.app_users(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
        on conflict (id) do nothing; return new; end $$;
drop trigger if exists sm_on_auth_user on auth.users;
create trigger sm_on_auth_user after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- ---------- 1. Giáo viên (tên; có thể gắn tài khoản sau) ----------
create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null, phone text default '', email text default '',
  user_id uuid references public.app_users(id) on delete set null,
  archived_at timestamptz, created_at timestamptz not null default now()
);

-- ---------- 2. Học viên ----------
create sequence if not exists public.student_code_seq;
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default ('HV' || lpad(nextval('public.student_code_seq')::text, 5, '0')),
  full_name text not null,
  photo_url text,
  dob date, gender text check (gender in ('male','female','other') or gender is null),
  phone text default '',
  guardian_name text default '', guardian_phone text default '',
  email text default '', address text default '',
  enrolled_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  status text not null default 'active' check (status in ('active','paused','completed','withdrawn')),
  notes text default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists students_name_idx on public.students (lower(full_name));
create index if not exists students_phone_idx on public.students (phone);
create index if not exists students_status_idx on public.students (status) where archived_at is null;

-- ---------- 3. Lớp học ----------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text default '',
  teacher_id uuid references public.teachers(id) on delete set null,
  room text default '', online_link text default '',
  max_students int check (max_students is null or max_students > 0),
  start_date date, end_date date,
  status text not null default 'active' check (status in ('planned','active','completed','archived')),
  tuition_method text not null default 'per_scheduled'
    check (tuition_method in ('per_scheduled','per_attended','fixed_monthly','fixed_course','custom')),
  tuition_amount bigint not null default 0,   -- VND, số nguyên đồng
  notes text default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- ---------- 4. Ghi danh (học viên ↔ lớp, có lịch sử) ----------
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  class_id   uuid not null references public.classes(id)  on delete cascade,
  joined_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  left_on   date,
  status text not null default 'active' check (status in ('active','former')),
  tuition_override bigint,                      -- mức phí riêng (VND) nếu có
  discount_amount bigint not null default 0,    -- giảm cố định / kỳ
  discount_percent numeric(5,2) not null default 0,
  scholarship_note text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  check (left_on is null or left_on >= joined_on)
);
-- một học viên chỉ có 1 ghi danh ĐANG hoạt động trong một lớp
create unique index if not exists enroll_active_uniq
  on public.enrollments(student_id, class_id) where status='active';

-- ---------- 5. Lịch lặp hằng tuần ----------
create table if not exists public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),  -- 0=CN … 6=Thứ 7
  start_time time not null, end_time time not null,
  teacher_id uuid references public.teachers(id) on delete set null,
  room text default '', online_link text default '',
  effective_from date not null, effective_to date,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (effective_to is null or effective_to >= effective_from)
);

-- ---------- 6. Buổi học cụ thể (sinh từ lịch lặp) ----------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  schedule_id uuid references public.class_schedules(id) on delete set null,
  date date not null, start_time time not null, end_time time not null,
  teacher_id uuid references public.teachers(id) on delete set null,
  room text default '', online_link text default '',
  type text not null default 'regular' check (type in ('regular','makeup','extra')),
  status text not null default 'scheduled' check (status in ('scheduled','held','cancelled')),
  note text default '',
  created_at timestamptz not null default now(),
  unique (class_id, date, start_time, schedule_id)
);
create index if not exists sessions_date_idx on public.sessions(date);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null unique, name text not null default ''
);

-- ---------- 7. Điểm danh ----------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'present'
    check (status in ('present','authorised_absence','unauthorised_absence','late','left_early','makeup','cancelled')),
  arrival_time time, note text default '',
  recorded_by uuid references public.app_users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (session_id, student_id)
);

-- ---------- 8. Mức phí (lịch sử, có ngày hiệu lực) ----------
create table if not exists public.tuition_rates (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  method text not null check (method in ('per_scheduled','per_attended','fixed_monthly','fixed_course','custom')),
  amount bigint not null default 0,
  charge_present boolean not null default true,
  charge_authorised_absence boolean not null default false,
  charge_unauthorised_absence boolean not null default true,
  charge_cancelled boolean not null default false,
  charge_makeup boolean not null default false,
  charge_extra boolean not null default true,
  effective_from date not null,
  created_at timestamptz not null default now()
);

-- ---------- 9. Hóa đơn tháng + dòng chi tiết ----------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  class_id uuid references public.classes(id) on delete set null,
  period_year int not null, period_month int not null check (period_month between 1 and 12),
  status text not null default 'draft'
    check (status in ('draft','unpaid','partially_paid','paid','overdue','waived','cancelled')),
  subtotal bigint not null default 0,
  discount_total bigint not null default 0,
  credit_applied bigint not null default 0,
  adjustment_total bigint not null default 0,
  total bigint not null default 0,
  due_date date,
  finalized_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  -- chặn trùng: 1 hóa đơn / học viên / lớp / kỳ
  unique (student_id, class_id, period_year, period_month)
);
create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  kind text not null check (kind in ('lesson','discount','scholarship','credit','adjustment','carryover','extra')),
  description text not null default '',
  quantity numeric(8,2) not null default 1,
  unit_amount bigint not null default 0,
  amount bigint not null default 0,          -- có thể âm (giảm giá/tín dụng)
  created_at timestamptz not null default now()
);

-- ---------- 10. Thanh toán + điều chỉnh + chuyển lớp ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount bigint not null,                     -- >0 thu, dùng is_refund cho hoàn
  is_refund boolean not null default false,
  paid_on date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  method text not null default 'cash' check (method in ('cash','bank_transfer','card','other')),
  reference text default '', proof_url text, note text default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount bigint not null,                     -- +/− có truy vết
  reason text not null default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  from_class_id uuid references public.classes(id) on delete set null,
  to_class_id   uuid references public.classes(id) on delete set null,
  transfer_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  reason text default '', credit_transferred bigint not null default 0, notes text default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- 11. Cài đặt + Nhật ký ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  center_name text not null default 'Trung tâm',
  billing_day int not null default 1 check (billing_day between 1 and 28),
  currency text not null default 'VND',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_id uuid, action text not null, entity text not null, entity_id text,
  before jsonb, after jsonb, at timestamptz not null default now()
);
create or replace function public.audit() returns trigger
  language plpgsql security definer set search_path=public as $$
  begin
    insert into audit_log(actor_id, action, entity, entity_id, before, after)
    values (auth.uid(), tg_op, tg_table_name,
            coalesce((case when tg_op='DELETE' then old.id else new.id end)::text,''),
            case when tg_op='INSERT' then null else to_jsonb(old) end,
            case when tg_op='DELETE' then null else to_jsonb(new) end);
    return case when tg_op='DELETE' then old else new end;
  end $$;
-- gắn audit cho các bảng tài chính/nhạy cảm
do $$ declare t text;
begin
  foreach t in array array['students','classes','enrollments','invoices','payments','adjustments','transfers','attendance'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit()', t);
  end loop;
end $$;

-- ---------- 12. RLS (bật hết; nhân viên = owner/admin toàn quyền) ----------
do $$ declare t text;
begin
  foreach t in array array['app_users','teachers','students','classes','enrollments','class_schedules',
    'sessions','holidays','attendance','tuition_rates','invoices','invoice_lines','payments',
    'adjustments','transfers','settings','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    -- đọc: mọi tài khoản đã đăng nhập (v1 chủ yếu owner); ghi: chỉ nhân viên
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format('create policy "%1$s read" on public.%1$s for select to authenticated using (true)', t);
    if t <> 'audit_log' then
      execute format('drop policy if exists "%1$s write" on public.%1$s', t);
      execute format('create policy "%1$s write" on public.%1$s for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    end if;
  end loop;
end $$;
-- audit_log: chỉ owner đọc, không ai sửa/xóa (chỉ trigger ghi)
drop policy if exists "audit_log read" on public.audit_log;
create policy "audit_log read" on public.audit_log for select to authenticated using (public.is_owner());
-- app_users: chỉ owner được đổi vai trò
drop policy if exists "app_users write" on public.app_users;
create policy "app_users write" on public.app_users for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

commit;

-- ------------------------------------------------------------
-- GĐ 0 — sau khi tạo tài khoản Owner ở Authentication, chạy:
--   update public.app_users set role='owner', full_name='Tên của bạn'
--   where id = (select id from auth.users where email='ban@example.com');
-- ------------------------------------------------------------
select 'schema OK — 17 bảng, RLS đã bật' as status;

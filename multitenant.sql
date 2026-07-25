-- ============================================================
--  ĐA NGƯỜI THUÊ (MULTI-TENANT) — NỀN TẢNG (Giai đoạn 1/3)
--  Biến hệ thống 1 trung tâm thành nền tảng nhiều giáo viên, mỗi
--  giáo viên có "workspace" riêng, dữ liệu CÁCH LY hoàn toàn ở tầng
--  cơ sở dữ liệu (Row-Level Security) — không client nào truy vấn
--  chéo tenant được.
--
--  ⚠️ RẤT QUAN TRỌNG — ĐỌC TRƯỚC KHI CHẠY:
--   1) SAO LƯU CSDL TRƯỚC (Supabase → Database → Backups → tải bản
--      dump, hoặc tạo nhánh/branch). Đây là thay đổi lớn, KHÓ hoàn tác.
--   2) Nên chạy thử trên một BẢN SAO trước khi chạy trên bản chính.
--   3) Script này idempotent (chạy lại được), nhưng vẫn hãy sao lưu.
--
--  Sau khi chạy: ứng dụng hiện tại CHẠY Y NGUYÊN — bạn (chủ nền tảng)
--  chỉ thấy dữ liệu của chính mình vì RLS tự lọc theo tenant. Dữ liệu
--  hiện có được gộp vào 1 tenant "gốc" là workspace của bạn.
-- ============================================================
begin;

-- ---------- 1. Bảng tenants (mỗi giáo viên = 1 workspace) ----------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Trung tâm',
  status text not null default 'active' check (status in ('active','suspended','expired','trial')),
  plan text not null default 'free',
  trial_ends_at timestamptz,
  student_limit int,                       -- null = không giới hạn (dành cho gói trả phí sau này)
  branding jsonb not null default '{}'::jsonb,   -- logo, màu, tên trường… (mở rộng sau)
  config   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.tenants enable row level security;

-- ---------- 2. app_users: gắn tenant + cờ chủ nền tảng ----------
alter table public.app_users add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.app_users add column if not exists is_platform_owner boolean not null default false;
-- (tenant_id để NULL với tài khoản chưa được gán workspace → RLS chặn hết, an toàn)

-- ---------- 3. Tạo tenant GỐC cho dữ liệu hiện có + gán chủ nền tảng ----------
do $$
declare v_tid uuid;
begin
  if not exists (select 1 from public.tenants) then
    insert into public.tenants(name, status, plan)
      values (coalesce((select center_name from public.settings limit 1), 'Trung tâm của tôi'), 'active', 'owner')
      returning id into v_tid;
    update public.app_users set tenant_id = v_tid where tenant_id is null;
    update public.app_users set is_platform_owner = true where role = 'owner';   -- chủ hiện tại = chủ nền tảng
  end if;
end $$;

-- ---------- 4. Hàm tiện ích tenant ----------
create or replace function public.current_tenant() returns uuid
  language sql security definer stable set search_path = public as $$
  select tenant_id from public.app_users where id = auth.uid(); $$;
create or replace function public.is_platform_owner() returns boolean
  language sql security definer stable set search_path = public as $$
  select coalesce((select is_platform_owner from public.app_users where id = auth.uid()), false); $$;

-- ---------- 5. Thêm tenant_id vào MỌI bảng dữ liệu + backfill vào tenant gốc ----------
do $$
declare t text; v_tid uuid;
begin
  select id into v_tid from public.tenants order by created_at limit 1;
  foreach t in array array['teachers','students','classes','enrollments','class_schedules',
    'sessions','holidays','attendance','tuition_rates','invoices','invoice_lines',
    'payments','adjustments','transfers','settings','audit_log']
  loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete cascade', t);
    execute format('update public.%I set tenant_id = %L where tenant_id is null', t, v_tid);
    execute format('alter table public.%I alter column tenant_id set not null', t);
    execute format('create index if not exists %I on public.%I(tenant_id)', t || '_tenant_idx', t);
  end loop;
end $$;

-- ---------- 6. settings: mỗi tenant 1 dòng (bỏ ràng buộc "chỉ 1 dòng id=1") ----------
do $$ declare cn text;
begin
  for cn in select conname from pg_constraint
    where conrelid = 'public.settings'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%id%=%1%'
  loop execute 'alter table public.settings drop constraint ' || quote_ident(cn); end loop;
end $$;
create sequence if not exists public.settings_id_seq;
select setval('public.settings_id_seq', greatest(1, coalesce((select max(id) from public.settings), 1)));
alter table public.settings alter column id set default nextval('public.settings_id_seq');
create unique index if not exists settings_tenant_uniq on public.settings(tenant_id);

-- ---------- 7. Trigger tự gắn tenant_id khi INSERT ----------
create or replace function public.set_tenant() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    if new.tenant_id is null then new.tenant_id := public.current_tenant(); end if;
    return new;
  end $$;
do $$ declare t text;
begin
  foreach t in array array['teachers','students','classes','enrollments','class_schedules',
    'sessions','holidays','attendance','tuition_rates','invoices','invoice_lines',
    'payments','adjustments','transfers','settings','audit_log']
  loop
    execute format('drop trigger if exists set_tenant_%1$s on public.%1$s', t);
    execute format('create trigger set_tenant_%1$s before insert on public.%1$s for each row execute function public.set_tenant()', t);
  end loop;
end $$;

-- ---------- 8. RLS: mọi bảng dữ liệu lọc theo tenant (đọc: cùng tenant; ghi: nhân viên cùng tenant) ----------
do $$ declare t text;
begin
  foreach t in array array['teachers','students','classes','enrollments','class_schedules',
    'sessions','holidays','attendance','tuition_rates','invoices','invoice_lines',
    'payments','adjustments','transfers','settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- gỡ policy cũ (dùng chung 1 tenant) rồi tạo policy theo tenant
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s write" on public.%1$s', t);
    execute format('drop policy if exists "%1$s tenant read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s tenant write" on public.%1$s', t);
    execute format('create policy "%1$s tenant read" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant())', t);
    execute format('create policy "%1$s tenant write" on public.%1$s for all to authenticated using (tenant_id = public.current_tenant() and public.is_staff()) with check (tenant_id = public.current_tenant() and public.is_staff())', t);
  end loop;
end $$;

-- audit_log: chỉ chủ tenant đọc log của tenant mình; ghi qua trigger audit()
alter table public.audit_log enable row level security;
drop policy if exists "audit_log read" on public.audit_log;
drop policy if exists "audit_log tenant read" on public.audit_log;
create policy "audit_log tenant read" on public.audit_log for select to authenticated
  using (tenant_id = public.current_tenant() and public.is_owner());

-- ---------- 9. RLS bảng tenants + app_users ----------
drop policy if exists "tenants read" on public.tenants;
create policy "tenants read" on public.tenants for select to authenticated
  using (id = public.current_tenant() or public.is_platform_owner());
drop policy if exists "tenants write" on public.tenants;
create policy "tenants write" on public.tenants for all to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "app_users read" on public.app_users;
create policy "app_users read" on public.app_users for select to authenticated
  using (id = auth.uid() or tenant_id = public.current_tenant() or public.is_platform_owner());
drop policy if exists "app_users write" on public.app_users;
create policy "app_users write" on public.app_users for all to authenticated
  using (public.is_platform_owner() or (tenant_id = public.current_tenant() and public.is_owner()))
  with check (public.is_platform_owner() or (tenant_id = public.current_tenant() and public.is_owner()));

-- ---------- 10. RPC thống kê cho chủ nền tảng (đọc chéo tenant có kiểm soát) ----------
create or replace function public.tenant_overview()
  returns table (tenant_id uuid, name text, status text, plan text, created_at timestamptz,
                 students bigint, classes bigint, teachers bigint, users bigint, last_login timestamptz)
  language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.status, t.plan, t.created_at,
    (select count(*) from public.students   s  where s.tenant_id = t.id and s.archived_at is null),
    (select count(*) from public.classes    c  where c.tenant_id = t.id and c.archived_at is null),
    (select count(*) from public.teachers   te where te.tenant_id = t.id and te.archived_at is null),
    (select count(*) from public.app_users  u  where u.tenant_id = t.id),
    (select max(au.last_sign_in_at) from auth.users au join public.app_users u on u.id = au.id where u.tenant_id = t.id)
  from public.tenants t
  where public.is_platform_owner()
  order by t.created_at; $$;
grant execute on function public.tenant_overview() to authenticated;

commit;
select 'multitenant OK — nền tảng đa tenant sẵn sàng. Hãy chạy phần KIỂM TRA CÁCH LY trước khi tạo tài khoản thật.' as status;

-- ============================================================
--  Giai đoạn J — Khóa học (Cohort): gom nhiều lớp thành một khóa
--  • cohorts: mã khóa (vd K24), tên, thời gian, ghi chú.
--  • classes.cohort_id: lớp thuộc khóa nào (xóa khóa → gỡ, không xóa lớp).
--  RLS + set_tenant theo đúng mẫu multitenant. An toàn chạy lại.
--  Chạy trên Supabase → SQL Editor → Run.
-- ============================================================
begin;

create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text default '',
  start_date date, end_date date,
  notes text default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cohorts_tenant_idx on public.cohorts(tenant_id);

alter table public.classes add column if not exists cohort_id uuid references public.cohorts(id) on delete set null;
create index if not exists classes_cohort_idx on public.classes(cohort_id);

-- tenant_id tự điền khi insert (dùng lại hàm set_tenant hiện có)
drop trigger if exists set_tenant_cohorts on public.cohorts;
create trigger set_tenant_cohorts before insert on public.cohorts
  for each row execute function public.set_tenant();

-- RLS: đọc theo tenant, ghi cần is_staff (đúng mẫu các bảng khác)
alter table public.cohorts enable row level security;
drop policy if exists "cohorts tenant read" on public.cohorts;
drop policy if exists "cohorts tenant write" on public.cohorts;
create policy "cohorts tenant read" on public.cohorts for select to authenticated
  using (tenant_id = public.current_tenant());
create policy "cohorts tenant write" on public.cohorts for all to authenticated
  using (tenant_id = public.current_tenant() and public.is_staff())
  with check (tenant_id = public.current_tenant() and public.is_staff());

commit;

-- ============================================================
--  Giai đoạn B — LƯƠNG GIÁO VIÊN (chạy sau multitenant.sql)
--  • teacher_rates   : định mức lương theo GV (tùy chọn theo lớp), theo buổi/giờ, có hiệu lực từ ngày
--  • teacher_payslips: phiếu lương theo GV × tháng — ảnh chụp số buổi/tiền,
--    cộng/trừ điều chỉnh, số đã trả, trạng thái. Khóa (locked) để GIỮ lịch sử
--    dù lớp/buổi sửa về sau.
--  Lương = số buổi ĐÃ DẠY (sessions.status='held') × định mức phù hợp.
--  An toàn chạy lại nhiều lần (idempotent). Chạy trên Supabase → SQL Editor.
-- ============================================================
begin;

-- ---------- Định mức lương ----------
create table if not exists public.teacher_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,     -- null = áp dụng cho MỌI lớp của GV
  kind text not null default 'per_session' check (kind in ('per_session','per_hour')),
  amount bigint not null default 0,                                   -- VND / buổi hoặc VND / giờ
  effective_from date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  note text default '',
  created_at timestamptz not null default now()
);
create index if not exists teacher_rates_tenant_idx on public.teacher_rates(tenant_id);
create index if not exists teacher_rates_lookup_idx on public.teacher_rates(teacher_id, class_id, effective_from);

-- ---------- Phiếu lương (GV × tháng) ----------
create table if not exists public.teacher_payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  period_year int not null,
  period_month int not null check (period_month between 1 and 12),
  session_count int not null default 0,
  base_amount bigint not null default 0,                 -- tổng tiền buổi (ảnh chụp khi lưu/chốt)
  adjustments jsonb not null default '[]'::jsonb,         -- [{label, amount}]  (+thưởng / -khấu trừ)
  adjustment_total bigint not null default 0,
  total bigint not null default 0,                        -- base_amount + adjustment_total
  paid_amount bigint not null default 0,
  detail jsonb not null default '[]'::jsonb,              -- ảnh chụp dòng buổi [{date,class_id,class,hours,kind,rate,amount}]
  locked boolean not null default false,                  -- chốt → khóa số buổi/base (giữ lịch sử)
  note text default '',
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, teacher_id, period_year, period_month)
);
create index if not exists teacher_payslips_tenant_idx on public.teacher_payslips(tenant_id);

-- ---------- Gắn tenant tự động + RLS theo tenant (giống các bảng khác) ----------
do $$ declare t text;
begin
  foreach t in array array['teacher_rates','teacher_payslips'] loop
    execute format('drop trigger if exists set_tenant_%1$s on public.%1$s', t);
    execute format('create trigger set_tenant_%1$s before insert on public.%1$s for each row execute function public.set_tenant()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%1$s tenant read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s tenant write" on public.%1$s', t);
    execute format('create policy "%1$s tenant read" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant())', t);
    execute format('create policy "%1$s tenant write" on public.%1$s for all to authenticated using (tenant_id = public.current_tenant() and public.is_staff()) with check (tenant_id = public.current_tenant() and public.is_staff())', t);
  end loop;
end $$;

commit;
select 'phaseB OK — lương giáo viên sẵn sàng (teacher_rates, teacher_payslips)' as status;

-- ============================================================
--  Giai đoạn G — LOẠI TÀI KHOẢN & BẬT/TẮT TÍNH NĂNG THEO TENANT
--  • tenants.account_type : 'center' (trung tâm) | 'individual' (giáo viên cá nhân)
--  • tenants.features     : jsonb {module: true/false} — chủ nền tảng bật/tắt từng module
--    cho từng khách. Trống = dùng mặc định theo account_type.
--  Giao diện (sidebar/onboarding) tự sinh theo account_type + features + vai trò.
--  Nâng cấp cá nhân → trung tâm chỉ là đổi account_type — DỮ LIỆU GIỮ NGUYÊN.
--  Chạy sau multitenant.sql. Idempotent. Supabase → SQL Editor → Run.
-- ============================================================
begin;

alter table public.tenants add column if not exists account_type text not null default 'center'
  check (account_type in ('center','individual'));
alter table public.tenants add column if not exists features jsonb not null default '{}'::jsonb;

-- Cập nhật RPC tổng quan cho chủ nền tảng: kèm account_type + features
create or replace function public.tenant_overview()
  returns table (tenant_id uuid, name text, status text, plan text, account_type text, features jsonb, created_at timestamptz,
                 students bigint, classes bigint, teachers bigint, users bigint, last_login timestamptz)
  language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.status, t.plan, t.account_type, t.features, t.created_at,
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
select 'phaseG OK — loại tài khoản (center/individual) + bật/tắt tính năng theo tenant sẵn sàng' as status;

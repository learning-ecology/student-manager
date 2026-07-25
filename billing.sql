-- ============================================================
--  Nâng cấp — Tính học phí theo CHU KỲ (mỗi X buổi)
--  Chạy sau schema.sql/phase6.sql (an toàn chạy lại nhiều lần).
--  • Thêm cấu hình tính phí ở cấp LỚP.
--  • Ghi khoảng tính phí (bill_from/bill_to) lên hóa đơn, và cho phép
--    NHIỀU hóa đơn trong cùng một tháng (các chu kỳ nối tiếp nhau) —
--    ràng buộc trùng đổi từ (học viên, lớp, tháng) sang
--    (học viên, lớp, ngày bắt đầu kỳ).
-- ============================================================
begin;

-- 1) Cấu hình tính phí ở cấp lớp
alter table public.classes add column if not exists billing_cycle int;                 -- số buổi mỗi chu kỳ (chỉ dùng khi tính theo chu kỳ)
alter table public.classes add column if not exists billing_start date;                -- ngày bắt đầu tính phí (chu kỳ đầu tiên)
alter table public.classes add column if not exists billing_include_future boolean not null default true;

-- thêm phương thức 'per_cycle' (mỗi X buổi)
alter table public.classes drop constraint if exists classes_tuition_method_check;
alter table public.classes add constraint classes_tuition_method_check
  check (tuition_method in ('per_scheduled','per_attended','per_cycle','fixed_monthly','fixed_course','custom'));

-- 2) Ghi khoảng tính phí lên hóa đơn
alter table public.invoices add column if not exists bill_from date;
alter table public.invoices add column if not exists bill_to   date;
update public.invoices set bill_from = make_date(period_year, period_month, 1) where bill_from is null;

-- 3) Đổi ràng buộc trùng: 1 hóa đơn / (học viên, lớp, ngày bắt đầu kỳ)
--    (gỡ mọi ràng buộc UNIQUE cũ dựa trên tháng)
do $$ declare r record;
begin
  for r in select conname from pg_constraint
    where conrelid = 'public.invoices'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%period_year%period_month%'
  loop execute 'alter table public.invoices drop constraint ' || quote_ident(r.conname); end loop;
end $$;
create unique index if not exists invoices_uniq_bill on public.invoices (student_id, class_id, bill_from);

commit;
select 'billing OK — tính phí theo chu kỳ sẵn sàng' as status;

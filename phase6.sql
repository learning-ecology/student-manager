-- ============================================================
--  Giai đoạn 6 — Học phí & hóa đơn tháng (chạy sau phase5.sql)
--  Các bảng tuition_rates / invoices / invoice_lines đã có sẵn trong
--  schema.sql. Việc tính hóa đơn được làm ở trình duyệt (JavaScript)
--  rồi ghi vào 2 bảng này — chỉ sửa được khi hóa đơn còn ở trạng thái
--  'draft'/'cancelled'; đã chốt thì bất biến (sửa qua điều chỉnh ở GĐ7).
--  Phần SQL này chỉ thêm chỉ mục cho truy vấn nhanh. An toàn chạy lại.
-- ============================================================
begin;

create index if not exists invoices_period_idx      on public.invoices (period_year, period_month);
create index if not exists invoices_student_idx      on public.invoices (student_id);
create index if not exists invoices_class_idx        on public.invoices (class_id);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index if not exists tuition_rates_class_idx   on public.tuition_rates (class_id, effective_from);

commit;
select 'phase6 OK — học phí & hóa đơn sẵn sàng' as status;

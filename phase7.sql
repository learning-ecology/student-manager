-- ============================================================
--  Giai đoạn 7 — Thanh toán, biên nhận, điều chỉnh & số dư
--  (chạy sau phase6.sql)
--  Các bảng payments / adjustments đã có sẵn trong schema.sql.
--  Việc cập nhật trạng thái hóa đơn khi thu tiền / điều chỉnh được
--  làm ở trình duyệt (có kiểm soát: không đụng hóa đơn nháp/đã hủy).
--  Phần SQL này chỉ thêm chỉ mục. An toàn chạy lại nhiều lần.
-- ============================================================
begin;

create index if not exists payments_student_idx    on public.payments (student_id);
create index if not exists payments_invoice_idx     on public.payments (invoice_id);
create index if not exists payments_paid_on_idx      on public.payments (paid_on);
create index if not exists adjustments_student_idx   on public.adjustments (student_id);
create index if not exists adjustments_invoice_idx   on public.adjustments (invoice_id);

commit;
select 'phase7 OK — thanh toán & số dư sẵn sàng' as status;

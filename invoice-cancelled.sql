-- ============================================================
--  Hóa đơn — hiển thị BUỔI ĐÃ HỦY (0đ) kèm ghi chú
--  Chạy trên Supabase (SQL Editor → Run). An toàn chạy lại nhiều lần.
--
--  Thêm cho invoice_lines:
--   • lesson_date : ngày của buổi học (để in bảng buổi theo ngày)
--   • note        : ghi chú (dùng cho lý do hủy lấy từ Lịch học)
--   • kind mới 'cancelled' : dòng buổi đã hủy (luôn 0đ, chỉ để hiển thị)
-- ============================================================
begin;

alter table public.invoice_lines add column if not exists lesson_date date;
alter table public.invoice_lines add column if not exists note text;

alter table public.invoice_lines drop constraint if exists invoice_lines_kind_check;
alter table public.invoice_lines add constraint invoice_lines_kind_check
  check (kind in ('lesson','discount','scholarship','credit','adjustment','carryover','extra','cancelled'));

commit;
select 'invoice-cancelled OK — hóa đơn có thể hiển thị buổi đã hủy' as status;

-- ============================================================
--  Giai đoạn H — MÀU LỚP (Màu lớp) để phân biệt trên lịch
--  Thêm cột classes.color (mã hex "#rrggbb" hoặc null = màu mặc định).
--  Lớp cũ chưa có màu → null → hệ thống hiển thị màu trung tính.
--  Chạy trên Supabase → SQL Editor → Run. Idempotent.
-- ============================================================
begin;
alter table public.classes add column if not exists color text;
commit;
select 'phaseH OK — lớp có thể đặt màu (classes.color)' as status;

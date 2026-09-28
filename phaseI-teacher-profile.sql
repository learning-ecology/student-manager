-- ============================================================
--  Giai đoạn I — Hồ sơ giáo viên: môn dạy (Qualified Subjects)
--  Thêm cột subjects cho bảng teachers (danh sách môn, phân tách bằng dấu phẩy).
--  Bổ sung, an toàn chạy lại. Chạy trên Supabase → SQL Editor → Run.
-- ============================================================
alter table public.teachers add column if not exists subjects text not null default '';

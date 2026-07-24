-- ============================================================
--  Giai đoạn 5 — Điểm danh (chạy sau phase4.sql)
--  Bảng attendance đã có sẵn trong schema.sql. Phần này chỉ thêm
--  chỉ mục giúp truy vấn lịch sử điểm danh theo học viên nhanh hơn.
--  An toàn để chạy lại nhiều lần.
-- ============================================================
begin;

-- tra cứu điểm danh theo học viên (xem lịch sử/chuyên cần của 1 em)
create index if not exists attendance_student_idx on public.attendance (student_id);

-- (đã có sẵn) unique(session_id, student_id) phục vụ tra theo buổi + chống trùng.

commit;
select 'phase5 OK — điểm danh sẵn sàng' as status;

-- ============================================================
--  Giai đoạn 8 — Chuyển lớp / rời lớp (chạy sau phase7.sql)
--  Hàm chuyển lớp an toàn transfer_student() đã có từ phase3.sql.
--  Bảng transfers / enrollments đã có sẵn trong schema.sql.
--  Phần này chỉ thêm chỉ mục cho truy vấn lịch sử. An toàn chạy lại.
-- ============================================================
begin;

create index if not exists transfers_student_idx   on public.transfers (student_id);
create index if not exists enrollments_student_idx  on public.enrollments (student_id);

commit;
select 'phase8 OK — chuyển lớp / rời lớp sẵn sàng' as status;

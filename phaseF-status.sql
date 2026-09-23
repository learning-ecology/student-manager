-- ============================================================
--  Giai đoạn F — THÊM TRẠNG THÁI LỚP: 'cancelled' (đã hủy) + 'paused' (tạm dừng)
--  Mở rộng ràng buộc classes.status. An toàn chạy lại. Supabase → SQL Editor → Run.
-- ============================================================
begin;

alter table public.classes drop constraint if exists classes_status_check;
alter table public.classes add constraint classes_status_check
  check (status in ('planned','active','completed','archived','cancelled','paused'));

commit;
select 'phaseF OK — lớp có thêm trạng thái Đã hủy / Tạm dừng' as status;

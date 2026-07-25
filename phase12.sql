-- ============================================================
--  Giai đoạn 12 — Nhật ký thay đổi (audit) + hoàn thiện
--  (chạy sau phase11 — hay bất cứ lúc nào; an toàn chạy lại)
--  Bảng audit_log + trigger ghi log + RLS (chỉ chủ sở hữu đọc) đã có
--  sẵn từ schema.sql. Phần này chỉ thêm chỉ mục cho trình xem nhật ký
--  (sắp theo thời gian, lọc theo bảng) chạy nhanh khi log lớn dần.
-- ============================================================
begin;

create index if not exists audit_log_at_idx     on public.audit_log (at desc);
create index if not exists audit_log_entity_idx  on public.audit_log (entity, at desc);

commit;
select 'phase12 OK — nhật ký sẵn sàng' as status;

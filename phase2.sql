-- ============================================================
--  Giai đoạn 2 — Kho ảnh học viên (chạy sau schema.sql)
--  Ảnh đại diện học viên lưu ở bucket 'student-photos'.
--  Ai cũng xem được ảnh (public read); chỉ nhân viên được tải lên/xóa.
-- ============================================================
begin;

insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', true)
on conflict (id) do nothing;

drop policy if exists "student photos read" on storage.objects;
create policy "student photos read" on storage.objects
  for select using (bucket_id = 'student-photos');

drop policy if exists "student photos staff write" on storage.objects;
create policy "student photos staff write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'student-photos' and public.is_staff());

drop policy if exists "student photos staff update" on storage.objects;
create policy "student photos staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'student-photos' and public.is_staff());

drop policy if exists "student photos staff delete" on storage.objects;
create policy "student photos staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-photos' and public.is_staff());

commit;
select 'phase2 OK — bucket student-photos đã sẵn sàng' as status;

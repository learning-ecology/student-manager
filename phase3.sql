-- ============================================================
--  Giai đoạn 3 — Chuyển lớp an toàn (chạy sau schema.sql)
--  Chuyển lớp gồm 3 thao tác (đóng ghi danh cũ, mở ghi danh mới,
--  ghi lịch sử). Gói trong MỘT hàm = MỘT giao dịch, nên không bao
--  giờ chuyển "nửa chừng" làm mất học viên.
-- ============================================================
begin;

create or replace function public.transfer_student(
  p_student uuid, p_from_class uuid, p_to_class uuid, p_date date,
  p_reason text, p_credit bigint, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Không có quyền chuyển lớp.' using errcode = '42501';
  end if;
  if p_to_class is null then
    raise exception 'Thiếu lớp mới.' using errcode = '22004';
  end if;

  -- 1) kết thúc ghi danh ở lớp cũ (nếu đang hoạt động)
  update public.enrollments
     set status = 'former', left_on = p_date
   where student_id = p_student and class_id = p_from_class and status = 'active';

  -- 2) mở ghi danh ở lớp mới (nếu chưa có ghi danh đang hoạt động)
  if not exists (select 1 from public.enrollments
                 where student_id = p_student and class_id = p_to_class and status = 'active') then
    insert into public.enrollments(student_id, class_id, joined_on, status)
    values (p_student, p_to_class, p_date, 'active');
  end if;

  -- 3) lưu lịch sử chuyển lớp
  insert into public.transfers(student_id, from_class_id, to_class_id, transfer_date, reason, credit_transferred, notes, created_by)
  values (p_student, p_from_class, p_to_class, p_date, coalesce(p_reason, ''), coalesce(p_credit, 0), coalesce(p_notes, ''), auth.uid());
end $$;

grant execute on function public.transfer_student(uuid, uuid, uuid, date, text, bigint, text) to authenticated;

commit;
select 'phase3 OK — hàm transfer_student sẵn sàng' as status;

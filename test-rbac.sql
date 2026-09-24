-- ============================================================
--  KIỂM THỬ PHÂN QUYỀN GIÁO VIÊN (RLS) — chạy trên Supabase → SQL Editor
--  Giả lập PHIÊN ĐĂNG NHẬP của một giáo viên đã liên kết tài khoản, rồi
--  đếm những gì họ THẤY. Không thay đổi dữ liệu (rollback ở cuối).
--
--  ĐỌC KỲ VỌNG: cột "ky_vong". Các dòng "phải = 0" mà ra 0 nghĩa là
--  cách ly ĐÚNG (GV không thấy lương/định mức GV khác, không thấy hóa đơn).
--  Cần: đã chạy phaseE-rbac.sql VÀ đã liên kết ít nhất 1 GV với tài khoản.
-- ============================================================
begin;

-- 1) Phải có ít nhất 1 giáo viên đã liên kết tài khoản đăng nhập
do $$
begin
  if not exists (select 1 from public.teachers where user_id is not null) then
    raise exception 'Chưa có giáo viên nào liên kết tài khoản. Vào Cài đặt → Tài khoản giáo viên để liên kết, rồi chạy lại script này.';
  end if;
end $$;

-- 2) Giả lập JWT = giáo viên đã liên kết đầu tiên (theo tên)
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select user_id from public.teachers where user_id is not null order by full_name limit 1)::text,
    'role', 'authenticated'
  )::text, true) as _jwt;
set local role authenticated;   -- chuyển sang vai trò "authenticated" để RLS có hiệu lực

-- 3) Báo cáo: giáo viên này THẤY gì?
select * from (values
  ('Nhận diện giáo viên (my_teacher_id)',      (public.my_teacher_id() is not null)::int,                                          'phải = 1'),
  ('Lớp giáo viên thấy',                        (select count(*)::int from public.classes),                                         'chỉ lớp của GV'),
  ('Buổi học giáo viên thấy',                   (select count(*)::int from public.sessions),                                        'chỉ buổi lớp của GV'),
  ('Lịch tuần giáo viên thấy',                  (select count(*)::int from public.class_schedules),                                 'chỉ lịch lớp của GV'),
  ('Học viên giáo viên thấy',                   (select count(*)::int from public.students),                                        'chỉ HV trong lớp GV'),
  ('Điểm danh giáo viên thấy',                  (select count(*)::int from public.attendance),                                      'chỉ buổi của GV'),
  ('Chấm công của giáo viên',                   (select count(*)::int from public.teacher_checkins),                                'chỉ của GV này'),
  ('Phiếu lương CỦA giáo viên',                 (select count(*)::int from public.teacher_payslips),                                'chỉ của GV này'),
  ('>> Phiếu lương GV KHÁC (rò rỉ?)',           (select count(*)::int from public.teacher_payslips where teacher_id <> public.my_teacher_id()), 'PHẢI = 0'),
  ('>> Định mức lương GV KHÁC (rò rỉ?)',        (select count(*)::int from public.teacher_rates    where teacher_id <> public.my_teacher_id()), 'PHẢI = 0'),
  ('>> Hóa đơn học phí (rò rỉ?)',               (select count(*)::int from public.invoices),                                        'PHẢI = 0'),
  ('>> Thanh toán học phí (rò rỉ?)',            (select count(*)::int from public.payments),                                        'PHẢI = 0')
) as t(kiem_tra, ket_qua, ky_vong);

rollback;

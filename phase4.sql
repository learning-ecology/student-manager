-- ============================================================
--  Giai đoạn 4 — Sinh buổi học từ lịch tuần (chạy sau phase3.sql)
--  Duyệt từng ngày trong khoảng đã chọn, đối chiếu lịch tuần của
--  lớp (đúng thứ, còn hiệu lực), bỏ qua ngày lễ, tôn trọng ngày
--  bắt đầu/kết thúc của lớp. Buổi đã tồn tại thì bỏ qua (không
--  bao giờ sinh trùng). Trả về SỐ BUỔI mới được tạo.
-- ============================================================
begin;

create or replace function public.generate_sessions(p_class uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  d date;
  s record;
  c record;
begin
  if not public.is_staff() then
    raise exception 'Không có quyền sinh buổi học.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Khoảng ngày không hợp lệ.';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Khoảng ngày tối đa 1 năm — chia nhỏ để chạy.';
  end if;

  select * into c from classes where id = p_class;
  if not found then
    raise exception 'Không tìm thấy lớp.';
  end if;

  d := p_from;
  while d <= p_to loop
    if not exists (select 1 from holidays h where h.date = d) then
      for s in
        select * from class_schedules cs
        where cs.class_id = p_class
          and cs.weekday = extract(dow from d)::int
          and cs.effective_from <= d
          and (cs.effective_to is null or cs.effective_to >= d)
      loop
        if (c.start_date is null or d >= c.start_date)
           and (c.end_date is null or d <= c.end_date) then
          insert into sessions(class_id, schedule_id, date, start_time, end_time, teacher_id, room, online_link)
          values (p_class, s.id, d, s.start_time, s.end_time,
                  coalesce(s.teacher_id, c.teacher_id),
                  coalesce(nullif(s.room, ''), c.room, ''),
                  coalesce(nullif(s.online_link, ''), c.online_link, ''))
          on conflict (class_id, date, start_time, schedule_id) do nothing;
          if found then n := n + 1; end if;
        end if;
      end loop;
    end if;
    d := d + 1;
  end loop;

  return n;
end $$;

grant execute on function public.generate_sessions(uuid, date, date) to authenticated;

commit;
select 'phase4 OK — hàm generate_sessions sẵn sàng' as status;

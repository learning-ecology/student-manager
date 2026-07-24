# Trung tâm — Quản lý học viên, điểm danh & học phí
## Tài liệu thiết kế (Bước 18 — làm TRƯỚC khi dựng giao diện)

Ứng dụng **độc lập** với LMS: cơ sở dữ liệu riêng, đăng nhập riêng, không phụ thuộc website cũ.
Ngôn ngữ mặc định **tiếng Việt** · ngày **DD/MM/YYYY** · giờ **Asia/Ho_Chi_Minh** · tiền **VND** (`1.200.000₫`).

---

## 0. Kiến trúc (khuyến nghị)

| Thành phần | Chọn | Vì sao |
|---|---|---|
| Cơ sở dữ liệu + Auth | **Một project Supabase MỚI** (tách hẳn LMS) | Postgres thật, mật khẩu đã băm sẵn, RLS = kiểm soát quyền phía máy chủ, tự động sao lưu — đúng yêu cầu mục 17. Bạn đã quen Supabase. |
| Giao diện | **Ứng dụng web tĩnh** (HTML/CSS/JS + supabase-js) | Cùng cách bạn đang làm LMS; đăng lên GitHub Pages / tên miền phụ (vd `quanly.learningecology.io.vn`). |
| Xác thực | Supabase Auth (email + mật khẩu) | Băm mật khẩu, khôi phục mật khẩu, phiên đăng nhập — không tự code phần nhạy cảm. |
| Phân quyền | RLS + bảng `app_users.role` (`owner`/`admin`/`teacher`) | Chặn truy cập trái phép ở tầng CSDL, không chỉ ở trình duyệt. |
| Sao lưu | Supabase (tự động) + nút "Xuất toàn bộ" | Mục 17. |
| Nhật ký thay đổi | Bảng `audit_log` + trigger | Truy vết mọi thay đổi quan trọng. |

> Dữ liệu điểm danh/học phí/thanh toán **không** lưu ở localStorage — chỉ là bộ nhớ tạm cho form đang nhập. Nguồn sự thật là Postgres.

---

## 1. Các thực thể & quan hệ

```
app_users (owner/admin/teacher)      ── đăng nhập, phân quyền
teachers ──< class_schedules >── classes ──< enrollments >── students
                     │                │                          │
                     │                ├──< sessions >── attendance ┘  (điểm danh mỗi buổi)
                     │                │
                     │                ├──< tuition_rates            (lịch sử mức phí, có ngày hiệu lực)
                     │                │
                     └── sessions.teacher_id (đổi GV 1 buổi)        
students ──< invoices >──< invoice_lines      (hóa đơn tháng + dòng chi tiết)
students ──< payments >── (invoice_id tùy chọn)
students ──< transfers >── (from_class → to_class)
students ──< adjustments >── (điều chỉnh có truy vết)
holidays, settings, audit_log
```

**Giải thích quan hệ chính**

- **students ↔ classes = nhiều–nhiều**, thể hiện qua **`enrollments`**. Một học viên học nhiều lớp; một lớp nhiều học viên. `enrollments` giữ **lịch sử**: `joined_on`, `left_on`, `status` (`active`/`former`), nên "học viên hiện tại" và "học viên cũ" chỉ là lọc theo `status`/`left_on`.
- **classes → class_schedules (1–nhiều)**: mỗi lớp có ≥1 lịch lặp hằng tuần (vd Thứ 2 & Thứ 4, 18:00–19:30). Mỗi lịch có `effective_from`/`effective_to`.
- **class_schedules → sessions (1–nhiều)**: hệ thống **sinh tự động** từng buổi học cụ thể (`sessions`) theo lịch lặp, tránh trùng ngày lễ. Buổi bù/buổi thêm/hủy/dời đều là bản ghi `sessions` với `type`/`status` phù hợp.
- **sessions → attendance (1–nhiều)**: mỗi buổi, mỗi học viên có 1 dòng điểm danh. `unique(session_id, student_id)`.
- **classes → tuition_rates (1–nhiều)**: mức phí có **ngày hiệu lực**; đổi giá **không** sửa hóa đơn đã chốt.
- **students → invoices (1–nhiều)**: mỗi tháng, mỗi (học viên × lớp) một hóa đơn. `unique(student_id, class_id, period_year, period_month)` → **chặn trùng hóa đơn**.
- **invoices → invoice_lines**: dòng chi tiết (buổi tính phí, giảm giá, học bổng, tín dụng, điều chỉnh, dư kỳ trước).
- **students → payments**: thanh toán (có thể gắn 1 hóa đơn hoặc để chung), gồm hoàn tiền (`is_refund`) và tín dụng chuyển tiếp.
- **transfers**: chuyển lớp — kết thúc enrollment cũ, mở enrollment mới, giữ toàn bộ lịch sử.
- **adjustments**: sửa sai bằng bút toán điều chỉnh (không ghi đè) → tài chính luôn truy vết được.

---

## 2. Quy tắc tính học phí & các trường hợp biên

**Phương pháp tính (`classes.tuition_method`)**
1. `per_scheduled` — theo **buổi có lịch** (dù đi hay nghỉ).
2. `per_attended` — theo **buổi thực học**.
3. `fixed_monthly` — cố định/tháng.
4. `fixed_course` — trọn khóa.
5. `custom` — mức riêng cho từng học viên (`enrollments.tuition_override`).

**Buổi nào bị tính phí (chỉ áp dụng cho phương pháp theo buổi)** — cấu hình trong `tuition_rates`:
`charge_present`, `charge_authorised_absence`, `charge_unauthorised_absence`, `charge_cancelled`, `charge_makeup`, `charge_extra`.
Mặc định: tính buổi **có mặt** + **vắng không phép**; **không** tính buổi hủy; buổi bù/thêm tùy chọn.

**Công thức hiển thị (ví dụ)**
```
8 buổi tính phí × 120.000₫ = 960.000₫
Giảm giá:            − 100.000₫
Tín dụng kỳ trước:   −  60.000₫
Phải thanh toán:       800.000₫
```

**Các trường hợp biên (phải xử lý đúng)**
- **Vào/nghỉ giữa tháng** → chỉ tính các buổi trong khoảng `[joined_on, left_on]` giao với tháng.
- **Đổi giá giữa tháng** → mỗi buổi dùng mức phí *hiệu lực tại ngày buổi đó*; hóa đơn **đã chốt** không đổi.
- **Chuyển lớp giữa tháng** → tách phí giữa lớp cũ và lớp mới theo `transfer_date`; tùy chọn **chuyển tín dụng**.
- **Buổi hủy / ngày lễ** → không sinh phí trừ khi `charge_cancelled` bật.
- **Buổi bù** → tính/không tính theo `charge_makeup`.
- **Giảm giá / học bổng / mức riêng** → áp ở tầng `enrollments` (ưu tiên hơn giá lớp).
- **Dư nợ / dư có kỳ trước** → cộng/trừ vào hóa đơn kỳ này.
- **Điều chỉnh tay** → thêm dòng `invoice_lines` loại `adjustment`.
- **Chặn trùng** → 1 hóa đơn / (học viên, lớp, kỳ); tạo lại chỉ khi hóa đơn cũ ở trạng thái `draft` hoặc `cancelled`.
- **Chốt hóa đơn = bất biến** → sửa sau chốt phải qua `adjustments`, không ghi đè.

**Trạng thái hóa đơn**: `draft → unpaid → partially_paid → paid` · `overdue` · `waived` · `cancelled`.
**Trạng thái điểm danh**: `present`, `authorised_absence`, `unauthorised_absence`, `late`, `left_early`, `makeup`, `cancelled`.

---

## 3. Kế hoạch triển khai theo giai đoạn

| GĐ | Nội dung | Kết quả |
|---|---|---|
| **0** | Tạo project Supabase mới, chạy `schema.sql`, tạo tài khoản Owner | Nền tảng CSDL + đăng nhập |
| **1** | Khung ứng dụng: đăng nhập, sidebar, Cài đặt (ngày billing, tên trung tâm…), tiện ích VND/ngày/giờ | Vào được, có khung |
| **2** | **Quản lý học viên**: CRUD, mã tự sinh, ảnh, tìm/lọc, lưu trữ/khôi phục | Danh bạ học viên |
| **3** | **Lớp học + ghi danh**: CRUD lớp, thêm/xóa/chuyển học viên, sĩ số, danh sách hiện tại/cũ | Lớp & sĩ số |
| **4** | **Lịch tuần + sinh buổi học** + lịch ngày/tuần/tháng + cảnh báo trùng | Thời khóa biểu |
| **5** | **Điểm danh** nhanh (mặc định có mặt) + lịch sử + tỉ lệ chuyên cần | Điểm danh |
| **6** | **Học phí**: mức phí có ngày hiệu lực + **tính hóa đơn tháng** (nháp→chốt) kèm bảng phân tích | Hóa đơn |
| **7** | **Thanh toán + biên nhận + điều chỉnh** + số dư | Thu tiền |
| **8** | **Chuyển lớp / rời lớp** giữ lịch sử + hộp thoại xác nhận | Chuyển lớp |
| **9** | **Dashboard** các thẻ bấm được + **nhắc nhở** nội bộ | Tổng quan |
| **10** | **Báo cáo + xuất** Excel/CSV/PDF/in | Báo cáo |
| **11** | **Nhập hàng loạt** (mẫu → tải → ánh xạ cột → kiểm tra → phát hiện trùng → xem trước → nhập) | Import |
| **12** | **Audit log**, hoàn thiện mobile, trạng thái tải/trống/lỗi/thành công | Bảo mật & tinh chỉnh |

Mỗi giai đoạn: dựng bằng thao tác CSDL thật + kiểm thử với dữ liệu mẫu (đặc biệt điểm danh, chuyển lớp, học phí, thanh toán).

---

## 4. Việc bạn cần làm để bắt đầu (GĐ 0)
1. Tạo **project Supabase mới** (gói Free là đủ để bắt đầu).
2. SQL Editor → dán `schema.sql` → Run.
3. Authentication → Add user → tạo tài khoản **Owner** của bạn; rồi chạy 1 câu SQL nhỏ để đặt `role='owner'` (mình sẽ cung cấp).
4. Cho mình **URL + publishable key** để điền vào `config.js` của ứng dụng.

Sau đó mình dựng **Giai đoạn 1** (đăng nhập + khung + Cài đặt) và tiếp tục từng giai đoạn.

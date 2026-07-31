/* ============================================================
   Hướng dẫn sử dụng (User Handbook) — trang trong ứng dụng
   Mục lục có liên kết + tô sáng mục đang xem + tìm kiếm +
   "Quay lại mục lục" + In/Lưu PDF. Responsive máy tính/tablet/điện thoại.
   Nội dung bám sát giao diện & tính năng THỰC TẾ của phần mềm.
   Muốn cập nhật: chỉ sửa mảng SECTIONS bên dưới.
   ============================================================ */
window.Handbook = (function () {
  let box = null, _scroll = null;
  const e = s => String(s == null ? "" : s);

  function feat(o) {
    return (o.muc_dich ? `<p><b>🎯 Mục đích:</b> ${o.muc_dich}</p>` : "")
      + (o.vi_tri ? `<p><b>📍 Vị trí:</b> ${o.vi_tri}</p>` : "")
      + (o.steps ? `<p><b>🪜 Các bước thực hiện:</b></p><ol>${o.steps.map(s => `<li>${s}</li>`).join("")}</ol>` : "")
      + (o.ket_qua ? `<p><b>✅ Kết quả:</b> ${o.ket_qua}</p>` : "")
      + (o.luu_y && o.luu_y.length ? `<div class="hb-note"><b>💡 Lưu ý</b><ul>${o.luu_y.map(x => `<li>${x}</li>`).join("")}</ul></div>` : "")
      + (o.loi && o.loi.length ? `<div class="hb-warn"><b>🛠 Lỗi thường gặp</b><ul>${o.loi.map(x => `<li><b>${x.q}</b> → ${x.a}</li>`).join("")}</ul></div>` : "");
  }
  const b = t => `“${t}”`;   // nhấn tên nút/mục

  const SECTIONS = [
    { id: "gioi-thieu", icon: "👋", title: "1. Giới thiệu", html:
      `<p>Đây là phần mềm <b>Quản lý học viên</b> giúp bạn quản lý học viên, lớp học, lịch học, điểm danh, học phí, thu tiền và báo cáo — tất cả trong một nơi. Mỗi tài khoản có <b>workspace riêng</b>, dữ liệu hoàn toàn riêng tư.</p>
       <p><b>Bố cục màn hình:</b></p>
       <ul>
         <li><b>Menu bên trái:</b> chuyển giữa các mục (Tổng quan, Học viên, Lớp học, Lịch học, Điểm danh, Học phí, Thanh toán, Báo cáo, Nhật ký, Hướng dẫn, Cài đặt).</li>
         <li><b>Góc trên bên phải:</b> tên bạn · vai trò, nút ${b("Đăng xuất")}, và nút ${b("🌙")} để đổi giao diện Sáng/Tối.</li>
         <li>Trên <b>điện thoại</b>, bấm nút ${b("☰")} để mở/đóng menu.</li>
       </ul>
       <div class="hb-note"><b>🚀 Bắt đầu nhanh (8 bước)</b><ol style="margin:.3rem 0 0 1.2rem">
         <li>Đăng nhập.</li><li>Vào ${b("Cài đặt")} đặt tên trung tâm.</li><li>Tạo lớp ở ${b("Lớp học")}.</li>
         <li>Thêm học viên ở ${b("Học viên")}.</li><li>Đặt lịch tuần & sinh buổi ở ${b("Lịch học")}.</li>
         <li>${b("Điểm danh")} mỗi buổi.</li><li>Tính hóa đơn ở ${b("Học phí")}.</li><li>Thu tiền ở ${b("Thanh toán")}.</li>
       </ol></div>` },

    { id: "dang-nhap", icon: "🔑", title: "2. Đăng nhập & mật khẩu", feat: {
      muc_dich: "Vào workspace riêng của bạn để bắt đầu làm việc.",
      vi_tri: "Trang đăng nhập (mở đường link ứng dụng do đơn vị cung cấp gửi cho bạn).",
      steps: ["Mở đường link ứng dụng.", `Nhập ${b("Email")} và ${b("Mật khẩu")} được cấp.`, `Bấm ${b("Đăng nhập")}.`],
      ket_qua: "Vào thẳng màn hình “Tổng quan”.",
      luu_y: [
        "Ghi nhớ mật khẩu và không chia sẻ cho người khác.",
        "<b>Đổi mật khẩu:</b> phiên bản hiện tại chưa có nút tự đổi. Hãy liên hệ đơn vị cung cấp phần mềm để được đặt lại mật khẩu."
      ],
      loi: [
        { q: "Sai email hoặc mật khẩu", a: "Kiểm tra lại; nếu quên, nhờ đơn vị cung cấp đặt lại." },
        { q: "Tài khoản chưa được cấp quyền / bị tạm ngưng", a: "Liên hệ đơn vị cung cấp để kích hoạt lại." },
        { q: "Không đăng nhập được (lỗi mạng)", a: "Kiểm tra Internet và tải lại trang." }
      ] } },

    { id: "tong-quan", icon: "📊", title: "3. Màn hình Tổng quan", feat: {
      muc_dich: "Xem nhanh tình hình trung tâm và các việc cần làm hôm nay.",
      vi_tri: "Menu trái → “Tổng quan”.",
      steps: [
        "Xem 5 thẻ số liệu: “Học viên đang học”, “Lớp đang mở”, “Buổi học hôm nay”, “Thu trong tháng”, “Còn nợ học phí”. <b>Bấm vào thẻ</b> để tới mục tương ứng.",
        "Xem mục “🔔 Nhắc nhở”: buổi hôm nay chưa điểm danh, hóa đơn quá hạn, hóa đơn nháp chưa chốt, học viên đang nợ — bấm để xử lý ngay.",
        "Xem “📅 Buổi học hôm nay” và bấm để điểm danh."
      ],
      ket_qua: "Nắm ngay số học viên, lớp, buổi hôm nay và tình hình thu/nợ.",
      luu_y: ["Mọi số liệu tự cập nhật theo dữ liệu thực tế của bạn."] } },

    { id: "cai-dat", icon: "⚙️", title: "4. Cài đặt trung tâm", feat: {
      muc_dich: "Đặt tên trung tâm và ngày chốt học phí hằng tháng.",
      vi_tri: "Menu trái → “Cài đặt”.",
      steps: [`Sửa ô ${b("Tên trung tâm")}.`, `Đặt ${b("Ngày chốt học phí hằng tháng (1–28)")}.`, `Bấm ${b("💾 Lưu cài đặt")}.`],
      ket_qua: "Tên trung tâm hiển thị ở góc trên bên trái được cập nhật.",
      luu_y: ["Tiền tệ VND · múi giờ Việt Nam · ngày dạng DD/MM/YYYY là mặc định, không đổi."] } },

    { id: "lop-hoc", icon: "🏫", title: "5. Tạo & quản lý lớp học", feat: {
      muc_dich: "Tạo lớp, sửa thông tin, xem sĩ số và danh sách học viên của lớp.",
      vi_tri: "Menu trái → “Lớp học”.",
      steps: [
        `Bấm ${b("➕ Thêm lớp")}.`,
        `Nhập ${b("Tên lớp")} <b>(bắt buộc)</b>.`,
        "<i>(Tùy chọn)</i> Môn/khóa, Giáo viên (bấm ➕ để thêm giáo viên mới), Phòng học, Link học online, Sĩ số tối đa, Trạng thái, Ngày bắt đầu/kết thúc.",
        `Chọn ${b("Cách tính học phí")} và nhập ${b("Mức học phí (VND)")} (là <b>giá mỗi buổi</b> nếu tính theo buổi/chu kỳ).`,
        "<i>(Nếu tính theo chu kỳ)</i> nhập “Số buổi / chu kỳ” và “Ngày bắt đầu tính phí”.",
        `Bấm ${b("💾 Lưu")}.`
      ],
      ket_qua: "Lớp xuất hiện trong danh sách kèm sĩ số.",
      luu_y: [
        `Bấm ${b("👥 Học viên (N)")} để mở danh sách lớp (thêm/gỡ/chuyển học viên).`,
        `${b("Nhân bản")} tạo lớp giống hệt (không kèm học viên/lịch).`,
        `${b("Lưu trữ")} ẩn lớp nhưng giữ toàn bộ dữ liệu; bấm ${b("🗄️ Xem đã lưu trữ")} để khôi phục.`,
        "Lịch học hằng tuần được đặt ở mục “Lịch học”."
      ],
      loi: [{ q: "Thiếu tên lớp", a: "Nhập tên lớp." }, { q: "Ngày không hợp lệ", a: "Dùng đúng định dạng DD/MM/YYYY." }] } },

    { id: "hoc-vien", icon: "👤", title: "6. Thêm học viên", feat: {
      muc_dich: "Thêm một học viên vào workspace.",
      vi_tri: "Menu trái → “Học viên”.",
      steps: [
        `Bấm ${b("➕ Thêm học viên")}.`,
        "<i>(Tùy chọn)</i> bấm khung ảnh để tải ảnh đại diện (JPG/PNG, ≤5MB).",
        `Nhập ${b("Họ và tên")} <b>(bắt buộc)</b>.`,
        "<i>(Tùy chọn)</i> Ngày sinh (DD/MM/YYYY), Giới tính, SĐT, Email, Tên/SĐT phụ huynh, Địa chỉ, Ngày nhập học, Trạng thái, Ghi chú.",
        `Bấm ${b("💾 Lưu")}.`
      ],
      ket_qua: "Học viên được cấp mã tự động (HVxxxxx) và hiện trong danh sách.",
      luu_y: [
        "Chỉ “Họ và tên” bắt buộc; các ô khác để trống thoải mái.",
        `Học viên nghỉ hẳn: dùng ${b("Lưu trữ")} (giữ lịch sử) thay vì xóa.`,
        "Dùng ô tìm kiếm để lọc theo tên, SĐT, mã, SĐT phụ huynh."
      ],
      loi: [{ q: "Thiếu họ tên", a: "Nhập họ tên." }, { q: "Email/ngày không hợp lệ", a: "Sửa đúng định dạng." }] } },

    { id: "nhap-hang-loat", icon: "📥", title: "7. Nhập học viên hàng loạt (Excel)", feat: {
      muc_dich: "Thêm nhiều học viên cùng lúc từ file Excel hoặc dán dữ liệu.",
      vi_tri: "Menu trái → “Học viên” → nút “📥 Nhập hàng loạt”.",
      steps: [
        `Bấm ${b("📥 Nhập hàng loạt")}.`,
        `Bấm ${b("⬇ Tải file mẫu (.xlsx)")} để tải file Excel mẫu về máy.`,
        "Mở file, điền vào sheet <b>“Học viên”</b>, mỗi học viên MỘT dòng. Các cột: <b>Họ và tên</b> (bắt buộc) · Ngày sinh · Giới tính · Lớp · Số điện thoại.",
        "<b>Tên tiếng Việt:</b> gõ có dấu bình thường, ví dụ <i>Nguyễn Văn An</i> — hệ thống giữ nguyên, không lỗi phông chữ.",
        "<b>Giới tính:</b> bấm vào ô rồi chọn <b>Nam / Nữ / Khác</b> từ danh sách xổ xuống.",
        "<b>Lớp:</b> bấm vào ô rồi chọn tên lớp từ danh sách (chỉ gồm các lớp của bạn). Để trống nếu chưa muốn xếp lớp.",
        "<b>Ô tùy chọn</b> (Ngày sinh, Giới tính, SĐT…) cứ <b>để trống</b> nếu không có — không gây lỗi.",
        "Lưu file (Ctrl/Cmd+S), rồi quay lại ứng dụng.",
        `<i>(Tùy chọn)</i> chọn ${b("Nhập vào lớp")} — áp dụng cho các dòng bạn để trống cột Lớp.`,
        `Bấm ${b("📄 Chọn tệp (Excel/CSV)")} rồi chọn file .xlsx vừa lưu. <i>(Hoặc: bôi đen các dòng trong Excel → Copy → dán vào ô nhập.)</i>`,
        `Bấm ${b("Xem trước →")}.`,
        "<b>Kiểm tra bảng xem trước:</b> nhãn <span style='color:var(--good)'>Mới</span> = sẽ nhập; <span style='color:var(--warn)'>Trùng</span> = trùng SĐT hoặc họ tên; <span style='color:var(--danger)'>Lỗi</span> = thiếu tên hoặc sai định dạng. Cột “Ghi chú” giải thích từng dòng.",
        "Bấm ✕ ở đầu dòng để <b>bỏ</b> học viên không muốn nhập; tick “Bỏ qua … dòng trùng” nếu muốn bỏ các dòng trùng.",
        `Bấm ${b("💾 Nhập N học viên")}.`
      ],
      ket_qua: "Bảng tổng kết hiện ra: <b>Nhập thành công · Đã xếp vào lớp · Bỏ qua–trùng · Bỏ qua–lỗi</b>.",
      luu_y: [
        "File mẫu có sẵn 3 dòng ví dụ và một sheet “Hướng dẫn” bằng tiếng Việt.",
        "Muốn sửa: chỉnh lại file rồi tải lên / dán lại — làm lại bao nhiêu lần cũng được.",
        "Số điện thoại: nên định dạng ô là <b>Text</b> trong Excel để không mất số 0 ở đầu."
      ],
      loi: [
        { q: "Không đọc được file Excel", a: "Lưu lại đúng dạng .xlsx, hoặc dán dữ liệu, hoặc lưu thành .csv." },
        { q: "Lớp “…” không có", a: "Tên lớp trong file không khớp lớp của bạn — chọn đúng tên hoặc để trống." },
        { q: "Dòng bị “Lỗi”", a: "Sửa Họ tên/ngày sinh cho đúng rồi nhập lại; ô không bắt buộc có thể để trống." }
      ] } },

    { id: "chuyen-lop", icon: "↔", title: "8. Chuyển lớp / cho rời lớp", feat: {
      muc_dich: "Chuyển học viên sang lớp khác hoặc cho rời lớp, vẫn giữ nguyên lịch sử.",
      vi_tri: "Menu trái → “Học viên” → hàng học viên → nút “Lịch sử lớp”.",
      steps: [
        `Bấm ${b("Lịch sử lớp")} ở hàng của học viên.`,
        "Ở mục “Lớp đang học”, bấm “↔ Chuyển lớp” hoặc “Rời lớp”.",
        "<b>Chuyển lớp:</b> chọn lớp mới, ngày chuyển, lý do → bấm “↔ Chuyển lớp”.",
        "<b>Rời lớp:</b> chọn ngày rời + lý do → bấm “Rời lớp”."
      ],
      ket_qua: "Lớp cũ chuyển sang “Đã rời”, đồng thời mở ghi danh ở lớp mới; xem “Lịch sử chuyển lớp” trong cùng cửa sổ.",
      luu_y: [
        "Toàn bộ điểm danh & học phí cũ vẫn được giữ.",
        "Học phí tháng chuyển sẽ tự tách theo ngày chuyển."
      ] } },

    { id: "lich-hoc", icon: "🗓️", title: "9. Lịch học (lịch tuần & buổi học)", feat: {
      muc_dich: "Đặt lịch lặp hằng tuần, sinh buổi học tự động, thêm buổi bù, quản lý ngày lễ.",
      vi_tri: "Menu trái → “Lịch học”.",
      steps: [
        `Mở thẻ ${b("🔁 Lịch tuần & sinh buổi")}.`,
        "Ở lớp cần đặt, bấm “➕ Thêm lịch tuần”: chọn Thứ, giờ bắt đầu/kết thúc, ngày hiệu lực → Lưu. (Học 2 buổi/tuần thì thêm 2 dòng.)",
        "Bấm “⚡ Sinh buổi học”: chọn khoảng ngày → “⚡ Sinh buổi”. Hệ thống tạo các buổi cụ thể lên lịch.",
        `Xem lịch ở thẻ ${b("📅 Lịch")}: chọn Ngày/Tuần/Tháng, lọc theo Lớp/Giáo viên. Bấm ${b("➕ Buổi bù / buổi thêm")} để tạo buổi lẻ.`,
        `Quản lý ngày nghỉ ở thẻ ${b("🎌 Ngày lễ")}: thêm ngày + tên.`
      ],
      ket_qua: "Các buổi hiện lên lịch; dấu ⚠️ cảnh báo trùng giáo viên hoặc phòng.",
      luu_y: [
        "Sinh buổi <b>tự bỏ qua ngày lễ</b> và tôn trọng ngày bắt đầu/kết thúc của lớp.",
        "Chạy “Sinh buổi” lại nhiều lần vẫn an toàn — không tạo trùng."
      ],
      loi: [{ q: "Không có buổi để điểm danh/tính phí", a: "Vào Lịch học → thêm lịch tuần → “⚡ Sinh buổi học” trước." }] } },

    { id: "diem-danh", icon: "✅", title: "10. Điểm danh", feat: {
      muc_dich: "Điểm danh học viên theo từng buổi.",
      vi_tri: "Menu trái → “Điểm danh”.",
      steps: [
        `Ở thẻ ${b("✅ Điểm danh")}, chọn ngày bằng ${b("‹ Hôm trước / Hôm nay / Hôm sau ›")} và <i>(tùy chọn)</i> lọc theo Lớp.`,
        `Ở buổi cần điểm danh, bấm ${b("✅ Điểm danh")}.`,
        "Mặc định mọi học viên là “Có mặt”. Bấm nút trạng thái để đổi: Muộn / Về sớm / Vắng CP / Vắng KP. Bấm 📝 để ghi chú.",
        `<i>(Nhanh)</i> bấm ${b("✓ Tất cả có mặt")}.`,
        `Bấm ${b("💾 Lưu điểm danh")}.`
      ],
      ket_qua: "Buổi chuyển sang “Đã điểm danh”, hiển thị số có mặt / vắng.",
      luu_y: [
        "Danh sách là những học viên có ghi danh hiệu lực đúng ngày buổi đó.",
        "Có thể mở lại và sửa điểm danh bất cứ lúc nào."
      ] } },

    { id: "chuyen-can", icon: "📈", title: "11. Chuyên cần & tiến độ học", feat: {
      muc_dich: "Xem tỉ lệ đi học (chuyên cần) của từng học viên trong một lớp.",
      vi_tri: "Menu trái → “Điểm danh” → thẻ “📊 Lịch sử & chuyên cần”.",
      steps: [
        `Mở thẻ ${b("📊 Lịch sử & chuyên cần")}.`,
        "Chọn lớp.",
        "Xem bảng: số buổi, có mặt, vắng, chưa điểm danh, và tỉ lệ chuyên cần (tô màu xanh/vàng/đỏ).",
        `Bấm ${b("Chi tiết")} để xem từng buổi của một học viên.`
      ],
      ket_qua: "Biết học viên nào đi học đều, ai hay vắng.",
      luu_y: ["Muốn xem nhiều lớp / theo khoảng ngày và xuất file → dùng mục “Báo cáo” → “📊 Chuyên cần”."] } },

    { id: "hoc-phi", icon: "🧾", title: "12. Học phí & hóa đơn", feat: {
      muc_dich: "Tính học phí theo tháng hoặc theo chu kỳ (mỗi X buổi) và chốt hóa đơn.",
      vi_tri: "Menu trái → “Học phí”.",
      steps: [
        `<i>(Nếu cần)</i> đặt mức phí theo thời gian ở thẻ ${b("💰 Mức phí")} → chọn lớp → “➕ Thêm mức phí”.`,
        `Ở thẻ ${b("🧾 Hóa đơn tháng")}, chọn tháng và lớp.`,
        `Bấm ${b("⚡ Tính hóa đơn nháp")}.`,
        "Trong hộp thoại: chọn <b>Từ ngày / Đến ngày</b> (hoặc với lớp theo chu kỳ: “Ngày bắt đầu kỳ” + “Số buổi / chu kỳ”); bật/tắt “Tính cả buổi trong tương lai”; <b>tick từng buổi</b> cần tính; xem tổng → bấm “⚡ Tạo hóa đơn nháp”.",
        `Bấm ${b("Xem")} một hóa đơn để kiểm tra chi tiết.`,
        `Bấm ${b("🔒 Chốt hóa đơn")} (hoặc ${b("🔒 Chốt tất cả nháp")}) và đặt hạn thanh toán.`
      ],
      ket_qua: "Hóa đơn chuyển “Chưa thu”, sẵn sàng để thu tiền.",
      luu_y: [
        "Hóa đơn “Nháp” có thể “Tính lại” hoặc “Xóa”. Đã chốt là <b>bất biến</b> — sửa qua “Điều chỉnh” (ở mục Thanh toán).",
        "Lớp tính theo chu kỳ tự gợi ý ngày bắt đầu kỳ tiếp theo, không phải đếm buổi thủ công."
      ],
      loi: [
        { q: "Chưa có buổi để tính", a: "Vào Lịch học sinh buổi trước." },
        { q: "Không thấy hóa đơn", a: "Kiểm tra đã chọn đúng tháng và lớp chưa." }
      ] } },

    { id: "thanh-toan", icon: "💵", title: "13. Thu tiền, biên nhận & công nợ", feat: {
      muc_dich: "Ghi nhận thu tiền, in biên nhận, theo dõi ai còn nợ.",
      vi_tri: "Menu trái → “Thanh toán”.",
      steps: [
        `Ở thẻ ${b("💵 Thu tiền")}, bấm ${b("➕ Thu tiền")}.`,
        "Tìm và chọn học viên.",
        "Chọn hóa đơn (hoặc “Trả trước / không gắn hóa đơn”); nhập số tiền (tự điền theo số còn nợ), ngày, hình thức, mã tham chiếu, ghi chú.",
        `Bấm ${b("💾 Lưu")} → biên nhận hiện ra, bấm ${b("🖨 In biên nhận")} nếu cần.`,
        `Xem ${b("📒 Công nợ")}: ai còn nợ / đang dư; bấm ${b("Sổ chi tiết")} để xem hóa đơn + lịch sử thu; thu tiền hoặc “Điều chỉnh” ngay tại đó.`
      ],
      ket_qua: "Trạng thái hóa đơn tự cập nhật: Chưa thu → Thu một phần → Đã thanh toán.",
      luu_y: [
        "Hoàn tiền: tick ô “Đây là khoản HOÀN TIỀN cho học viên”.",
        "“Điều chỉnh” dùng cho hóa đơn đã chốt — không ghi đè, có truy vết đầy đủ."
      ] } },

    { id: "bao-cao", icon: "📊", title: "14. Báo cáo & xuất CSV", feat: {
      muc_dich: "Xem và xuất báo cáo Doanh thu, Công nợ, Chuyên cần.",
      vi_tri: "Menu trái → “Báo cáo”.",
      steps: [
        `Chọn thẻ ${b("💰 Doanh thu")} / ${b("📒 Công nợ")} / ${b("📊 Chuyên cần")}.`,
        "Chọn khoảng ngày (và chọn lớp với báo cáo Chuyên cần).",
        `Bấm ${b("⬇ Xuất CSV")} để tải file (mở bằng Excel/Google Sheets).`
      ],
      ket_qua: "File CSV giữ đúng dấu tiếng Việt và số liệu để tính toán.",
      luu_y: ["Doanh thu tách theo tháng / hình thức / lớp. Công nợ là ảnh chụp tại thời điểm xem."] } },

    { id: "nhat-ky", icon: "📜", title: "15. Nhật ký thay đổi", feat: {
      muc_dich: "Xem lịch sử mọi thao tác thêm / sửa / xóa trong workspace.",
      vi_tri: "Menu trái → “Nhật ký”.",
      steps: ["Lọc theo Đối tượng / Thao tác / khoảng ngày.", `Bấm ${b("Chi tiết")} để xem nội dung trước – sau khi thay đổi.`],
      ket_qua: "Biết ai đã làm gì, khi nào.",
      luu_y: ["Chỉ chủ workspace mới xem được nhật ký."] } },

    { id: "faq", icon: "❓", title: "16. Câu hỏi thường gặp", html:
      `<ul>
        <li><b>Quên mật khẩu?</b> Liên hệ đơn vị cung cấp phần mềm để được đặt lại.</li>
        <li><b>Học viên nghỉ hẳn thì làm gì?</b> Dùng “Lưu trữ” (giữ lịch sử) thay vì xóa; có thể khôi phục sau.</li>
        <li><b>Lỡ xóa/lưu trữ nhầm?</b> Mục đã lưu trữ có thể khôi phục. Hóa đơn nháp xóa được; hóa đơn đã chốt thì dùng “Điều chỉnh”.</li>
        <li><b>Dùng trên điện thoại được không?</b> Được. Bấm ${b("☰")} để mở menu.</li>
        <li><b>Đổi giao diện Sáng/Tối?</b> Bấm nút ${b("🌙")} ở góc trên bên phải.</li>
        <li><b>Dữ liệu của tôi có riêng tư không?</b> Có. Mỗi tài khoản là một workspace riêng, cách ly hoàn toàn với người khác.</li>
      </ul>` },

    { id: "su-co", icon: "🩹", title: "17. Xử lý sự cố thường gặp", html:
      `<ul>
        <li><b>Trang trắng / không tải:</b> tải lại trang bằng <span class="hb-kbd">Ctrl/Cmd + Shift + R</span>.</li>
        <li><b>Không lưu được:</b> kiểm tra Internet rồi thử lại.</li>
        <li><b>File Excel không nhận:</b> lưu lại đúng dạng .xlsx, hoặc dán dữ liệu, hoặc lưu thành .csv.</li>
        <li><b>Không thấy dữ liệu vừa nhập:</b> kiểm tra bộ lọc (trạng thái/tháng/lớp) hoặc tải lại trang.</li>
        <li><b>Trình duyệt báo “Not Secure”:</b> hãy dùng đúng đường link an toàn (https) mà đơn vị cung cấp gửi.</li>
      </ul>` },

    { id: "ho-tro", icon: "🆘", title: "18. Hỗ trợ kỹ thuật", html:
      `<p>Liên hệ <b>đơn vị cung cấp phần mềm</b> để được hỗ trợ: đặt lại mật khẩu, kích hoạt/tạm ngưng tài khoản, hoặc khi gặp lỗi.</p>
       <div class="hb-note"><b>💡 Khi cần hỗ trợ, hãy mô tả:</b><ul style="margin:.3rem 0 0 1.2rem">
         <li>Bạn đang ở mục nào (ví dụ “Học phí”)?</li>
         <li>Bạn bấm nút gì trước khi lỗi?</li>
         <li>Thông báo lỗi hiện ra (chụp màn hình nếu được).</li>
       </ul></div>` },

    { id: "chua-co", icon: "🔧", title: "19. Tính năng chưa có trong phiên bản này", html:
      `<p>Phiên bản hiện tại tập trung vào: quản lý học viên, lớp, lịch học, điểm danh, học phí, thu tiền và báo cáo.</p>
       <p>Một số tính năng <b>chưa có</b> (có thể được bổ sung trong tương lai) — vui lòng không tìm trên menu:</p>
       <ul>
         <li>Quản lý nội dung bài học / khóa học.</li>
         <li>Chấm điểm bài kiểm tra & xem đáp án đúng/sai.</li>
         <li>Gửi thông báo / tin nhắn cho học viên.</li>
       </ul>
       <p class="muted">Nếu bạn cần những tính năng này, hãy đề xuất với đơn vị cung cấp phần mềm.</p>` }
  ];

  function layout() {
    const toc = SECTIONS.map(s => `<a data-toc="${s.id}">${s.icon} ${e(s.title)}</a>`).join("");
    const content = SECTIONS.map(s => `<section class="hb-sec" id="hb-${s.id}" data-sec="${s.id}">
        <h2>${s.icon} ${e(s.title)}</h2>
        ${s.html || feat(s.feat)}
        <a class="hb-top" data-top>↑ Quay lại mục lục</a>
      </section>`).join("");
    return `<div class="hb">
      <div class="hb-head">
        <h1 style="font-size:1.5rem;">📖 Hướng dẫn sử dụng</h1>
        <span style="flex:1"></span>
        <div class="hb-tools" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
          <input id="hb-search" class="hb-search" placeholder="🔎 Tìm hướng dẫn (vd: điểm danh, hóa đơn…)">
          <button class="btn ghost" id="hb-toctoggle">☰ Mục lục</button>
          <button class="btn" id="hb-print">🖨 In / Lưu PDF</button>
        </div>
      </div>
      <div class="hb-body">
        <nav class="hb-toc" id="hb-toc">${toc}</nav>
        <div class="hb-content">
          <p id="hb-noresult" class="muted" style="display:none;padding:1rem;">Không tìm thấy mục phù hợp. Xóa từ khóa để xem lại toàn bộ.</p>
          ${content}
        </div>
      </div>
    </div>`;
  }

  function wire() {
    const inp = box.querySelector("#hb-search");
    const toc = box.querySelector("#hb-toc");
    box.querySelectorAll("[data-toc]").forEach(a => a.addEventListener("click", () => {
      const s = box.querySelector("#hb-" + a.dataset.toc);
      if (s) { s.scrollIntoView({ behavior: "smooth", block: "start" }); toc.classList.remove("open"); }
    }));
    box.querySelectorAll("[data-top]").forEach(a => a.addEventListener("click", () => {
      const h = box.querySelector(".hb-head"); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
      toc.classList.add("open");
    }));
    box.querySelector("#hb-toctoggle").addEventListener("click", () => toc.classList.toggle("open"));
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase(); let any = false;
      box.querySelectorAll(".hb-sec").forEach(s => { const hit = !q || s.textContent.toLowerCase().includes(q); s.style.display = hit ? "" : "none"; if (hit && q) any = true; });
      box.querySelectorAll("[data-toc]").forEach(a => { const s = box.querySelector('[data-sec="' + a.dataset.toc + '"]'); a.style.display = (!q || (s && s.style.display !== "none")) ? "" : "none"; });
      const nr = box.querySelector("#hb-noresult"); if (nr) nr.style.display = (q && !any) ? "" : "none";
    });
    box.querySelector("#hb-print").addEventListener("click", () => {
      inp.value = ""; inp.dispatchEvent(new Event("input"));
      setTimeout(() => window.print(), 120);
    });
    // tô sáng mục đang xem (scrollspy)
    const spy = () => {
      const secs = [...box.querySelectorAll(".hb-sec")].filter(s => s.style.display !== "none");
      let cur = secs[0];
      for (const s of secs) if (s.getBoundingClientRect().top <= 140) cur = s;
      box.querySelectorAll("[data-toc]").forEach(a => a.classList.toggle("on", cur && a.dataset.toc === cur.dataset.sec));
    };
    _scroll = spy; window.addEventListener("scroll", spy, { passive: true }); spy();
  }

  return {
    render(el) {
      box = el;
      if (_scroll) { window.removeEventListener("scroll", _scroll); _scroll = null; }
      box.innerHTML = layout();
      wire();
    }
  };
})();

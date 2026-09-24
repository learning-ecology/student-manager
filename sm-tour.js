/* ============================================================
   Hướng dẫn nhanh (guided tour) — chỉ vào từng mục trên sidebar, thích ứng
   theo loại tài khoản (chỉ giới thiệu module đang bật) + vai trò.
   Dùng: Tour.startDefault(TENANT, role) hoặc Tour.start(steps).
   ============================================================ */
window.Tour = (function () {
  let steps = [], i = 0, ov = null, spot = null, pop = null, drawer = false;

  const DESC = {
    me: "Trang của bạn — lịch dạy hôm nay, lớp, chấm công và lương của bạn.",
    dashboard: "Bảng tổng quan — nhìn nhanh tình hình hôm nay.",
    students: "Học viên — thêm, sửa, tìm và quản lý học viên.",
    classes: "Lớp học — tạo lớp, gán giáo viên, đặt lịch tuần và ghi danh học viên ngay tại đây.",
    schedule: "Lịch học — xem lịch, đặt lịch tuần và sinh buổi học tự động (bỏ qua ngày lễ).",
    ops: "Điều hành — ai đang dạy, lớp nào đang chạy, giáo viên nào rảnh/bận.",
    attendance: "Điểm danh — ghi điểm danh học viên cho từng buổi.",
    checkin: "Chấm công GV — giáo viên quét QR để check-in; bạn xác nhận buổi dạy.",
    tuition: "Học phí — tạo hóa đơn (kèm buổi đã hủy), theo dõi công nợ.",
    payments: "Thanh toán — ghi nhận học viên đóng tiền.",
    payroll: "Lương giáo viên — đặt định mức và tính lương theo số buổi đã dạy.",
    reports: "Báo cáo — số liệu tổng hợp về học viên, lớp và tài chính.",
    audit: "Nhật ký — lịch sử các thao tác trong hệ thống.",
    handbook: "Hướng dẫn sử dụng — tài liệu chi tiết từng phần.",
    settings: "Cài đặt — thông tin trung tâm, và (với trung tâm) liên kết tài khoản giáo viên."
  };

  function start(_steps) {
    steps = (_steps || []).filter(s => document.querySelector(s.sel));
    if (!steps.length) return;
    // mở ngăn kéo sidebar trên màn hình hẹp để thấy được các mục
    drawer = window.innerWidth <= 860;
    if (drawer) { document.getElementById("side").classList.add("open"); const bd = document.getElementById("backdrop"); if (bd) bd.classList.add("on"); }
    ov = document.createElement("div"); ov.className = "tour-ov";
    spot = document.createElement("div"); spot.className = "tour-spot"; ov.appendChild(spot);
    pop = document.createElement("div"); pop.className = "tour-pop";
    document.body.appendChild(ov); document.body.appendChild(pop);
    i = 0; show();
    window.addEventListener("resize", position);
    document.addEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") end(); else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") prev(); }

  function show() {
    const s = steps[i], el = document.querySelector(s.sel);
    if (!el) return next();
    try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
    pop.innerHTML = `<h4>${SM.esc(s.title)}</h4><p>${SM.esc(s.body)}</p>
      <div class="tour-pop-ft"><span class="tour-step">${i + 1}/${steps.length}</span>
        <button class="btn ghost tour-skip">Bỏ qua</button>
        ${i > 0 ? '<button class="btn ghost tour-prev">Quay lại</button>' : ""}
        <button class="btn tour-next">${i === steps.length - 1 ? "Xong ✓" : "Tiếp →"}</button></div>`;
    pop.querySelector(".tour-skip").onclick = end;
    const pv = pop.querySelector(".tour-prev"); if (pv) pv.onclick = prev;
    pop.querySelector(".tour-next").onclick = next;
    position();
  }
  function position() {
    const s = steps[i], el = document.querySelector(s.sel); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 6;
    spot.style.left = (r.left - pad) + "px"; spot.style.top = (r.top - pad) + "px";
    spot.style.width = (r.width + pad * 2) + "px"; spot.style.height = (r.height + pad * 2) + "px";
    const pw = pop.offsetWidth || 300, ph = pop.offsetHeight || 150;
    let left = r.right + 14, top = r.top;
    if (left + pw > window.innerWidth - 10) { left = Math.max(10, Math.min(r.left, window.innerWidth - pw - 10)); top = r.bottom + 12; }
    if (top + ph > window.innerHeight - 10) top = Math.max(10, window.innerHeight - ph - 10);
    pop.style.left = left + "px"; pop.style.top = Math.max(10, top) + "px";
  }
  function next() { if (i >= steps.length - 1) return end(); i++; show(); }
  function prev() { if (i <= 0) return; i--; show(); }
  function end() {
    window.removeEventListener("resize", position); document.removeEventListener("keydown", onKey);
    if (ov) ov.remove(); if (pop) pop.remove(); ov = spot = pop = null;
    if (drawer) { document.getElementById("side").classList.remove("open"); const bd = document.getElementById("backdrop"); if (bd) bd.classList.remove("on"); }
  }

  // Tự dựng các bước từ những mục sidebar ĐANG HIỆN (đúng loại tài khoản + vai trò)
  function startDefault(tenant, role) {
    let list;
    if (role === "teacher") list = ["me"];
    else list = SM.MODULES.map(m => m.k).filter(k => SM.moduleEnabled(k, tenant)).concat("settings");
    const seen = {};
    const steps = list.filter(k => !seen[k] && (seen[k] = 1)).map(k => {
      const a = document.querySelector(`#nav a[data-nav="${k}"]`);
      if (!a || a.hidden) return null;
      const M = SM.MODULES.find(m => m.k === k);
      return { sel: `#nav a[data-nav="${k}"]`, title: (M ? M.l : (k === "settings" ? "Cài đặt" : k)), body: DESC[k] || "" };
    }).filter(Boolean);
    start(steps);
  }

  return { start, startDefault };
})();

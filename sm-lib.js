/* ============================================================
   Tiện ích dùng chung — định dạng VN, xác thực, thông báo
   Ngày DD/MM/YYYY · giờ Asia/Ho_Chi_Minh · tiền VND
   ============================================================ */
const SM = (function () {
  const TZ = "Asia/Ho_Chi_Minh";

  // ---- định dạng ----
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // 1200000 → "1.200.000₫"
  const vnd = n => (Number(n) || 0).toLocaleString("vi-VN") + "₫";
  const vndPlain = n => (Number(n) || 0).toLocaleString("vi-VN");

  // "2026-07-24" hoặc Date → "24/07/2026"
  function dmy(d) {
    if (!d) return "";
    const x = (d instanceof Date) ? d : new Date(d + (String(d).length === 10 ? "T00:00:00" : ""));
    if (isNaN(x)) return String(d);
    return x.toLocaleDateString("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  }
  // datetime → "24/07/2026 18:30"
  function dmyhm(d) {
    if (!d) return "";
    const x = (d instanceof Date) ? d : new Date(d);
    if (isNaN(x)) return String(d);
    return x.toLocaleString("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  // "18:30:00" → "18:30"
  const hm = t => t ? String(t).slice(0, 5) : "";
  // hôm nay theo giờ VN, dạng yyyy-mm-dd (để lưu DB)
  function todayISO() {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const g = t => p.find(x => x.type === t).value;
    return g("year") + "-" + g("month") + "-" + g("day");
  }
  const WEEKDAYS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

  // đọc "24/07/2026" → "2026-07-24" (để lưu). Trả "" nếu sai.
  function parseDmy(s) {
    const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return "";
    const dd = m[1].padStart(2, "0"), mm = m[2].padStart(2, "0");
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return "";
    return m[3] + "-" + mm + "-" + dd;
  }

  // ---- thông báo (toast) ----
  function toast(msg, kind) {
    let box = document.getElementById("sm-toasts");
    if (!box) { box = document.createElement("div"); box.id = "sm-toasts"; document.body.appendChild(box); }
    const el = document.createElement("div");
    el.className = "sm-toast " + (kind || "ok");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3200);
  }

  // ---- hộp thoại xác nhận ----
  function confirmDialog({ title, body, okText, danger }) {
    return new Promise(resolve => {
      const ov = document.createElement("div");
      ov.className = "sm-ov";
      ov.innerHTML = `<div class="sm-dialog">
        <h3>${esc(title || "Xác nhận")}</h3>
        ${body ? `<p>${body}</p>` : ""}
        <div class="sm-dialog-actions">
          <button class="btn ghost" data-x="no">Hủy</button>
          <button class="btn ${danger ? "danger" : ""}" data-x="yes">${esc(okText || "Đồng ý")}</button>
        </div></div>`;
      document.body.appendChild(ov);
      const done = v => { ov.remove(); resolve(v); };
      ov.addEventListener("click", e => {
        if (e.target === ov || e.target.dataset.x === "no") done(false);
        if (e.target.dataset.x === "yes") done(true);
      });
      document.addEventListener("keydown", function esc2(e) { if (e.key === "Escape") { done(false); document.removeEventListener("keydown", esc2); } });
    });
  }

  // ---- bảo vệ trang: phải đăng nhập + có trong app_users ----
  //  Trả về { user, profile } hoặc chuyển hướng về login.
  async function requireAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = "login.html"; return null; }
    const { data: profile } = await sb.from("app_users").select("*").eq("id", session.user.id).maybeSingle();
    if (!profile || !profile.active) {
      await sb.auth.signOut();
      location.href = "login.html?denied=1";
      return null;
    }
    return { user: session.user, profile };
  }

  const roleLabel = r => ({ owner: "Chủ sở hữu", admin: "Quản trị", teacher: "Giáo viên" }[r] || r);

  // ---- Danh mục module + bật/tắt theo loại tài khoản / tính năng (Giai đoạn G) ----
  //  centerOnly: mặc định CHỈ bật cho trung tâm (cá nhân ẩn). always: luôn bật.
  //  features (tenants.features) ghi đè: {module:true/false} do chủ nền tảng đặt.
  const MODULES = [
    { k: "dashboard", l: "Tổng quan", icon: "📊", always: true },
    { k: "students", l: "Học viên", icon: "👤" },
    { k: "classes", l: "Lớp học", icon: "🏫" },
    { k: "schedule", l: "Lịch học", icon: "🗓️" },
    { k: "ops", l: "Điều hành", icon: "🧭", centerOnly: true },
    { k: "attendance", l: "Điểm danh", icon: "✅" },
    { k: "checkin", l: "Chấm công GV", icon: "📲", centerOnly: true },
    { k: "tuition", l: "Học phí", icon: "🧾" },
    { k: "payments", l: "Thanh toán", icon: "💵" },
    { k: "payroll", l: "Lương giáo viên", icon: "👩‍🏫", centerOnly: true },
    { k: "reports", l: "Báo cáo", icon: "📈" },
    { k: "audit", l: "Nhật ký", icon: "📜", centerOnly: true },
    { k: "handbook", l: "Hướng dẫn sử dụng", icon: "📖", always: true }
  ];
  // ---- Màu lớp (Giai đoạn H) — nguồn duy nhất, dùng lại ở Lịch học, Điều hành, Điểm danh… ----
  const CLASS_COLORS = [
    { n: "Xanh dương", h: "#2563eb" }, { n: "Xanh lá", h: "#16a34a" }, { n: "Cam", h: "#ea580c" },
    { n: "Đỏ", h: "#dc2626" }, { n: "Tím", h: "#7c3aed" }, { n: "Xanh ngọc", h: "#0d9488" },
    { n: "Hồng", h: "#db2777" }, { n: "Vàng", h: "#d97706" }, { n: "Lam", h: "#0891b2" }, { n: "Xám", h: "#64748b" }
  ];
  const CLASS_COLOR_DEFAULT = "#94a3b8";
  // Trả về bộ style nhất quán (viền + nền mờ) từ mã màu lớp; hoạt động ở cả sáng/tối vì nền chỉ ~13% alpha.
  const classTint = hex => {
    const h = (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) ? hex : CLASS_COLOR_DEFAULT;
    return { solid: h, border: h, bg: h + "22" };
  };

  const moduleEnabled = (key, tenant) => {
    const M = MODULES.find(m => m.k === key);
    if (M && M.always) return true;
    const f = (tenant && tenant.features) || {};
    if (Object.prototype.hasOwnProperty.call(f, key)) return !!f[key];   // ghi đè của chủ nền tảng
    if (tenant && tenant.account_type === "individual") return !(M && M.centerOnly);
    return true;                                                          // trung tâm: bật hết
  };

  // ---- Cache dữ liệu tham chiếu (lớp/giáo viên/cài đặt) ----
  //  Nhiều trang cùng cần danh sách lớp/giáo viên. Cache lại để KHÔNG tải
  //  lặp lại mỗi lần chuyển trang. Ghi (thêm/sửa/xóa lớp, GV, cài đặt) gọi
  //  SM.invalidate(...) để làm mới. Đồng thời gộp các yêu cầu trùng lúc.
  const _rc = {};
  function _cache(key, fetcher, ttl) {
    const c = _rc[key];
    if (c && Date.now() - c.t < (ttl || 60000)) return c.p;
    const p = Promise.resolve().then(fetcher).catch(err => { delete _rc[key]; throw err; });
    _rc[key] = { p, t: Date.now() };
    return p;
  }
  const invalidate = key => { if (key === undefined) { for (const k in _rc) delete _rc[k]; } else delete _rc[key]; };
  const refClasses = () => _cache("classes", async () => {
    const { data } = await sb.from("classes")
      .select("id,name,teacher_id,room,online_link,start_date,end_date,status,subject,max_students,tuition_method,tuition_amount,billing_cycle,billing_start,billing_include_future,color")
      .is("archived_at", null).order("name");
    return data || [];
  });
  const refTeachers = () => _cache("teachers", async () => {
    const { data } = await sb.from("teachers").select("id,full_name").is("archived_at", null).order("full_name");
    return data || [];
  });
  const refSettings = () => _cache("settings", async () => {
    const { data } = await sb.from("settings").select("*").limit(1).maybeSingle();
    return data || null;
  }, 300000);

  return { esc, vnd, vndPlain, dmy, dmyhm, hm, todayISO, parseDmy, WEEKDAYS, toast, confirmDialog, requireAuth, roleLabel, TZ,
           refClasses, refTeachers, refSettings, invalidate, MODULES, moduleEnabled,
           CLASS_COLORS, CLASS_COLOR_DEFAULT, classTint };
})();

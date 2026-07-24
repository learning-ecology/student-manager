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

  return { esc, vnd, vndPlain, dmy, dmyhm, hm, todayISO, parseDmy, WEEKDAYS, toast, confirmDialog, requireAuth, roleLabel, TZ };
})();

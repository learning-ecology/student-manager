/* ============================================================
   Giai đoạn C — CHẤM CÔNG GIÁO VIÊN (check-in QR / thủ công)
   • Bảng chấm công (staff): buổi theo ngày + trạng thái check-in + thao tác + QR.
   • Trang tự check-in (#checkin?s=…): GV quét QR → xác nhận có mặt buổi của mình.
   Dùng lại sessions/classes/teachers + bảng teacher_checkins, RPC teacher_check_in.
   Cần chạy phaseC-checkin.sql.
   ============================================================ */
window.Checkin = (function () {
  let ME = null, box = null, busy = false;
  const st = { date: "" };
  let classes = [], teachers = [], sessions = [], checkins = {};

  const cls = id => classes.find(c => c.id === id) || {};
  const cName = id => cls(id).name || "—";
  const tName = id => id ? ((teachers.find(t => t.id === id) || {}).full_name || "GV") : "— chưa gán —";
  const effTeacher = s => s.teacher_id || cls(s.class_id).teacher_id || null;
  const hm = t => (t || "").slice(0, 5);
  const STAT = {
    on_time: { l: "Đúng giờ", c: "ok" }, late: { l: "Muộn", c: "warn" },
    absent_excused: { l: "Vắng có phép", c: "mute" }, confirmed: { l: "Đã xác nhận", c: "ok" }, absent: { l: "Vắng", c: "bad" }
  };
  const timeHM = ts => { if (!ts) return ""; const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

  // ---- QR (nạp thư viện khi cần) ----
  let _qrP = null;
  function ensureQR() {
    if (window.QRCode) return Promise.resolve();
    if (_qrP) return _qrP;
    _qrP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; s.onload = res; s.onerror = () => { _qrP = null; rej(new Error("Không tải được thư viện QR")); }; document.head.appendChild(s); });
    return _qrP;
  }
  const checkinLink = sid => location.origin + location.pathname + "#checkin?s=" + sid;

  /* ================= BẢNG CHẤM CÔNG (STAFF) ================= */
  async function loadBoard() {
    busy = true; paint();
    const d = st.date || SM.todayISO(); st.date = d;
    const [tc, cl, ss] = await Promise.all([
      SM.refTeachers(), SM.refClasses(),
      sb.from("sessions").select("id,class_id,date,start_time,end_time,teacher_id,room,status").eq("date", d).neq("status", "cancelled").order("start_time")
    ]);
    teachers = tc || []; classes = cl || []; sessions = ss.data || [];
    checkins = {};
    const ids = sessions.map(s => s.id);
    if (ids.length) {
      const { data, error } = await sb.from("teacher_checkins").select("*").in("session_id", ids);
      if (error) { busy = false; box.innerHTML = errCard(error); return; }
      (data || []).forEach(c => checkins[c.session_id] = c);
    }
    busy = false; paint();
  }
  const errCard = e => `<h1>Chấm công giáo viên</h1><div class="card placeholder"><div class="big">⚙️</div><p><b>Chưa chạy phaseC-checkin.sql</b></p><p class="muted">${SM.esc(e.message || "")}</p><p class="muted">Vào Supabase → SQL Editor, dán <code>phaseC-checkin.sql</code> và Run, rồi tải lại trang.</p></div>`;

  function paint() {
    if (!box) return;
    if (busy) { box.innerHTML = `<h1>Chấm công giáo viên</h1><div class="card placeholder"><span class="spinner"></span></div>`; return; }
    const d = st.date, now = new Date();
    const dow = SM.WEEKDAYS[new Date(d + "T00:00:00").getDay()];
    const rows = sessions.map(s => {
      const ck = checkins[s.id], eff = effTeacher(s);
      const statusCell = ck
        ? `<span class="badge ${STAT[ck.status].c}">${STAT[ck.status].l}</span>${ck.checked_in_at ? ` <span class="muted">${timeHM(ck.checked_in_at)}</span>` : ""}${ck.source === "qr" ? ' <span class="muted" title="Tự quét QR">📱</span>' : ""}`
        : (s.status === "held" ? `<span class="badge warn">chờ xác nhận</span>` : `<span class="muted">chưa check-in</span>`);
      const actions = ck
        ? `<button class="btn ghost" data-undo="${s.id}">↩ Hoàn tác</button><button class="btn ghost" data-qr="${s.id}">▦ QR</button>`
        : (eff
          ? `<button class="btn ghost" data-confirm="${s.id}">✔ Xác nhận dạy</button><button class="btn ghost" data-excuse="${s.id}">Vắng CP</button><button class="btn ghost" data-qr="${s.id}">▦ QR</button>`
          : `<span class="badge warn">chưa gán GV</span>`);
      return `<tr>
        <td data-th="Giờ"><b>${hm(s.start_time)}–${hm(s.end_time)}</b></td>
        <td data-th="Lớp">${SM.classDot(cls(s.class_id).color)}<b>${SM.esc(cName(s.class_id))}</b></td>
        <td data-th="Giáo viên">${eff ? SM.esc(tName(ck ? ck.teacher_id : eff)) : `<span class="badge warn">chưa gán</span>`}</td>
        <td data-th="Chấm công">${statusCell}</td>
        <td class="cell-actions"><div class="row-actions">${actions}</div></td></tr>`;
    }).join("");
    box.innerHTML = `<h1>Chấm công giáo viên</h1>
      <div class="toolbar" style="gap:.5rem;align-items:center;margin-bottom:.7rem;flex-wrap:wrap;">
        <button class="btn ghost" data-nav="-1">‹</button>
        <b style="min-width:210px;text-align:center;">${dow}, ${SM.dmy(d)}</b>
        <button class="btn ghost" data-nav="1">›</button>
        <button class="btn ghost" data-today>Hôm nay</button>
        <div class="field" style="margin-left:auto;"><label>Chọn ngày</label><input id="ck-date" value="${SM.dmy(d)}" style="width:140px"></div>
      </div>
      <p class="muted" style="font-size:.85rem;margin:0 0 .6rem;">Giáo viên tự <b>quét QR</b> để check-in buổi của mình (ghi đúng giờ/muộn theo thời gian thực). Nhân viên có thể <b>xác nhận</b> hoặc đánh dấu <b>vắng có phép</b>. Thiếu check-in <b>không tự trừ lương</b> — chỉ để đối chiếu.</p>
      ${!sessions.length ? `<div class="card placeholder"><div class="big">🗓️</div><p>Không có buổi học nào trong ngày này.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Giờ</th><th>Lớp</th><th>Giáo viên</th><th>Chấm công</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`}`;

    box.querySelector("[data-nav='-1']").onclick = () => { st.date = shift(d, -1); loadBoard(); };
    box.querySelector("[data-nav='1']").onclick = () => { st.date = shift(d, 1); loadBoard(); };
    box.querySelector("[data-today]").onclick = () => { st.date = SM.todayISO(); loadBoard(); };
    box.querySelector("#ck-date").onchange = e => { const p = SM.parseDmy(e.target.value.trim()); if (p) { st.date = p; loadBoard(); } };
    box.querySelectorAll("[data-confirm]").forEach(b => b.onclick = () => doCheckin(b.dataset.confirm, "confirmed"));
    box.querySelectorAll("[data-excuse]").forEach(b => b.onclick = () => doCheckin(b.dataset.excuse, "absent_excused"));
    box.querySelectorAll("[data-undo]").forEach(b => b.onclick = () => undo(b.dataset.undo));
    box.querySelectorAll("[data-qr]").forEach(b => b.onclick = () => qrModal(b.dataset.qr));
  }
  const shift = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  async function doCheckin(sid, status) {
    const s = sessions.find(x => x.id === sid); const eff = effTeacher(s);
    const { error } = await sb.rpc("teacher_check_in", { p_session: sid, p_teacher: eff, p_status: status, p_note: "" });
    if (error) return SM.toast("Lỗi: " + error.message, "err");
    SM.toast(status === "confirmed" ? "✔ Đã xác nhận buổi dạy" : "Đã đánh dấu vắng có phép", "ok");
    loadBoard();
  }
  async function undo(sid) {
    const { error } = await sb.from("teacher_checkins").delete().eq("session_id", sid);
    if (error) return SM.toast("Không hoàn tác được: " + error.message, "err");
    SM.toast("↩ Đã hoàn tác chấm công", "ok"); loadBoard();
  }
  async function qrModal(sid) {
    const s = sessions.find(x => x.id === sid);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:360px;text-align:center;"><div class="mh"><h3>QR check-in</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .3rem;"><b>${SM.esc(cName(s.class_id))}</b><br><span class="muted">${hm(s.start_time)}–${hm(s.end_time)} · ${SM.dmy(s.date)}</span></p>
        <div id="qr-box" style="display:flex;justify-content:center;padding:.8rem;background:#fff;border-radius:10px;min-height:210px;align-items:center;"><span class="spinner"></span></div>
        <p class="muted" style="font-size:.82rem;margin:.6rem 0 0;">Giáo viên đăng nhập tài khoản của mình rồi quét mã để check-in. Chỉ giáo viên phụ trách buổi này mới check-in được.</p>
      </div>
      <div class="mf"><a class="btn ghost" href="${checkinLink(sid)}" target="_blank" rel="noopener">Mở trang check-in</a><button class="btn" data-x="close">Đóng</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    try {
      await ensureQR();
      const boxEl = ov.querySelector("#qr-box"); boxEl.innerHTML = "";
      new QRCode(boxEl, { text: checkinLink(sid), width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    } catch (e) { ov.querySelector("#qr-box").innerHTML = `<span class="muted">${SM.esc(e.message)}</span>`; }
  }

  /* ================= TRANG TỰ CHECK-IN (GV quét QR) ================= */
  async function renderSelfCheckin(el, me, sessionId) {
    ME = me; box = el;
    box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
    if (!sessionId) { box.innerHTML = card("❓", "Thiếu mã buổi học", "Đường dẫn check-in không hợp lệ."); return; }
    const { data: s, error } = await sb.from("sessions").select("id,class_id,date,start_time,end_time,teacher_id,status, klass:classes(name,teacher_id)").eq("id", sessionId).maybeSingle();
    if (error || !s) { box.innerHTML = card("🚫", "Không tìm thấy buổi học", "Buổi học không tồn tại hoặc không thuộc workspace của bạn."); return; }
    const eff = s.teacher_id || (s.klass ? s.klass.teacher_id : null);
    const { data: ck } = await sb.from("teacher_checkins").select("*").eq("session_id", sessionId).maybeSingle();
    const clsName = s.klass ? s.klass.name : "Lớp";
    const info = `<div style="text-align:center;margin:.4rem 0 1rem;">
      <div style="font-size:1.15rem;font-weight:700;">${SM.esc(clsName)}</div>
      <div class="muted">${SM.WEEKDAYS[new Date(s.date + "T00:00:00").getDay()]}, ${SM.dmy(s.date)} · ${hm(s.start_time)}–${hm(s.end_time)}</div></div>`;
    if (ck) {
      box.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding:2rem 1rem;"><div class="auth-card" style="text-align:center;">
        ${info}<div style="font-size:2.4rem;">✅</div>
        <h2 style="margin:.3rem 0;">Đã check-in</h2>
        <p><span class="badge ${STAT[ck.status].c}">${STAT[ck.status].l}</span>${ck.checked_in_at ? " · " + timeHM(ck.checked_in_at) : ""}</p>
        <a class="btn" href="#ops" style="margin-top:1rem;display:inline-block;">Về trang điều hành</a></div></div>`;
      return;
    }
    box.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding:2rem 1rem;"><div class="auth-card" style="text-align:center;">
      ${info}
      <p class="muted" style="margin:.2rem 0 1rem;">Xác nhận bạn có mặt và đang dạy buổi này. Hệ thống ghi lại thời gian thực tế.</p>
      <button class="btn" id="ci-go" style="font-size:1.05rem;padding:.7rem 1.4rem;">✅ Xác nhận có mặt</button>
      <p class="msg" id="ci-msg" style="margin-top:.8rem;"></p>
      <a href="#ops" class="muted" style="display:inline-block;margin-top:.6rem;font-size:.85rem;">Hủy</a></div></div>`;
    box.querySelector("#ci-go").onclick = async () => {
      const btn = box.querySelector("#ci-go"), msg = box.querySelector("#ci-msg");
      btn.disabled = true; msg.textContent = "Đang check-in…"; msg.className = "msg";
      const { data, error } = await sb.rpc("teacher_check_in", { p_session: sessionId, p_note: "" });
      if (error) { btn.disabled = false; msg.textContent = error.message; msg.className = "msg err"; return; }
      renderSelfCheckin(el, me, sessionId);   // vẽ lại → màn hình "Đã check-in"
    };
  }
  const card = (icon, title, sub) => `<div class="card placeholder"><div class="big">${icon}</div><p><b>${SM.esc(title)}</b></p><p class="muted">${SM.esc(sub)}</p></div>`;

  return {
    renderSelfCheckin,
    render(el, me) { ME = me; box = el; st.date = SM.todayISO(); loadBoard(); }
  };
})();

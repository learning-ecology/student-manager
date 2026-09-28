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
  const shiftLink = id => location.origin + location.pathname + "#checkin?shift=" + id;

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
        ${ME && ME.profile.role !== "teacher" ? `<button class="btn" data-shifts style="margin-left:auto;">▦ QR chung theo ca</button>` : ""}
        <div class="field" style="${ME && ME.profile.role !== "teacher" ? "" : "margin-left:auto;"}"><label>Chọn ngày</label><input id="ck-date" value="${SM.dmy(d)}" style="width:140px"></div>
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
    const shBtn = box.querySelector("[data-shifts]"); if (shBtn) shBtn.onclick = shiftManager;
  }

  /* ================= QR CHUNG THEO CA (staff quản lý) ================= */
  function shiftManager() {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:520px;">
      <div class="mh"><h3>QR chung theo ca</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p class="muted" style="font-size:.85rem;margin:.1rem 0 .6rem;">Mỗi ca một mã QR <b>chung</b> cho mọi giáo viên dạy trong ca. GV đăng nhập rồi quét — hệ thống tự tìm buổi dạy của họ trong ca và ghi đúng giờ / đi trễ. Chỉ quét được <b>trong khung giờ ca</b> (chống dùng ảnh chụp ngoài giờ).</p>
        <button class="btn" id="sh-add" style="margin-bottom:.6rem;">➕ Thêm ca</button>
        <div id="sh-list"><span class="spinner"></span></div>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Đóng</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#sh-add").onclick = () => shiftForm(null, () => loadShiftList(ov));
    loadShiftList(ov);
  }

  async function loadShiftList(ov) {
    const wrap = ov.querySelector("#sh-list");
    const { data, error } = await sb.from("shift_timeframes").select("*").order("start_time");
    if (error) { wrap.innerHTML = `<p class="muted"><b>Chưa chạy phaseK-shifts.sql.</b> ${SM.esc(error.message)}</p>`; return; }
    const list = data || [];
    if (!list.length) { wrap.innerHTML = `<p class="muted">Chưa có ca nào. Bấm ➕ Thêm ca (vd Ca sáng 07:30–11:30).</p>`; return; }
    wrap.innerHTML = list.map(s => `<div style="display:flex;align-items:center;gap:.45rem;padding:.5rem 0;border-bottom:1px solid var(--line);flex-wrap:wrap;">
      <span style="flex:1;min-width:140px;"><b>${SM.esc(s.label || "Ca")}</b> <span class="muted">${hm(s.start_time)}–${hm(s.end_time)}</span>${s.active ? "" : ' <span class="badge mute">tắt</span>'}</span>
      <button class="btn" data-shqr="${s.id}" style="padding:.3rem .6rem;">▦ QR</button>
      <button class="btn ghost" data-shedit="${s.id}" style="padding:.3rem .6rem;">Sửa</button>
      <button class="btn ghost" data-shdel="${s.id}" style="padding:.3rem .6rem;color:var(--danger);border-color:var(--danger)">Xóa</button>
    </div>`).join("");
    wrap.querySelectorAll("[data-shqr]").forEach(b => b.onclick = () => qrModalShift(list.find(x => x.id === b.dataset.shqr)));
    wrap.querySelectorAll("[data-shedit]").forEach(b => b.onclick = () => shiftForm(list.find(x => x.id === b.dataset.shedit), () => loadShiftList(ov)));
    wrap.querySelectorAll("[data-shdel]").forEach(b => b.onclick = async () => {
      const s = list.find(x => x.id === b.dataset.shdel);
      const ok = await SM.confirmDialog({ title: "Xóa ca?", danger: true, okText: "Xóa", body: `Xóa ca <b>${SM.esc(s.label || "")}</b>. QR chung của ca này sẽ ngừng hoạt động.` });
      if (!ok) return;
      const { error } = await sb.from("shift_timeframes").delete().eq("id", s.id);
      if (error) return SM.toast("Không xóa được: " + error.message, "err");
      SM.toast("🗑 Đã xóa ca", "ok"); loadShiftList(ov);
    });
  }

  function shiftForm(s, onDone) {
    s = s || {}; const isNew = !s.id; const g = (k, d = "") => s[k] == null ? d : s[k];
    const ov = document.createElement("div"); ov.className = "sm-ov"; ov.style.zIndex = "140";
    ov.innerHTML = `<div class="sm-modal" style="max-width:400px;">
      <div class="mh"><h3>${isNew ? "➕ Thêm ca" : "✏️ Sửa ca"}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <div class="field"><label>Tên ca</label><input id="sf-label" value="${SM.esc(g("label"))}" placeholder="Ca sáng"></div>
        <div class="grid2">
          <div class="field"><label>Bắt đầu</label><input id="sf-start" type="time" value="${hm(g("start_time", "07:30"))}"></div>
          <div class="field"><label>Kết thúc</label><input id="sf-end" type="time" value="${hm(g("end_time", "11:30"))}"></div>
        </div>
        ${isNew ? "" : `<label style="display:flex;align-items:center;gap:.5rem;font-weight:600;"><input type="checkbox" id="sf-active" ${g("active", true) ? "checked" : ""} style="width:auto"> Đang bật</label>`}
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="sf-save">💾 Lưu</button>
        <span class="msg" id="sf-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#sf-save").onclick = async () => {
      const say = (m, e) => { const el = ov.querySelector("#sf-msg"); el.textContent = m; el.className = "msg" + (e ? " err" : ""); };
      const start = ov.querySelector("#sf-start").value, end = ov.querySelector("#sf-end").value;
      if (!start || !end) return say("Chọn giờ bắt đầu/kết thúc.", true);
      if (end <= start) return say("Giờ kết thúc phải sau giờ bắt đầu.", true);
      const row = { label: ov.querySelector("#sf-label").value.trim() || "Ca", start_time: start, end_time: end };
      if (!isNew) row.active = ov.querySelector("#sf-active").checked;
      ov.querySelector("#sf-save").disabled = true;
      const res = isNew ? await sb.from("shift_timeframes").insert(row) : await sb.from("shift_timeframes").update(row).eq("id", s.id);
      if (res.error) { ov.querySelector("#sf-save").disabled = false; return say("Không lưu được: " + res.error.message, true); }
      ov.remove(); SM.toast(isNew ? "✓ Đã thêm ca" : "✓ Đã lưu ca", "ok"); if (onDone) onDone();
    };
  }

  async function qrModalShift(s) {
    const link = shiftLink(s.id);
    const ov = document.createElement("div"); ov.className = "sm-ov"; ov.style.zIndex = "140";
    ov.innerHTML = `<div class="sm-modal" style="max-width:360px;text-align:center;">
      <div class="mh"><h3>QR chung · ${SM.esc(s.label || "Ca")}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .3rem;"><b>${hm(s.start_time)}–${hm(s.end_time)}</b></p>
        <div id="qr-box2" style="display:flex;justify-content:center;padding:.8rem;background:#fff;border-radius:10px;min-height:210px;align-items:center;"><span class="spinner"></span></div>
        <p class="muted" style="font-size:.82rem;margin:.6rem 0 0;">In / hiển thị <b>một mã này</b> cho cả ca. Giáo viên đăng nhập tài khoản rồi quét — hệ thống tự tìm buổi dạy của họ trong ca và ghi đúng giờ / đi trễ.</p>
      </div>
      <div class="mf"><a class="btn ghost" href="${link}" target="_blank" rel="noopener">Mở trang</a><button class="btn" data-x="close">Đóng</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    try { await ensureQR(); const el = ov.querySelector("#qr-box2"); el.innerHTML = ""; new QRCode(el, { text: link, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { ov.querySelector("#qr-box2").innerHTML = `<span class="muted">${SM.esc(e.message)}</span>`; }
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

  /* ========== TRANG TỰ CHECK-IN THEO CA (GV quét QR chung) ========== */
  async function renderSelfShift(el, me, shiftId) {
    ME = me; box = el;
    box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
    if (!shiftId) { box.innerHTML = card("❓", "Thiếu mã ca", "Đường dẫn check-in không hợp lệ."); return; }
    const { data: sh, error } = await sb.from("shift_timeframes").select("*").eq("id", shiftId).maybeSingle();
    if (error || !sh) { box.innerHTML = card("🚫", "Không tìm thấy ca", "Ca làm việc không tồn tại hoặc không thuộc workspace của bạn."); return; }
    const info = `<div style="text-align:center;margin:.4rem 0 1rem;">
      <div style="font-size:1.15rem;font-weight:700;">Ca ${SM.esc(sh.label || "")}</div>
      <div class="muted">${hm(sh.start_time)}–${hm(sh.end_time)} · ${SM.WEEKDAYS[new Date().getDay()]}, ${SM.dmy(SM.todayISO())}</div></div>`;
    box.innerHTML = `<div class="auth-wrap" style="min-height:auto;padding:2rem 1rem;"><div class="auth-card" style="text-align:center;">
      ${info}
      <p class="muted" style="margin:.2rem 0 1rem;">Xác nhận bạn có mặt. Hệ thống tự tìm buổi dạy của bạn trong ca này và ghi lại giờ thực tế.</p>
      <button class="btn" id="cs-go" style="font-size:1.05rem;padding:.7rem 1.4rem;">✅ Xác nhận có mặt</button>
      <p class="msg" id="cs-msg" style="margin-top:.8rem;"></p>
      <a href="#me" class="muted" style="display:inline-block;margin-top:.6rem;font-size:.85rem;">Hủy</a></div></div>`;
    box.querySelector("#cs-go").onclick = async () => {
      const btn = box.querySelector("#cs-go"), msg = box.querySelector("#cs-msg");
      btn.disabled = true; msg.textContent = "Đang check-in…"; msg.className = "msg";
      const { data, error } = await sb.rpc("shift_check_in", { p_shift: shiftId });
      if (error) { btn.disabled = false; msg.textContent = error.message; msg.className = "msg err"; return; }
      if (data) return renderSelfCheckin(el, me, data);   // data = session id → màn hình "Đã check-in"
      msg.textContent = "Đã check-in."; msg.className = "msg";
    };
  }

  return {
    renderSelfCheckin, renderSelfShift,
    render(el, me) { ME = me; box = el; st.date = SM.todayISO(); loadBoard(); }
  };
})();

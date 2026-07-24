/* ============================================================
   Giai đoạn 4 — Lịch học
   Lịch tuần theo lớp (thêm/sửa/xóa · cảnh báo trùng GV/phòng) ·
   sinh buổi học tự động (bỏ ngày lễ) · lịch ngày/tuần/tháng ·
   buổi bù/buổi thêm · hủy buổi · quản lý ngày lễ.
   ============================================================ */
window.Schedule = (function () {
  let ME = null, box = null;
  const st = { tab: "cal", mode: "week", anchor: null, classId: "", teacherId: "" };
  let classes = [], teachers = [], sessions = [], scheds = [], holidays = [], busy = false;

  const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];      // thứ ngắn, theo weekday 0..6
  const WDFULL = SM.WEEKDAYS;                                  // thứ đầy đủ
  const WDORDER = [1, 2, 3, 4, 5, 6, 0];                       // hiển thị Thứ 2 → CN
  const CS = { planned: "Sắp mở", active: "Đang học", completed: "Đã kết thúc" };
  const CB = { planned: "warn", active: "ok", completed: "mute" };
  const TYPE = { regular: "Buổi thường", makeup: "Buổi bù", extra: "Buổi thêm" };
  const SSTAT = { scheduled: "Theo lịch", held: "Đã học", cancelled: "Đã hủy" };

  const cName = id => (classes.find(c => c.id === id) || {}).name || "—";
  const tName = id => id ? ((teachers.find(t => t.id === id) || {}).full_name || "—") : "—";
  const cls = id => classes.find(c => c.id === id) || {};

  // ---- ngày tháng (chuỗi yyyy-mm-dd, tính theo lịch địa phương) ----
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const fromISO = s => new Date(s + "T00:00:00");
  const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const weekStart = s => addDays(s, -((fromISO(s).getDay() + 6) % 7));   // về Thứ 2
  const monthStart = s => s.slice(0, 8) + "01";

  function range() {
    if (st.mode === "day") return [st.anchor, st.anchor];
    if (st.mode === "week") { const a = weekStart(st.anchor); return [a, addDays(a, 6)]; }
    const a = weekStart(monthStart(st.anchor));
    return [a, addDays(a, 41)];                                // 6 tuần phủ kín tháng
  }
  function calLabel() {
    if (st.mode === "day") return WDFULL[fromISO(st.anchor).getDay()] + ", " + SM.dmy(st.anchor);
    if (st.mode === "week") { const a = weekStart(st.anchor); return SM.dmy(a) + " – " + SM.dmy(addDays(a, 6)); }
    return "Tháng " + (+st.anchor.slice(5, 7)) + "/" + st.anchor.slice(0, 4);
  }

  /* ---------------- tải dữ liệu ---------------- */
  async function loadStatic() {
    const [c, t, h] = await Promise.all([
      sb.from("classes").select("id,name,teacher_id,room,online_link,start_date,end_date,status").is("archived_at", null).order("name"),
      sb.from("teachers").select("id,full_name").is("archived_at", null).order("full_name"),
      sb.from("holidays").select("*").order("date")
    ]);
    classes = c.data || []; teachers = t.data || []; holidays = h.data || [];
  }
  async function loadScheds() {
    const { data, error } = await sb.from("class_schedules").select("*").order("weekday").order("start_time");
    if (error) SM.toast("Lỗi tải lịch tuần: " + error.message, "err");
    scheds = error ? [] : (data || []);
  }
  async function loadSessions() {
    busy = true; paint();
    const [a, b] = range();
    let q = sb.from("sessions").select("*").gte("date", a).lte("date", b).order("date").order("start_time");
    if (st.classId) q = q.eq("class_id", st.classId);
    if (st.teacherId) q = q.eq("teacher_id", st.teacherId);
    const { data, error } = await q;
    busy = false;
    if (error) { SM.toast("Lỗi tải buổi học: " + error.message, "err"); sessions = []; }
    else sessions = data || [];
    paint();
  }

  /* ---------------- phát hiện trùng GV / phòng ---------------- */
  function conflictSet() {
    const bad = new Set(), byDate = {};
    sessions.filter(s => s.status !== "cancelled").forEach(s => (byDate[s.date] = byDate[s.date] || []).push(s));
    Object.values(byDate).forEach(list => {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (SM.hm(a.start_time) < SM.hm(b.end_time) && SM.hm(b.start_time) < SM.hm(a.end_time)) {
          if ((a.teacher_id && a.teacher_id === b.teacher_id) || (a.room && a.room === b.room)) { bad.add(a.id); bad.add(b.id); }
        }
      }
    });
    return bad;
  }
  async function sessionConflicts(row, excludeId) {
    const { data } = await sb.from("sessions").select("*").eq("date", row.date).neq("status", "cancelled");
    return (data || []).filter(s => s.id !== excludeId
      && SM.hm(s.start_time) < SM.hm(row.end_time) && SM.hm(row.start_time) < SM.hm(s.end_time)
      && ((row.teacher_id && s.teacher_id === row.teacher_id) || (row.room && s.room === row.room)));
  }

  /* ---------------- khung + vẽ ---------------- */
  function tabsHtml() {
    const T = [["cal", "📅 Lịch"], ["weekly", "🔁 Lịch tuần & sinh buổi"], ["holidays", "🎌 Ngày lễ"]];
    return `<h1 style="margin:.2rem 0 .7rem;">Lịch học</h1>
      <div class="toolbar">${T.map(([k, v]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${v}</button>`).join("")}</div>`;
  }
  function paint() {
    if (st.tab === "weekly") return paintWeekly();
    if (st.tab === "holidays") return paintHolidays();
    paintCal();
  }

  /* ---------------- LỊCH (ngày / tuần / tháng) ---------------- */
  function sessCard(s, confSet) {
    const conf = confSet.has(s.id);
    const type = s.type === "makeup" ? '<span class="badge warn">Bù</span>' : s.type === "extra" ? '<span class="badge mute">Thêm</span>' : "";
    const stat = s.status === "cancelled" ? '<span class="badge bad">Hủy</span>' : s.status === "held" ? '<span class="badge ok">Đã học</span>' : "";
    return `<div class="sess ${s.status}${conf ? " conf" : ""}" data-sess="${s.id}" title="Bấm để sửa buổi này">
      <b>${SM.hm(s.start_time)}–${SM.hm(s.end_time)}</b> ${conf ? "⚠️" : ""} ${type} ${stat}
      <span class="sname">${SM.esc(cName(s.class_id))}</span>
      <span class="muted" style="font-size:.78rem;display:block">${SM.esc(tName(s.teacher_id))}${s.room ? " · " + SM.esc(s.room) : ""}</span>
    </div>`;
  }
  function paintCal() {
    const confs = conflictSet();
    const today = SM.todayISO();
    const hmap = {}; holidays.forEach(h => hmap[h.date] = h.name || "Nghỉ lễ");
    const [a, b] = range();
    const byDate = {}; sessions.forEach(s => (byDate[s.date] = byDate[s.date] || []).push(s));

    let bodyHtml = "";
    if (busy) bodyHtml = `<div class="card placeholder"><span class="spinner"></span></div>`;
    else if (st.mode === "month") {
      const m = st.anchor.slice(0, 7);
      let cells = "";
      for (let d = a, i = 0; i < 42; d = addDays(d, 1), i++) {
        const list = byDate[d] || [];
        cells += `<div class="cal-cell${d.slice(0, 7) !== m ? " out" : ""}${d === today ? " today" : ""}${hmap[d] ? " holiday" : ""}" data-day="${d}">
          <div class="dn">${+d.slice(8)}${hmap[d] ? `<span class="hn">${SM.esc(hmap[d])}</span>` : ""}</div>
          ${list.slice(0, 3).map(s => `<div class="mini ${s.status}">${SM.hm(s.start_time)} ${SM.esc(cName(s.class_id))}${confs.has(s.id) ? " ⚠️" : ""}</div>`).join("")}
          ${list.length > 3 ? `<div class="mini more">+${list.length - 3} buổi nữa</div>` : ""}
        </div>`;
      }
      bodyHtml = `<div class="cal-month">
        ${WDORDER.map(w => `<div class="cal-mhead">${WD[w]}</div>`).join("")}${cells}</div>
        <p class="muted" style="font-size:.82rem;margin:.5rem 0 0;">Bấm vào một ngày để xem chi tiết.</p>`;
    } else {
      const days = [];
      for (let d = a; d <= b; d = addDays(d, 1)) days.push(d);
      bodyHtml = `<div class="cal-grid" style="${st.mode === "day" ? "grid-template-columns:1fr;max-width:560px;" : ""}">
        ${days.map(d => {
          const list = byDate[d] || [];
          return `<div class="cal-col">
            <div class="dh${d === today ? " today" : ""}${hmap[d] ? " holiday" : ""}">
              <b>${WD[fromISO(d).getDay()]}</b> ${SM.dmy(d).slice(0, 5)}${hmap[d] ? `<span class="badge bad" style="margin-left:.3rem">${SM.esc(hmap[d])}</span>` : ""}
            </div>
            ${list.map(s => sessCard(s, confs)).join("") || `<p class="muted" style="font-size:.8rem;text-align:center;padding:.5rem 0;margin:0;">—</p>`}
          </div>`;
        }).join("")}
      </div>`;
    }

    box.innerHTML = tabsHtml() + `
      <div class="cal-head">
        <div class="row-actions">
          ${["day", "week", "month"].map(m => `<button class="btn ${st.mode === m ? "" : "ghost"}" data-mode="${m}">${{ day: "Ngày", week: "Tuần", month: "Tháng" }[m]}</button>`).join("")}
        </div>
        <div class="row-actions">
          <button class="btn ghost" data-nav="prev">‹</button>
          <button class="btn ghost" data-nav="today">Hôm nay</button>
          <button class="btn ghost" data-nav="next">›</button>
        </div>
        <b style="font-family:var(--serif);font-size:1.05rem;">${calLabel()}</b>
        <span style="flex:1"></span>
        <button class="btn" data-act="addsess">➕ Buổi bù / buổi thêm</button>
      </div>
      <div class="toolbar">
        <div class="field"><label>Lớp</label><select id="f-class"><option value="">Tất cả lớp</option>
          ${classes.map(c => `<option value="${c.id}" ${st.classId === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Giáo viên</label><select id="f-teacher"><option value="">Tất cả GV</option>
          ${teachers.map(t => `<option value="${t.id}" ${st.teacherId === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("")}</select></div>
        <span class="muted" style="align-self:center;font-size:.82rem;">⚠️ = trùng giáo viên hoặc phòng</span>
      </div>
      ${bodyHtml}`;
    const fc = box.querySelector("#f-class"), ft = box.querySelector("#f-teacher");
    if (fc) fc.addEventListener("change", () => { st.classId = fc.value; loadSessions(); });
    if (ft) ft.addEventListener("change", () => { st.teacherId = ft.value; loadSessions(); });
  }

  /* ---------------- form buổi học (sửa / thêm bù) ---------------- */
  function sessForm(s) {
    const isNew = !s;
    s = s || {};
    const defClass = st.classId || (classes[0] || {}).id || "";
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh">
        <h3>${isNew ? "➕ Buổi bù / buổi thêm" : "✏️ Buổi " + SM.dmy(s.date) + " · " + SM.esc(cName(s.class_id))}</h3>
        <button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field" style="grid-column:1/-1"><label>Lớp *</label>
          <select id="x-class" ${isNew ? "" : "disabled"}>
            ${classes.map(c => `<option value="${c.id}" ${(s.class_id || defClass) === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}
          </select></div>
        <div class="field"><label>Ngày (DD/MM/YYYY) *</label><input id="x-date" value="${SM.dmy(s.date || st.anchor)}"></div>
        <div class="field"><label>Loại buổi</label><select id="x-type">
          ${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${(s.type || (isNew ? "makeup" : "regular")) === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Bắt đầu *</label><input id="x-start" type="time" value="${SM.hm(s.start_time) || "18:00"}"></div>
        <div class="field"><label>Kết thúc *</label><input id="x-end" type="time" value="${SM.hm(s.end_time) || "19:30"}"></div>
        <div class="field"><label>Giáo viên</label><select id="x-teacher"><option value="">— GV của lớp —</option>
          ${teachers.map(t => `<option value="${t.id}" ${s.teacher_id === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("")}</select></div>
        <div class="field"><label>Phòng</label><input id="x-room" value="${SM.esc(s.room || "")}"></div>
        ${isNew ? "" : `<div class="field"><label>Trạng thái</label><select id="x-status">
          ${Object.entries(SSTAT).map(([k, v]) => `<option value="${k}" ${(s.status || "scheduled") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>`}
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input id="x-note" value="${SM.esc(s.note || "")}" placeholder="vd: bù cho buổi nghỉ lễ 02/09"></div>
      </div>
      ${isNew ? `<p class="muted" style="font-size:.85rem;">Buổi thường của lịch tuần được tạo bằng nút ⚡ Sinh buổi học (thẻ Lịch tuần).</p>` : ""}</div>
      <div class="mf">
        ${isNew ? "" : `<button class="btn ghost" id="x-del" style="color:var(--danger);border-color:var(--danger);margin-right:auto;">🗑 Xóa buổi</button>`}
        <button class="btn ghost" data-x="close">Hủy</button>
        <button class="btn" id="x-save">💾 Lưu</button>
        <span class="msg" id="x-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    const V = id => ov.querySelector("#" + id) ? ov.querySelector("#" + id).value : "";
    const say = (t, e) => { const m = ov.querySelector("#x-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };

    ov.querySelector("#x-save").addEventListener("click", async () => {
      const classId = V("x-class");
      const date = SM.parseDmy(V("x-date").trim());
      if (!classId) return say("Chọn lớp.", true);
      if (!date) return say("Ngày không hợp lệ (DD/MM/YYYY).", true);
      const t1 = V("x-start"), t2 = V("x-end");
      if (!t1 || !t2 || t2 <= t1) return say("Giờ kết thúc phải sau giờ bắt đầu.", true);
      const row = {
        class_id: classId, date, start_time: t1, end_time: t2,
        teacher_id: V("x-teacher") || cls(classId).teacher_id || null,
        room: V("x-room").trim(), type: V("x-type"), note: V("x-note").trim()
      };
      if (!isNew) row.status = V("x-status");
      const btn = ov.querySelector("#x-save"); btn.disabled = true;
      // cảnh báo trùng GV/phòng trước khi lưu (được phép lưu tiếp nếu đồng ý)
      if (isNew || row.status !== "cancelled") {
        const confl = await sessionConflicts(row, s.id);
        if (confl.length) {
          const ok = await SM.confirmDialog({
            title: "⚠️ Trùng lịch", okText: "Vẫn lưu", danger: true,
            body: "Trùng giáo viên hoặc phòng với:<br>" + confl.map(x =>
              `• ${SM.esc(cName(x.class_id))} ${SM.hm(x.start_time)}–${SM.hm(x.end_time)} (${SM.esc(tName(x.teacher_id))}${x.room ? " · " + SM.esc(x.room) : ""})`).join("<br>")
          });
          if (!ok) { btn.disabled = false; return; }
        }
      }
      let error;
      if (isNew) ({ error } = await sb.from("sessions").insert(row));
      else ({ error } = await sb.from("sessions").update(row).eq("id", s.id));
      btn.disabled = false;
      if (error) return say("Không lưu được: " + error.message, true);
      ov.remove(); SM.toast("✓ Đã lưu buổi học", "ok"); loadSessions();
    });

    const del = ov.querySelector("#x-del");
    if (del) del.addEventListener("click", async () => {
      const ok = await SM.confirmDialog({
        title: "Xóa buổi học?", danger: true, okText: "Xóa",
        body: `Xóa hẳn buổi ${SM.dmy(s.date)} của lớp <b>${SM.esc(cName(s.class_id))}</b>. Điểm danh của buổi này (nếu có) cũng bị xóa. Nếu chỉ muốn nghỉ buổi này, hãy chọn trạng thái <b>Đã hủy</b> thay vì xóa.`
      });
      if (!ok) return;
      const { error } = await sb.from("sessions").delete().eq("id", s.id);
      if (error) return say("Không xóa được: " + error.message, true);
      ov.remove(); SM.toast("🗑 Đã xóa buổi học", "ok"); loadSessions();
    });
  }

  /* ---------------- LỊCH TUẦN & SINH BUỔI ---------------- */
  function paintWeekly() {
    const list = classes.filter(c => !st.classId || c.id === st.classId);
    box.innerHTML = tabsHtml() + `
      <p class="muted" style="margin:.2rem 0 .9rem;">Đặt lịch lặp hằng tuần cho từng lớp, sau đó bấm <b>⚡ Sinh buổi học</b> để tạo các buổi cụ thể trên lịch (tự bỏ qua ngày lễ).</p>
      ${list.length ? list.map(c => {
        const slots = scheds.filter(s => s.class_id === c.id);
        return `<div class="card" style="padding:1rem 1.2rem;margin-bottom:.9rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">
            <h3 style="margin:.1rem 0;font-size:1.05rem;font-family:var(--serif);">${SM.esc(c.name)}
              <span class="badge ${CB[c.status] || "mute"}">${CS[c.status] || c.status}</span></h3>
            <div class="row-actions">
              <button class="btn ghost" data-slot-add="${c.id}">➕ Thêm lịch tuần</button>
              <button class="btn" data-gen="${c.id}" ${slots.length ? "" : 'disabled title="Thêm lịch tuần trước"'}>⚡ Sinh buổi học</button>
            </div></div>
          <p class="muted" style="margin:.2rem 0 .6rem;font-size:.85rem;">GV ${SM.esc(tName(c.teacher_id))}${c.room ? " · phòng " + SM.esc(c.room) : ""}${c.start_date ? " · từ " + SM.dmy(c.start_date) : ""}${c.end_date ? " đến " + SM.dmy(c.end_date) : ""}</p>
          ${slots.length ? `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
              <th>Thứ</th><th>Giờ</th><th>Giáo viên</th><th>Phòng</th><th>Hiệu lực</th><th></th></tr></thead><tbody>
            ${slots.map(s => `<tr>
              <td data-th="Thứ"><b>${WDFULL[s.weekday]}</b></td>
              <td data-th="Giờ">${SM.hm(s.start_time)}–${SM.hm(s.end_time)}</td>
              <td data-th="Giáo viên">${s.teacher_id ? SM.esc(tName(s.teacher_id)) : '<span class="muted">GV của lớp</span>'}</td>
              <td data-th="Phòng">${s.room ? SM.esc(s.room) : '<span class="muted">phòng của lớp</span>'}</td>
              <td data-th="Hiệu lực">${SM.dmy(s.effective_from)}${s.effective_to ? " → " + SM.dmy(s.effective_to) : " →"}</td>
              <td class="cell-actions"><div class="row-actions">
                <button class="btn ghost" data-slot-edit="${s.id}">Sửa</button>
                <button class="btn ghost" data-slot-del="${s.id}" style="color:var(--danger);border-color:var(--danger)">Xóa</button>
              </div></td></tr>`).join("")}
          </tbody></table></div>`
          : `<p class="muted" style="margin:.3rem 0;">Chưa có lịch tuần — bấm ➕ Thêm lịch tuần (vd Thứ 2 &amp; Thứ 4, 18:00–19:30 thì thêm 2 dòng).</p>`}
        </div>`;
      }).join("") : `<div class="card placeholder"><div class="big">🏫</div><p>Chưa có lớp nào. Tạo lớp ở mục Lớp học trước.</p></div>`}`;
  }

  function slotForm(classId, s) {
    const isNew = !s; s = s || {};
    const c = cls(classId);
    const defFrom = s.effective_from || (c.start_date && c.start_date > SM.todayISO() ? c.start_date : SM.todayISO());
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh">
        <h3>${isNew ? "➕ Thêm lịch tuần" : "✏️ Sửa lịch tuần"} · ${SM.esc(c.name)}</h3>
        <button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field"><label>Thứ *</label><select id="w-day">
          ${WDORDER.map(w => `<option value="${w}" ${(s.weekday == null ? 1 : s.weekday) === w ? "selected" : ""}>${WDFULL[w]}</option>`).join("")}</select></div>
        <div class="field"><label>&nbsp;</label><span class="muted" style="font-size:.85rem;">Học 2 buổi/tuần → tạo 2 dòng lịch.</span></div>
        <div class="field"><label>Bắt đầu *</label><input id="w-start" type="time" value="${SM.hm(s.start_time) || "18:00"}"></div>
        <div class="field"><label>Kết thúc *</label><input id="w-end" type="time" value="${SM.hm(s.end_time) || "19:30"}"></div>
        <div class="field"><label>Giáo viên buổi này</label><select id="w-teacher"><option value="">— GV của lớp (${SM.esc(tName(c.teacher_id))}) —</option>
          ${teachers.map(t => `<option value="${t.id}" ${s.teacher_id === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("")}</select></div>
        <div class="field"><label>Phòng riêng</label><input id="w-room" value="${SM.esc(s.room || "")}" placeholder="${SM.esc(c.room || "dùng phòng của lớp")}"></div>
        <div class="field"><label>Hiệu lực từ (DD/MM/YYYY) *</label><input id="w-from" value="${SM.dmy(defFrom)}"></div>
        <div class="field"><label>Hiệu lực đến (bỏ trống = mãi)</label><input id="w-to" value="${s.effective_to ? SM.dmy(s.effective_to) : ""}"></div>
      </div>
      <p class="muted" style="font-size:.85rem;">Sau khi lưu, bấm <b>⚡ Sinh buổi học</b> để tạo các buổi trên lịch. Buổi đã sinh trước đó không tự thay đổi.</p></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button>
        <button class="btn" id="w-save">💾 Lưu</button>
        <span class="msg" id="w-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    ov.querySelector("#w-save").addEventListener("click", async () => {
      const V = id => ov.querySelector("#" + id).value;
      const say = (t, e) => { const m = ov.querySelector("#w-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const weekday = +V("w-day");
      const t1 = V("w-start"), t2 = V("w-end");
      if (!t1 || !t2 || t2 <= t1) return say("Giờ kết thúc phải sau giờ bắt đầu.", true);
      const from = SM.parseDmy(V("w-from").trim());
      if (!from) return say("Ngày hiệu lực không hợp lệ.", true);
      const toRaw = V("w-to").trim();
      const to = toRaw ? SM.parseDmy(toRaw) : null;
      if (toRaw && !to) return say("Ngày kết thúc hiệu lực không hợp lệ.", true);
      if (to && to < from) return say("Hiệu lực đến phải sau hiệu lực từ.", true);
      const row = {
        class_id: classId, weekday, start_time: t1, end_time: t2,
        teacher_id: V("w-teacher") || null, room: V("w-room").trim(),
        effective_from: from, effective_to: to
      };
      // cảnh báo trùng với lịch tuần của các lớp khác (so GV/phòng thực tế sẽ dùng)
      const effT = x => x.teacher_id || cls(x.class_id).teacher_id;
      const effR = x => x.room || cls(x.class_id).room || "";
      const overlap = (a1, a2, b1, b2) => a1 <= (b2 || "9999-12-31") && b1 <= (a2 || "9999-12-31");
      const confl = scheds.filter(x => x.id !== s.id && x.weekday === weekday
        && SM.hm(x.start_time) < t2 && t1 < SM.hm(x.end_time)
        && overlap(x.effective_from, x.effective_to, from, to)
        && ((effT(row) && effT(x) === effT(row)) || (effR(row) && effR(x) === effR(row))));
      const btn = ov.querySelector("#w-save"); btn.disabled = true;
      if (confl.length) {
        const ok = await SM.confirmDialog({
          title: "⚠️ Trùng lịch tuần", okText: "Vẫn lưu", danger: true,
          body: "Trùng giáo viên hoặc phòng với:<br>" + confl.map(x =>
            `• ${SM.esc(cName(x.class_id))} — ${WDFULL[x.weekday]} ${SM.hm(x.start_time)}–${SM.hm(x.end_time)}`).join("<br>")
        });
        if (!ok) { btn.disabled = false; return; }
      }
      let error;
      if (isNew) ({ error } = await sb.from("class_schedules").insert(row));
      else ({ error } = await sb.from("class_schedules").update(row).eq("id", s.id));
      btn.disabled = false;
      if (error) return say("Không lưu được: " + error.message, true);
      ov.remove(); SM.toast("✓ Đã lưu lịch tuần", "ok");
      await loadScheds(); paint();
    });
  }

  async function deleteSlot(id) {
    const s = scheds.find(x => x.id === id); if (!s) return;
    const ok = await SM.confirmDialog({
      title: "Xóa lịch tuần?", danger: true, okText: "Xóa",
      body: `Xóa lịch <b>${WDFULL[s.weekday]} ${SM.hm(s.start_time)}–${SM.hm(s.end_time)}</b> của lớp <b>${SM.esc(cName(s.class_id))}</b>. Các buổi đã sinh <b>vẫn giữ nguyên</b> — hủy/xóa từng buổi trong thẻ 📅 Lịch nếu cần.`
    });
    if (!ok) return;
    const { error } = await sb.from("class_schedules").delete().eq("id", id);
    if (error) return SM.toast("Không xóa được: " + error.message, "err");
    SM.toast("🗑 Đã xóa lịch tuần", "ok");
    await loadScheds(); paint();
  }

  function genForm(classId) {
    const c = cls(classId);
    const today = SM.todayISO();
    const d = fromISO(monthStart(today)); d.setMonth(d.getMonth() + 2); d.setDate(0);   // hết tháng sau
    const defTo = c.end_date && c.end_date < iso(d) ? c.end_date : iso(d);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:480px;"><div class="mh">
        <h3>⚡ Sinh buổi học · ${SM.esc(c.name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <div class="grid2">
          <div class="field"><label>Từ ngày (DD/MM/YYYY)</label><input id="g-from" value="${SM.dmy(c.start_date && c.start_date > today ? c.start_date : today)}"></div>
          <div class="field"><label>Đến ngày (DD/MM/YYYY)</label><input id="g-to" value="${SM.dmy(defTo)}"></div>
        </div>
        <p class="muted" style="font-size:.85rem;">Tạo các buổi theo lịch tuần trong khoảng ngày này. Tự bỏ qua <b>ngày lễ</b> và ngoài thời gian của lớp. Buổi đã có sẽ không tạo trùng — chạy lại bao nhiêu lần cũng an toàn.</p>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button>
        <button class="btn" id="g-go">⚡ Sinh buổi</button>
        <span class="msg" id="g-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#g-go").addEventListener("click", async () => {
      const say = (t, e) => { const m = ov.querySelector("#g-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const from = SM.parseDmy(ov.querySelector("#g-from").value.trim());
      const to = SM.parseDmy(ov.querySelector("#g-to").value.trim());
      if (!from || !to) return say("Ngày không hợp lệ (DD/MM/YYYY).", true);
      if (to < from) return say("Đến ngày phải sau Từ ngày.", true);
      const btn = ov.querySelector("#g-go"); btn.disabled = true; say("Đang sinh buổi…");
      const { data, error } = await sb.rpc("generate_sessions", { p_class: classId, p_from: from, p_to: to });
      btn.disabled = false;
      if (error) return say("Lỗi: " + error.message + (error.message.includes("generate_sessions") ? " — bạn đã chạy phase4.sql trên Supabase chưa?" : ""), true);
      ov.remove();
      SM.toast(data > 0 ? `✓ Đã tạo ${data} buổi học mới` : "Không có buổi mới (đã sinh đủ hoặc trùng ngày lễ)", "ok");
      st.tab = "cal"; loadSessions();
    });
  }

  /* ---------------- NGÀY LỄ ---------------- */
  function paintHolidays() {
    const today = SM.todayISO();
    box.innerHTML = tabsHtml() + `
      <div class="card" style="padding:1rem 1.2rem;max-width:640px;">
        <h3 style="margin:.1rem 0 .5rem;font-size:1.05rem;font-family:var(--serif);">Thêm ngày lễ / ngày nghỉ</h3>
        <p class="muted" style="margin:.1rem 0 .7rem;font-size:.85rem;">Ngày lễ được <b>tự động bỏ qua</b> khi sinh buổi học.</p>
        <div class="toolbar">
          <div class="field"><label>Ngày (DD/MM/YYYY)</label><input id="h-date" placeholder="02/09/${today.slice(0, 4)}"></div>
          <div class="field" style="flex:1;min-width:180px;"><label>Tên</label><input id="h-name" placeholder="Quốc khánh"></div>
          <div class="field"><label>&nbsp;</label><button class="btn" id="h-add">➕ Thêm</button></div>
        </div>
        <p class="msg" id="h-msg"></p>
        ${holidays.length ? `<div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Ngày</th><th>Thứ</th><th>Tên</th><th></th></tr></thead><tbody>
          ${holidays.map(h => `<tr ${h.date < today ? 'style="opacity:.55"' : ""}>
            <td data-th="Ngày"><b>${SM.dmy(h.date)}</b></td>
            <td data-th="Thứ">${WDFULL[fromISO(h.date).getDay()]}</td>
            <td data-th="Tên">${SM.esc(h.name || "")}</td>
            <td class="cell-actions"><div class="row-actions">
              <button class="btn ghost" data-hol-del="${h.id}" style="color:var(--danger);border-color:var(--danger)">Xóa</button>
            </div></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">Chưa có ngày lễ nào.</p>`}
      </div>`;
    const btn = box.querySelector("#h-add");
    if (btn) btn.addEventListener("click", async () => {
      const m = box.querySelector("#h-msg");
      const say = (t, e) => { m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const date = SM.parseDmy(box.querySelector("#h-date").value.trim());
      if (!date) return say("Ngày không hợp lệ (DD/MM/YYYY).", true);
      const name = box.querySelector("#h-name").value.trim();
      btn.disabled = true;
      const { error } = await sb.from("holidays").insert({ date, name });
      btn.disabled = false;
      if (error) return say(error.code === "23505" ? "Ngày này đã có trong danh sách." : "Lỗi: " + error.message, true);
      SM.toast("✓ Đã thêm ngày lễ", "ok");
      // nếu đã lỡ sinh buổi vào ngày này thì đề nghị hủy các buổi đó
      const { data: hit } = await sb.from("sessions").select("id").eq("date", date).eq("status", "scheduled");
      if (hit && hit.length) {
        const ok = await SM.confirmDialog({
          title: "Hủy buổi trùng ngày lễ?", okText: "Hủy " + hit.length + " buổi", danger: true,
          body: `Có <b>${hit.length} buổi học</b> đã được sinh vào ${SM.dmy(date)}. Chuyển các buổi này sang trạng thái <b>Đã hủy</b>?`
        });
        if (ok) {
          const { error: e2 } = await sb.from("sessions").update({ status: "cancelled", note: "Nghỉ lễ" + (name ? ": " + name : "") }).eq("date", date).eq("status", "scheduled");
          if (e2) SM.toast("Lỗi hủy buổi: " + e2.message, "err"); else SM.toast("✓ Đã hủy " + hit.length + " buổi", "ok");
        }
      }
      await loadStatic(); paint();
    });
  }

  async function deleteHoliday(id) {
    const h = holidays.find(x => x.id === id); if (!h) return;
    const ok = await SM.confirmDialog({
      title: "Xóa ngày lễ?", danger: true, okText: "Xóa",
      body: `Bỏ <b>${SM.dmy(h.date)}${h.name ? " · " + SM.esc(h.name) : ""}</b> khỏi danh sách. Buổi học đã hủy trước đó (nếu có) không tự khôi phục.`
    });
    if (!ok) return;
    const { error } = await sb.from("holidays").delete().eq("id", id);
    if (error) return SM.toast("Không xóa được: " + error.message, "err");
    SM.toast("🗑 Đã xóa ngày lễ", "ok");
    await loadStatic(); paint();
  }

  /* ---------------- điều khiển chung ---------------- */
  function onClick(e) {
    const b = e.target.closest("[data-tab],[data-mode],[data-nav],[data-day],[data-sess],[data-act],[data-slot-add],[data-slot-edit],[data-slot-del],[data-gen],[data-hol-del]");
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; return st.tab === "cal" ? loadSessions() : paint(); }
    if (b.dataset.mode) { st.mode = b.dataset.mode; return loadSessions(); }
    if (b.dataset.nav) {
      if (b.dataset.nav === "today") st.anchor = SM.todayISO();
      else {
        const dir = b.dataset.nav === "next" ? 1 : -1;
        if (st.mode === "day") st.anchor = addDays(st.anchor, dir);
        else if (st.mode === "week") st.anchor = addDays(st.anchor, 7 * dir);
        else { const d = fromISO(monthStart(st.anchor)); d.setMonth(d.getMonth() + dir); st.anchor = iso(d); }
      }
      return loadSessions();
    }
    if (b.dataset.day) { st.mode = "day"; st.anchor = b.dataset.day; return loadSessions(); }
    if (b.dataset.sess) { const s = sessions.find(x => x.id === b.dataset.sess); return s && sessForm(s); }
    if (b.dataset.act === "addsess") return sessForm(null);
    if (b.dataset.slotAdd) return slotForm(b.dataset.slotAdd, null);
    if (b.dataset.slotEdit) { const s = scheds.find(x => x.id === b.dataset.slotEdit); return s && slotForm(s.class_id, s); }
    if (b.dataset.slotDel) return deleteSlot(b.dataset.slotDel);
    if (b.dataset.gen) return genForm(b.dataset.gen);
    if (b.dataset.holDel) return deleteHoliday(b.dataset.holDel);
  }

  return {
    async render(el, me) {
      ME = me; box = el;
      if (!st.anchor) st.anchor = SM.todayISO();
      box.onclick = onClick;                       // thay handler cũ, không bị chồng
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      await loadStatic();
      await loadScheds();
      loadSessions();
    }
  };
})();

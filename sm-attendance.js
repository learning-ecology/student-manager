/* ============================================================
   Giai đoạn 5 — Điểm danh
   Điểm danh nhanh theo buổi (mặc định "có mặt") · ghi/sửa từng buổi ·
   lịch sử theo lớp · tỉ lệ chuyên cần của từng học viên.
   Nguồn "ai học buổi này" = ghi danh còn hiệu lực ĐÚNG NGÀY buổi đó
   (joined_on ≤ ngày ≤ left_on) — nên học viên cũ vẫn hiện đúng ở buổi cũ.
   ============================================================ */
window.Attendance = (function () {
  let ME = null, box = null;
  const st = { tab: "mark", date: null, classId: "", histClass: "" };
  let classes = [], teachers = [], busy = false;
  // dữ liệu tab điểm danh (theo ngày)
  let daySessions = [], dayEnroll = {}, dayAtt = {};
  // màn hình đánh dấu 1 buổi
  let cur = null, curStudents = [], markState = {}, markNote = {}, markDirty = false;

  // trạng thái điểm danh — thứ tự nút bấm khi điểm danh nhanh
  const STAT = {
    present:              { label: "Có mặt",  cls: "ok"   },
    late:                 { label: "Muộn",    cls: "warn" },
    left_early:           { label: "Về sớm",  cls: "warn" },
    authorised_absence:   { label: "Vắng CP", cls: "mute" },
    unauthorised_absence: { label: "Vắng KP", cls: "bad"  }
  };
  const STAT_ALL = Object.assign({}, STAT, { makeup: { label: "Học bù", cls: "mute" }, cancelled: { label: "Hủy", cls: "mute" } });
  const ATTENDED = new Set(["present", "late", "left_early", "makeup"]);   // tính là "có đi học"
  const ABSENT = new Set(["authorised_absence", "unauthorised_absence"]);   // tính vào mẫu số tỉ lệ

  const CS = { planned: "Sắp mở", active: "Đang học", completed: "Đã kết thúc" };
  const cName = id => (classes.find(c => c.id === id) || {}).name || "—";
  const tName = id => id ? ((teachers.find(t => t.id === id) || {}).full_name || "—") : "—";
  const cls = id => classes.find(c => c.id === id) || {};
  const initials = n => (String(n || "?").trim().split(/\s+/).slice(-1)[0][0] || "?").toUpperCase();

  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const fromISO = s => new Date(s + "T00:00:00");
  const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const enrolledOn = (e, date) => e.joined_on <= date && (!e.left_on || e.left_on >= date);

  /* ---------------- tải nền ---------------- */
  async function loadStatic() {
    const [c, t] = await Promise.all([
      SM.refClasses(), SM.refTeachers()
    ]);
    classes = c; teachers = t;
  }

  /* ================= TAB 1 — ĐIỂM DANH THEO NGÀY ================= */
  async function loadDay() {
    busy = true; if (st.tab === "mark" && !cur) paintDay();
    let q = sb.from("sessions").select("*").eq("date", st.date).order("start_time");
    if (st.classId) q = q.eq("class_id", st.classId);
    const { data: sess, error } = await q;
    daySessions = error ? [] : (sess || []);
    // ghi danh của các lớp có buổi hôm đó
    // ghi danh (các lớp có buổi hôm đó) + điểm danh đã ghi — chạy SONG SONG
    const classIds = [...new Set(daySessions.map(s => s.class_id))];
    const sessIds = daySessions.map(s => s.id);
    const [enR, atR] = await Promise.all([
      classIds.length ? sb.from("enrollments").select("class_id,student_id,joined_on,left_on").in("class_id", classIds) : Promise.resolve({ data: [] }),
      sessIds.length ? sb.from("attendance").select("session_id,status").in("session_id", sessIds) : Promise.resolve({ data: [] })
    ]);
    dayEnroll = {}; (enR.data || []).forEach(e => { (dayEnroll[e.class_id] = dayEnroll[e.class_id] || []).push(e); });
    dayAtt = {}; (atR.data || []).forEach(a => {
      const b = dayAtt[a.session_id] = dayAtt[a.session_id] || { recorded: 0, present: 0 };
      b.recorded++; if (ATTENDED.has(a.status)) b.present++;
    });
    busy = false;
    if (st.tab === "mark" && !cur) paintDay();
  }

  function expectedCount(session) {
    return (dayEnroll[session.class_id] || []).filter(e => enrolledOn(e, session.date)).length;
  }

  function tabsHtml() {
    const T = [["mark", "✅ Điểm danh"], ["history", "📊 Lịch sử & chuyên cần"]];
    return `<h1 style="margin:.2rem 0 .7rem;">Điểm danh</h1>
      <div class="toolbar">${T.map(([k, v]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${v}</button>`).join("")}</div>`;
  }

  function paintDay() {
    const today = SM.todayISO();
    let list = "";
    if (busy) list = `<div class="card placeholder"><span class="spinner"></span></div>`;
    else if (!daySessions.length) list = `<div class="card placeholder"><div class="big">🗓️</div>
        <p>Không có buổi học nào ${st.classId ? "của lớp này " : ""}vào ${SM.dmy(st.date)}.</p>
        <p class="muted">Buổi học được tạo ở mục 🗓️ Lịch học → “Lịch tuần &amp; sinh buổi”.</p></div>`;
    else list = daySessions.map(s => {
      const exp = expectedCount(s);
      const rec = dayAtt[s.id];
      const done = rec && rec.recorded > 0;
      const cancelled = s.status === "cancelled";
      const badge = cancelled ? `<span class="badge bad">Đã hủy</span>`
        : done ? `<span class="badge ok">Đã điểm danh ${rec.present}/${rec.recorded} có mặt</span>`
        : `<span class="badge warn">Chưa điểm danh</span>`;
      return `<div class="card" style="padding:.8rem 1rem;margin-bottom:.6rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
        <div style="min-width:88px;"><b style="font-size:1.05rem;">${SM.hm(s.start_time)}</b><br>
          <span class="muted" style="font-size:.8rem;">${SM.hm(s.start_time)}–${SM.hm(s.end_time)}</span></div>
        <div style="flex:1;min-width:180px;">
          <b>${SM.esc(cName(s.class_id))}</b> ${s.type !== "regular" ? `<span class="badge mute">${s.type === "makeup" ? "Bù" : "Thêm"}</span>` : ""}<br>
          <span class="muted" style="font-size:.82rem;">GV ${SM.esc(tName(s.teacher_id))}${s.room ? " · " + SM.esc(s.room) : ""} · sĩ số ${exp}</span></div>
        <div>${badge}</div>
        <div>${cancelled ? "" : `<button class="btn" data-mark="${s.id}">${done ? "✏️ Sửa điểm danh" : "✅ Điểm danh"}</button>`}</div>
      </div>`;
    }).join("");

    box.innerHTML = tabsHtml() + `
      <div class="cal-head">
        <div class="row-actions">
          <button class="btn ghost" data-nav="prev">‹ Hôm trước</button>
          <button class="btn ghost" data-nav="today">Hôm nay</button>
          <button class="btn ghost" data-nav="next">Hôm sau ›</button>
        </div>
        <div class="field" style="margin:0;"><input id="d-date" value="${SM.dmy(st.date)}" style="width:130px;text-align:center;"></div>
        <b style="font-family:var(--serif);font-size:1.05rem;">${SM.WEEKDAYS[fromISO(st.date).getDay()]}${st.date === today ? " · Hôm nay" : ""}</b>
        <span style="flex:1"></span>
        <div class="field" style="margin:0;"><select id="d-class"><option value="">Tất cả lớp</option>
          ${classes.map(c => `<option value="${c.id}" ${st.classId === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}</select></div>
      </div>
      ${list}`;

    const de = box.querySelector("#d-date");
    if (de) de.addEventListener("change", () => { const v = SM.parseDmy(de.value.trim()); if (v) { st.date = v; loadDay(); } else { SM.toast("Ngày không hợp lệ (DD/MM/YYYY)", "err"); de.value = SM.dmy(st.date); } });
    const dc = box.querySelector("#d-class");
    if (dc) dc.addEventListener("change", () => { st.classId = dc.value; loadDay(); });
  }

  /* ================= MÀN HÌNH ĐÁNH DẤU 1 BUỔI ================= */
  async function openMark(sessionId) {
    cur = daySessions.find(s => s.id === sessionId);
    if (!cur) return;
    box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
    // học viên có ghi danh hiệu lực đúng ngày buổi
    const { data: en } = await sb.from("enrollments")
      .select("joined_on,left_on,student:students(id,code,full_name,photo_url)")
      .eq("class_id", cur.class_id);
    curStudents = (en || []).filter(e => enrolledOn(e, cur.date) && e.student).map(e => e.student)
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi"));
    // điểm danh đã lưu
    const { data: at } = await sb.from("attendance").select("student_id,status,note").eq("session_id", cur.id);
    const saved = {}; (at || []).forEach(a => saved[a.student_id] = a);
    markState = {}; markNote = {};
    curStudents.forEach(s => { markState[s.id] = saved[s.id] ? saved[s.id].status : "present"; markNote[s.id] = saved[s.id] ? (saved[s.id].note || "") : ""; });
    markDirty = false;
    paintMark(!!at && at.length > 0);
  }

  function markSummary() {
    const c = { present: 0, absent: 0, other: 0 };
    curStudents.forEach(s => {
      const v = markState[s.id];
      if (ATTENDED.has(v)) c.present++; else if (ABSENT.has(v)) c.absent++; else c.other++;
    });
    return c;
  }

  function paintMark(wasRecorded) {
    const sm = markSummary();
    box.innerHTML = `
      <div class="toolbar" style="justify-content:space-between;">
        <button class="btn ghost" data-act="back">← Danh sách buổi</button>
        <button class="btn ghost" data-act="allpresent">✓ Tất cả có mặt</button>
      </div>
      <h1 style="margin:.1rem 0 .2rem;">Điểm danh · ${SM.esc(cName(cur.class_id))}</h1>
      <p class="muted" style="margin:.1rem 0 .3rem;">${SM.WEEKDAYS[fromISO(cur.date).getDay()]} ${SM.dmy(cur.date)} · ${SM.hm(cur.start_time)}–${SM.hm(cur.end_time)} · GV ${SM.esc(tName(cur.teacher_id))}${cur.room ? " · " + SM.esc(cur.room) : ""}
        ${wasRecorded ? '· <span class="badge ok">đã lưu trước đó</span>' : ""}</p>
      <p style="margin:.2rem 0 .8rem;font-size:.9rem;"><span class="badge ok">Có mặt ${sm.present}</span>
        <span class="badge bad" style="margin-left:.3rem;">Vắng ${sm.absent}</span>
        <span class="muted" style="margin-left:.5rem;">Tổng ${curStudents.length}</span></p>
      ${!curStudents.length ? `<div class="card placeholder"><div class="big">👥</div><p>Lớp chưa có học viên nào học vào ngày này.</p></div>`
        : `<div class="card" style="padding:.4rem .9rem;">
            ${curStudents.map(s => attRow(s)).join("")}
          </div>
          <div class="att-savebar">
            <span class="msg" id="mk-msg"></span>
            <button class="btn ghost" data-act="back2">Hủy</button>
            <button class="btn" data-act="save">💾 Lưu điểm danh</button>
          </div>`}`;
  }

  function attRow(s) {
    const cur2 = markState[s.id];
    const av = s.photo_url ? `<img class="avatar" src="${SM.esc(s.photo_url)}">` : `<span class="avatar">${SM.esc(initials(s.full_name))}</span>`;
    return `<div class="att-row" data-stu="${s.id}">
      <div class="att-who">${av}<div><b>${SM.esc(s.full_name)}</b><br><code style="font-size:.78rem;">${SM.esc(s.code || "")}</code></div></div>
      <div class="att-seg">
        ${Object.entries(STAT).map(([k, v]) => `<button data-set="${k}" class="${cur2 === k ? "on " + v.cls : ""}">${v.label}</button>`).join("")}
        <button class="att-note-btn" data-note="${s.id}" title="Ghi chú">📝${markNote[s.id] ? "•" : ""}</button>
      </div>
    </div>`;
  }

  async function saveMark() {
    const msg = box.querySelector("#mk-msg");
    const say = (t, e) => { if (msg) { msg.textContent = t; msg.className = "msg" + (e ? " err" : ""); } };
    const btn = box.querySelector('[data-act="save"]'); if (btn) btn.disabled = true;
    const now = new Date().toISOString();
    const rows = curStudents.map(s => ({
      session_id: cur.id, student_id: s.id, status: markState[s.id] || "present",
      note: markNote[s.id] || "", recorded_by: ME.user.id, recorded_at: now
    }));
    const { error } = await sb.from("attendance").upsert(rows, { onConflict: "session_id,student_id" });
    if (error) { if (btn) btn.disabled = false; return say("Không lưu được: " + error.message, true); }
    // đã điểm danh ⇒ đánh dấu buổi "đã học" (nếu đang là theo lịch)
    if (cur.status === "scheduled") { await sb.from("sessions").update({ status: "held" }).eq("id", cur.id); cur.status = "held"; }
    markDirty = false;
    SM.toast("✓ Đã lưu điểm danh", "ok");
    cur = null; await loadDay(); paintDay();
  }

  function noteDialog(studentId) {
    const s = curStudents.find(x => x.id === studentId); if (!s) return;
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:420px;"><div class="mh"><h3>Ghi chú · ${SM.esc(s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="field"><label>Ghi chú buổi này (vd: xin nghỉ, đi trễ 10 phút…)</label>
        <textarea id="nt" style="min-height:80px;">${SM.esc(markNote[studentId] || "")}</textarea></div></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="nt-save">Lưu ghi chú</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#nt-save").addEventListener("click", () => {
      markNote[studentId] = ov.querySelector("#nt").value.trim(); markDirty = true; ov.remove();
      const btn = box.querySelector(`[data-note="${studentId}"]`); if (btn) btn.textContent = "📝" + (markNote[studentId] ? "•" : "");
    });
  }

  /* ================= TAB 2 — LỊCH SỬ & CHUYÊN CẦN ================= */
  async function paintHistory() {
    box.innerHTML = tabsHtml() + `
      <div class="toolbar">
        <div class="field" style="min-width:240px;"><label>Chọn lớp</label>
          <select id="h-class"><option value="">— chọn lớp để xem —</option>
            ${classes.map(c => `<option value="${c.id}" ${st.histClass === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}</select></div>
      </div>
      <div id="h-body">${st.histClass ? `<div class="card placeholder"><span class="spinner"></span></div>` : `<div class="card placeholder"><div class="big">📊</div><p>Chọn một lớp để xem tỉ lệ chuyên cần của từng học viên.</p></div>`}</div>`;
    const hc = box.querySelector("#h-class");
    if (hc) hc.addEventListener("change", () => { st.histClass = hc.value; renderHistoryBody(); });
    if (st.histClass) renderHistoryBody();
  }

  async function renderHistoryBody() {
    const body = box.querySelector("#h-body");
    if (!st.histClass) { body.innerHTML = `<div class="card placeholder"><div class="big">📊</div><p>Chọn một lớp.</p></div>`; return; }
    body.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
    const today = SM.todayISO();
    const [enr, sess] = await Promise.all([
      sb.from("enrollments").select("joined_on,left_on,status,student:students(id,code,full_name,photo_url)").eq("class_id", st.histClass),
      sb.from("sessions").select("id,date,status").eq("class_id", st.histClass).lte("date", today).neq("status", "cancelled").order("date")
    ]);
    const enroll = (enr.data || []).filter(e => e.student);
    const sessions = sess.data || [];
    const sessIds = sessions.map(s => s.id);
    let att = [];
    if (sessIds.length) {
      // tải theo lô để tránh URL quá dài khi nhiều buổi
      for (let i = 0; i < sessIds.length; i += 200) {
        const { data } = await sb.from("attendance").select("session_id,student_id,status").in("session_id", sessIds.slice(i, i + 200));
        att = att.concat(data || []);
      }
    }
    const sessDate = {}; sessions.forEach(s => sessDate[s.id] = s.date);
    // gom điểm danh theo học viên
    const byStu = {}; att.forEach(a => { (byStu[a.student_id] = byStu[a.student_id] || {})[a.session_id] = a.status; });

    const rows = enroll.map(e => {
      const s = e.student;
      // các buổi mà học viên này có ghi danh hiệu lực
      const mine = sessions.filter(se => enrolledOn(e, se.date));
      let attended = 0, absent = 0, notRec = 0;
      mine.forEach(se => {
        const v = (byStu[s.id] || {})[se.id];
        if (!v) notRec++; else if (ATTENDED.has(v)) attended++; else if (ABSENT.has(v)) absent++;
      });
      const recorded = attended + absent;
      const rate = recorded ? Math.round(attended / recorded * 100) : null;
      return { s, e, expected: mine.length, attended, absent, notRec, recorded, rate };
    }).sort((a, b) => (a.e.status === b.e.status ? (a.s.full_name || "").localeCompare(b.s.full_name || "", "vi") : a.e.status === "active" ? -1 : 1));

    if (!enroll.length) { body.innerHTML = `<div class="card placeholder"><div class="big">👥</div><p>Lớp chưa có học viên.</p></div>`; return; }

    const rateBadge = r => r == null ? `<span class="muted">—</span>`
      : `<span class="badge ${r >= 90 ? "ok" : r >= 75 ? "warn" : "bad"}">${r}%</span>`;

    body.innerHTML = `
      <p class="muted" style="margin:.2rem 0 .6rem;font-size:.9rem;">${sessions.length} buổi đã diễn ra (tính đến ${SM.dmy(today)}). Tỉ lệ chuyên cần = số buổi có đi học / số buổi đã điểm danh.</p>
      <div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Mã</th><th>Học viên</th><th>Buổi</th><th>Có mặt</th><th>Vắng</th><th>Chưa điểm danh</th><th>Chuyên cần</th><th></th>
      </tr></thead><tbody>
        ${rows.map(r => `<tr ${r.e.status === "former" ? 'style="opacity:.6"' : ""}>
          <td data-th="Mã"><code>${SM.esc(r.s.code || "")}</code></td>
          <td data-th="Học viên"><b>${SM.esc(r.s.full_name)}</b>${r.e.status === "former" ? ' <span class="badge mute">đã rời</span>' : ""}</td>
          <td data-th="Buổi">${r.expected}</td>
          <td data-th="Có mặt">${r.attended}</td>
          <td data-th="Vắng">${r.absent}</td>
          <td data-th="Chưa điểm danh">${r.notRec ? `<span class="badge warn">${r.notRec}</span>` : "0"}</td>
          <td data-th="Chuyên cần">${rateBadge(r.rate)}</td>
          <td class="cell-actions"><div class="row-actions"><button class="btn ghost" data-detail="${r.s.id}">Chi tiết</button></div></td>
        </tr>`).join("")}
      </tbody></table></div>`;

    // lưu để mở chi tiết
    body._rows = rows; body._byStu = byStu; body._sessions = sessions;
  }

  function detailDialog(studentId) {
    const body = box.querySelector("#h-body");
    const row = (body._rows || []).find(r => r.s.id === studentId); if (!row) return;
    const sessions = body._sessions || [];
    const mine = sessions.filter(se => enrolledOn(row.e, se.date));
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:480px;"><div class="mh">
        <h3>Chuyên cần · ${SM.esc(row.s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .6rem;">Lớp <b>${SM.esc(cName(st.histClass))}</b> · ${row.attended}/${row.recorded} buổi có mặt
          ${row.rate == null ? "" : `· <span class="badge ${row.rate >= 90 ? "ok" : row.rate >= 75 ? "warn" : "bad"}">${row.rate}%</span>`}</p>
        <div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Ngày</th><th>Thứ</th><th>Trạng thái</th></tr></thead><tbody>
          ${mine.slice().reverse().map(se => {
            const v = (body._byStu[studentId] || {})[se.id];
            const st2 = v ? STAT_ALL[v] : null;
            return `<tr><td data-th="Ngày">${SM.dmy(se.date)}</td><td data-th="Thứ">${SM.WEEKDAYS[fromISO(se.date).getDay()]}</td>
              <td data-th="Trạng thái">${st2 ? `<span class="badge ${st2.cls}">${st2.label}</span>` : `<span class="badge warn">Chưa điểm danh</span>`}</td></tr>`;
          }).join("") || `<tr><td colspan="3" class="muted" style="text-align:center;">Chưa có buổi nào.</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Đóng</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
  }

  /* ---------------- điều khiển ---------------- */
  function onClick(e) {
    const b = e.target.closest("[data-tab],[data-nav],[data-mark],[data-act],[data-set],[data-note],[data-detail]");
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; cur = null; return st.tab === "mark" ? (paintDay(), loadDay()) : paintHistory(); }
    if (b.dataset.nav) {
      if (b.dataset.nav === "today") st.date = SM.todayISO();
      else st.date = addDays(st.date, b.dataset.nav === "next" ? 1 : -1);
      return loadDay();
    }
    if (b.dataset.mark) return openMark(b.dataset.mark);
    if (b.dataset.detail) return detailDialog(b.dataset.detail);
    if (b.dataset.act === "back" || b.dataset.act === "back2") {
      if (markDirty && !confirm("Bỏ các thay đổi chưa lưu?")) return;
      cur = null; return paintDay();
    }
    if (b.dataset.act === "allpresent") { curStudents.forEach(s => markState[s.id] = "present"); markDirty = true; return paintMark(false); }
    if (b.dataset.act === "save") return saveMark();
    if (b.dataset.note) return noteDialog(b.dataset.note);
    if (b.dataset.set) {
      const row = b.closest("[data-stu]"); if (!row) return;
      markState[row.dataset.stu] = b.dataset.set; markDirty = true;
      // cập nhật nút của đúng hàng đó, và làm mới phần tổng kết ở đầu
      row.querySelectorAll(".att-seg [data-set]").forEach(x => x.className = "");
      b.className = "on " + (STAT[b.dataset.set] || {}).cls;
      const sm = markSummary();
      const badges = box.querySelector("h1 + p + p");
      if (badges) badges.innerHTML = `<span class="badge ok">Có mặt ${sm.present}</span>
        <span class="badge bad" style="margin-left:.3rem;">Vắng ${sm.absent}</span>
        <span class="muted" style="margin-left:.5rem;">Tổng ${curStudents.length}</span>`;
    }
  }

  return {
    async render(el, me) {
      ME = me; box = el; cur = null;
      if (!st.date) st.date = SM.todayISO();
      box.onclick = onClick;
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      await loadStatic();
      if (st.tab === "history") paintHistory(); else { paintDay(); loadDay(); }
    }
  };
})();

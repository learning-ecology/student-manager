/* ============================================================
   Điều hành giảng dạy — Giai đoạn A (chỉ đọc, dùng lại dữ liệu sẵn có)
   Tabs: Hôm nay · Bảng lớp (+chi tiết) · Giáo viên (rảnh/bận) · Tổng quan
   Nguồn: classes, sessions, attendance, enrollments, class_schedules, teachers.
   ============================================================ */
window.Ops = (function () {
  let ME = null, box = null, busy = false;
  const st = { tab: "today", q: "", status: "", teacher: "", availDate: "", aS: "18:00", aE: "19:30", availRows: null };
  let classes = [], teachers = [], schedules = [], todaySess = [], sessCounts = [], activeCounts = {};

  const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];               // theo getDay 0..6
  const hm = t => (t || "").slice(0, 5);
  const cls = id => classes.find(c => c.id === id) || {};
  const cName = id => cls(id).name || "—";
  const tName = id => id ? ((teachers.find(t => t.id === id) || {}).full_name || "GV đã xóa") : "— chưa gán —";
  const effTeacher = s => s.teacher_id || cls(s.class_id).teacher_id || null;   // GV buổi > GV lớp
  const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

  const CBADGE = { planned: "warn", active: "ok", completed: "mute", archived: "mute" };
  const CSTAT = { planned: "Sắp mở", active: "Đang học", completed: "Đã kết thúc", archived: "Lưu trữ" };

  // Trạng thái "sống" của lớp: ưu tiên hiển thị "Đang dạy" nếu có buổi diễn ra ngay bây giờ.
  function liveStatus(c) {
    const now = nowHM(), today = SM.todayISO();
    const running = todaySess.some(s => s.class_id === c.id && s.status !== "cancelled" && hm(s.start_time) <= now && now < hm(s.end_time));
    if (running) return { label: "🟢 Đang dạy", cls: "ok" };
    return { label: CSTAT[c.status] || c.status, cls: CBADGE[c.status] || "mute" };
  }

  function schedSummary(classId) {
    const rows = schedules.filter(s => s.class_id === classId)
      .sort((a, b) => a.weekday === b.weekday ? (a.start_time < b.start_time ? -1 : 1) : (a.weekday - b.weekday));
    if (!rows.length) return "—";
    return rows.map(s => `${WD[s.weekday]} ${hm(s.start_time)}`).join(", ");
  }
  // đếm buổi: đã dạy (held) / còn lại (scheduled, ngày ≥ hôm nay) / tổng (không tính hủy)
  function sessionStat(classId) {
    const today = SM.todayISO();
    let held = 0, remaining = 0, total = 0;
    for (const s of sessCounts) {
      if (s.class_id !== classId) continue;
      total++;
      if (s.status === "held") held++;
      else if (s.status === "scheduled" && s.date >= today) remaining++;
    }
    return { held, remaining, total };
  }

  /* ---------------- tải dữ liệu chung ---------------- */
  async function loadAll() {
    busy = true; paint();
    const today = SM.todayISO();
    const [cl, te, en, sc, ts, all] = await Promise.all([
      SM.refClasses(), SM.refTeachers(),
      sb.from("enrollments").select("class_id").eq("status", "active"),
      sb.from("class_schedules").select("class_id,weekday,start_time,end_time"),
      sb.from("sessions").select("id,class_id,date,start_time,end_time,teacher_id,room,online_link,status,type,note").eq("date", today).order("start_time"),
      sb.from("sessions").select("class_id,status,date").neq("status", "cancelled")
    ]);
    classes = cl || []; teachers = te || [];
    schedules = sc.data || []; todaySess = ts.data || []; sessCounts = all.data || [];
    activeCounts = {}; (en.data || []).forEach(e => activeCounts[e.class_id] = (activeCounts[e.class_id] || 0) + 1);
    // đánh dấu buổi hôm nay đã điểm danh chưa (1 truy vấn gộp)
    const tIds = todaySess.map(s => s.id);
    if (tIds.length) {
      const { data: att } = await sb.from("attendance").select("session_id").in("session_id", tIds);
      const taken = new Set((att || []).map(a => a.session_id));
      todaySess.forEach(s => s._att = taken.has(s.id));
    }
    busy = false; paint();
  }

  /* ---------------- khung + tabs ---------------- */
  function tabsHtml() {
    const T = [["today", "📅 Hôm nay"], ["board", "🏫 Bảng lớp"], ["teachers", "👩‍🏫 Giáo viên"], ["summary", "📊 Tổng quan"]];
    return `<h1>Điều hành giảng dạy</h1>
      <div class="toolbar" style="gap:.4rem;flex-wrap:wrap;margin-bottom:.8rem;">
        ${T.map(([k, l]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${l}</button>`).join("")}
      </div>`;
  }
  function paint() {
    if (!box) return;
    if (busy) { box.innerHTML = tabsHtml() + `<div class="card placeholder"><span class="spinner"></span></div>`; wireTabs(); return; }
    if (st.tab === "today") paintToday();
    else if (st.tab === "board") paintBoard();
    else if (st.tab === "teachers") paintTeachers();
    else paintSummary();
    wireTabs();
  }
  function wireTabs() {
    box.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { st.tab = b.dataset.tab; paint(); });
  }

  /* ---------------- TAB: HÔM NAY ---------------- */
  function paintToday() {
    const today = SM.todayISO(), now = nowHM();
    const live = todaySess.filter(s => s.status !== "cancelled");
    // gom theo GV phụ trách (buổi > lớp), nhóm "chưa gán" cuối
    const groups = {};
    live.forEach(s => { const t = effTeacher(s) || "none"; (groups[t] = groups[t] || []).push(s); });
    const order = Object.keys(groups).sort((a, b) => a === "none" ? 1 : b === "none" ? -1 : tName(a).localeCompare(tName(b)));
    const sess = s => {
      const running = hm(s.start_time) <= now && now < hm(s.end_time);
      const sc = s.status === "held" ? `<span class="badge ok">Đã học</span>` : s.status === "cancelled" ? `<span class="badge bad">Đã hủy</span>` : running ? `<span class="badge ok">🟢 Đang diễn ra</span>` : `<span class="badge warn">Theo lịch</span>`;
      const att = s._att ? `<span class="badge ok">✓ đã điểm danh</span>` : `<span class="badge mute">chưa điểm danh</span>`;
      const n = activeCounts[s.class_id] || 0;
      return `<tr>
        <td data-th="Giờ"><b>${hm(s.start_time)}–${hm(s.end_time)}</b></td>
        <td data-th="Lớp"><b>${SM.esc(cName(s.class_id))}</b>${s.type !== "regular" ? ` <span class="muted">(${s.type === "makeup" ? "bù" : "thêm"})</span>` : ""}</td>
        <td data-th="HV">${n}</td>
        <td data-th="Phòng">${SM.esc(s.room || cls(s.class_id).room || (s.online_link || cls(s.class_id).online_link ? "Online" : "—"))}</td>
        <td data-th="Trạng thái">${sc}</td>
        <td data-th="Điểm danh">${att}</td>
        <td class="cell-actions"><button class="btn ghost" data-open="${s.class_id}">Chi tiết</button></td></tr>`;
    };
    box.innerHTML = tabsHtml() + `
      <p class="muted" style="margin:.1rem 0 .7rem;">${SM.WEEKDAYS[new Date(today + "T00:00:00").getDay()]}, ${SM.dmy(today)} · <b>${live.length}</b> buổi học${todaySess.length - live.length ? ` · ${todaySess.length - live.length} đã hủy` : ""}</p>
      ${!live.length ? `<div class="card placeholder"><div class="big">🌤️</div><p>Hôm nay không có buổi học nào theo lịch.</p></div>`
        : order.map(t => `<div class="card" style="padding:.6rem .9rem;margin-bottom:.8rem;">
            <h3 style="font-size:1rem;margin:.2rem 0 .5rem;font-family:var(--serif);">${t === "none" ? "⚠️ Chưa gán giáo viên" : "👤 " + SM.esc(tName(t))} <span class="muted" style="font-weight:400;font-size:.85rem;">· ${groups[t].length} buổi</span></h3>
            <div class="sm-table-wrap"><table class="sm-table"><tbody>${groups[t].sort((a, b) => a.start_time < b.start_time ? -1 : 1).map(sess).join("")}</tbody></table></div>
          </div>`).join("")}`;
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => classDetail(b.dataset.open));
  }

  /* ---------------- TAB: BẢNG LỚP ---------------- */
  function paintBoard() {
    const q = st.q.toLowerCase();
    let list = classes.filter(c => !c.archived_at);
    if (st.status) list = list.filter(c => c.status === st.status);
    if (st.teacher) list = list.filter(c => c.teacher_id === st.teacher);
    if (q) list = list.filter(c => (c.name || "").toLowerCase().includes(q) || (c.subject || "").toLowerCase().includes(q));
    list = list.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const teacherOpts = teachers.slice().sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map(t => `<option value="${t.id}" ${st.teacher === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("");
    const row = c => {
      const s = liveStatus(c), st2 = sessionStat(c.id), n = activeCounts[c.id] || 0;
      const cap = c.max_students;
      return `<tr>
        <td data-th="Lớp"><b>${SM.esc(c.name)}</b>${c.subject ? `<br><span class="muted" style="font-size:.8rem">${SM.esc(c.subject)}</span>` : ""}</td>
        <td data-th="Trạng thái"><span class="badge ${s.cls}">${s.label}</span></td>
        <td data-th="Giáo viên">${c.teacher_id ? SM.esc(tName(c.teacher_id)) : `<span class="badge warn">chưa gán</span>`}</td>
        <td data-th="HV">${n}${cap != null ? "/" + cap : ""}</td>
        <td data-th="Lịch">${SM.esc(schedSummary(c.id))}</td>
        <td data-th="Buổi"><span class="muted">đã dạy</span> <b>${st2.held}</b> · <span class="muted">còn</span> <b>${st2.remaining}</b></td>
        <td data-th="Thời gian">${c.start_date ? SM.dmy(c.start_date) : "—"}${c.end_date ? " → " + SM.dmy(c.end_date) : ""}</td>
        <td class="cell-actions"><button class="btn ghost" data-open="${c.id}">Chi tiết</button></td></tr>`;
    };
    box.innerHTML = tabsHtml() + `
      <div class="toolbar" style="gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem;">
        <div class="field" style="flex:1;min-width:180px;"><label>Tìm lớp / môn</label><input id="op-q" value="${SM.esc(st.q)}" placeholder="gõ để tìm…"></div>
        <div class="field"><label>Trạng thái</label><select id="op-status">
          <option value="">Tất cả</option>${Object.entries(CSTAT).filter(([k]) => k !== "archived").map(([k, v]) => `<option value="${k}" ${st.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Giáo viên</label><select id="op-teacher"><option value="">Tất cả</option>${teacherOpts}</select></div>
      </div>
      ${!list.length ? `<div class="card placeholder"><p>Không có lớp phù hợp.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
            <th>Lớp</th><th>Trạng thái</th><th>Giáo viên</th><th>HV</th><th>Lịch</th><th>Buổi</th><th>Thời gian</th><th></th></tr></thead>
          <tbody>${list.map(row).join("")}</tbody></table></div>`}`;
    const qEl = box.querySelector("#op-q");
    let deb; qEl.oninput = () => { clearTimeout(deb); deb = setTimeout(() => { st.q = qEl.value; paintBoard(); wireTabs(); const el = box.querySelector("#op-q"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
    box.querySelector("#op-status").onchange = e => { st.status = e.target.value; paintBoard(); wireTabs(); };
    box.querySelector("#op-teacher").onchange = e => { st.teacher = e.target.value; paintBoard(); wireTabs(); };
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => classDetail(b.dataset.open));
  }

  /* ---------------- CHI TIẾT LỚP (modal) ---------------- */
  async function classDetail(classId) {
    const c = cls(classId);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>${SM.esc(c.name || "Lớp")}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="card placeholder"><span class="spinner"></span></div></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    const [{ data: enr }, { data: sess }] = await Promise.all([
      sb.from("enrollments").select("joined_on, student:students(id,code,full_name,phone)").eq("class_id", classId).eq("status", "active").order("joined_on"),
      sb.from("sessions").select("id,date,start_time,end_time,status,type").eq("class_id", classId).order("date", { ascending: false }).limit(400)
    ]);
    const ids = (sess || []).map(s => s.id);
    let attByS = {};
    if (ids.length) {
      const { data: att } = await sb.from("attendance").select("session_id,status").in("session_id", ids.slice(0, 300));
      (att || []).forEach(a => { (attByS[a.session_id] = attByS[a.session_id] || { present: 0, absent: 0 }); if (a.status === "authorised_absence" || a.status === "unauthorised_absence") attByS[a.session_id].absent++; else attByS[a.session_id].present++; });
    }
    const today = SM.todayISO();
    const held = (sess || []).filter(s => s.status === "held").length;
    const remaining = (sess || []).filter(s => s.status === "scheduled" && s.date >= today).length;
    const s = liveStatus(c);
    const past = (sess || []).filter(x => x.status !== "cancelled").slice(0, 12);
    ov.querySelector(".mb").innerHTML = `
      <div class="grid2" style="gap:.4rem .9rem;font-size:.92rem;">
        <div><span class="muted">Trạng thái:</span> <span class="badge ${s.cls}">${s.label}</span></div>
        <div><span class="muted">Giáo viên:</span> <b>${c.teacher_id ? SM.esc(tName(c.teacher_id)) : "chưa gán"}</b></div>
        <div><span class="muted">Sĩ số:</span> <b>${(enr || []).length}</b>${c.max_students != null ? " / " + c.max_students : ""}</div>
        <div><span class="muted">Phòng:</span> ${SM.esc(c.room || (c.online_link ? "Online" : "—"))}</div>
        <div><span class="muted">Lịch tuần:</span> ${SM.esc(schedSummary(classId))}</div>
        <div><span class="muted">Thời gian:</span> ${c.start_date ? SM.dmy(c.start_date) : "—"}${c.end_date ? " → " + SM.dmy(c.end_date) : " → (mở)"}</div>
        <div><span class="muted">Buổi đã dạy:</span> <b>${held}</b></div>
        <div><span class="muted">Buổi còn lại:</span> <b>${remaining}</b></div>
      </div>
      <h4 style="margin:.9rem 0 .3rem;font-size:.95rem;">Học viên (${(enr || []).length})</h4>
      ${(enr || []).length ? `<div class="sm-table-wrap" style="max-height:180px;overflow:auto;"><table class="sm-table"><tbody>
        ${enr.map(e => e.student ? `<tr><td><code>${SM.esc(e.student.code || "")}</code></td><td><b>${SM.esc(e.student.full_name)}</b></td><td>${SM.esc(e.student.phone || "—")}</td><td class="muted">vào ${SM.dmy(e.joined_on)}</td></tr>` : "").join("")}
      </tbody></table></div>` : `<p class="muted">Chưa có học viên.</p>`}
      <h4 style="margin:.9rem 0 .3rem;font-size:.95rem;">Lịch sử buổi gần đây</h4>
      ${past.length ? `<div class="sm-table-wrap" style="max-height:220px;overflow:auto;"><table class="sm-table"><thead><tr><th>Ngày</th><th>Giờ</th><th>Trạng thái</th><th>Điểm danh</th></tr></thead><tbody>
        ${past.map(x => { const a = attByS[x.id]; return `<tr>
          <td data-th="Ngày">${SM.dmy(x.date)}${x.type !== "regular" ? ` <span class="muted">(${x.type === "makeup" ? "bù" : "thêm"})</span>` : ""}</td>
          <td data-th="Giờ">${hm(x.start_time)}–${hm(x.end_time)}</td>
          <td data-th="Trạng thái">${x.status === "held" ? '<span class="badge ok">Đã học</span>' : x.status === "cancelled" ? '<span class="badge bad">Đã hủy</span>' : '<span class="badge warn">Theo lịch</span>'}</td>
          <td data-th="Điểm danh">${a ? `<span class="badge ok">${a.present} có mặt</span>${a.absent ? ` <span class="badge bad">${a.absent} vắng</span>` : ""}` : '<span class="muted">—</span>'}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="muted">Chưa có buổi học.</p>`}`;
  }

  /* ---------------- TAB: GIÁO VIÊN (rảnh/bận tại thời điểm) ---------------- */
  function paintTeachers() {
    const date = st.availDate || SM.todayISO();
    box.innerHTML = tabsHtml() + `
      <div class="card" style="padding:1rem 1.2rem;max-width:720px;">
        <p class="muted" style="margin:.1rem 0 .7rem;">Chọn ngày và khung giờ để xem giáo viên nào <b>rảnh</b> và ai <b>đang bận</b> (kèm lớp đang dạy).</p>
        <div class="toolbar" style="gap:.5rem;flex-wrap:wrap;">
          <div class="field"><label>Ngày (DD/MM/YYYY)</label><input id="av-date" value="${SM.dmy(date)}" style="width:150px"></div>
          <div class="field"><label>Từ</label><input id="av-s" type="time" value="${st.aS}" style="width:auto"></div>
          <div class="field"><label>Đến</label><input id="av-e" type="time" value="${st.aE}" style="width:auto"></div>
          <div class="field"><label>&nbsp;</label><button class="btn" id="av-go">🔍 Kiểm tra</button></div>
        </div>
        <p class="msg" id="av-msg"></p>
        <div id="av-out">${st.availRows ? availTable(st.availRows) : ""}</div>
      </div>`;
    box.querySelector("#av-go").onclick = async () => {
      const msg = box.querySelector("#av-msg");
      const d = SM.parseDmy(box.querySelector("#av-date").value.trim());
      const aS = box.querySelector("#av-s").value, aE = box.querySelector("#av-e").value;
      if (!d) { msg.textContent = "Ngày không hợp lệ."; msg.className = "msg err"; return; }
      if (!aS || !aE || aE <= aS) { msg.textContent = "Khung giờ không hợp lệ."; msg.className = "msg err"; return; }
      msg.textContent = ""; st.availDate = d; st.aS = aS; st.aE = aE;
      const { data } = await sb.from("sessions").select("class_id,teacher_id,start_time,end_time,room,online_link,status").eq("date", d).neq("status", "cancelled");
      // GV bận = có buổi giao khung giờ
      const busyMap = {};
      (data || []).forEach(s => {
        if (!overlaps(hm(s.start_time), hm(s.end_time), aS, aE)) return;
        const t = s.teacher_id || cls(s.class_id).teacher_id; if (!t) return;
        (busyMap[t] = busyMap[t] || []).push({ cls: cName(s.class_id), time: hm(s.start_time) + "–" + hm(s.end_time), room: s.room || cls(s.class_id).room || (s.online_link || cls(s.class_id).online_link ? "Online" : "—") });
      });
      st.availRows = teachers.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map(t => ({ name: t.full_name, busy: busyMap[t.id] || null }));
      box.querySelector("#av-out").innerHTML = availTable(st.availRows);
    };
  }
  function availTable(rows) {
    if (!rows.length) return `<p class="muted">Chưa có giáo viên nào.</p>`;
    const free = rows.filter(r => !r.busy).length;
    return `<p class="muted" style="margin:.6rem 0 .4rem;"><b>${free}</b> rảnh · <b>${rows.length - free}</b> bận</p>
      <div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Giáo viên</th><th>Tình trạng</th><th>Đang dạy</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td data-th="Giáo viên"><b>${SM.esc(r.name)}</b></td>
        <td data-th="Tình trạng">${r.busy ? '<span class="badge bad">Đang bận</span>' : '<span class="badge ok">Rảnh</span>'}</td>
        <td data-th="Đang dạy">${r.busy ? r.busy.map(b => `${SM.esc(b.cls)} <span class="muted">(${b.time}${b.room !== "—" ? " · " + SM.esc(b.room) : ""})</span>`).join("<br>") : "—"}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  /* ---------------- TAB: TỔNG QUAN ĐIỀU HÀNH ---------------- */
  function paintSummary() {
    const now = nowHM();
    const live = todaySess.filter(s => s.status !== "cancelled");
    const runningNow = live.filter(s => hm(s.start_time) <= now && now < hm(s.end_time));
    const teachersNow = new Set(runningNow.map(effTeacher).filter(Boolean));
    const activeCls = classes.filter(c => !c.archived_at && (c.status === "active" || c.status === "planned"));
    const unassigned = activeCls.filter(c => !c.teacher_id);
    const available = teachers.filter(t => !teachersNow.has(t.id));
    // trùng lịch hôm nay: cùng GV hoặc cùng phòng, giao giờ
    let conflicts = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (!overlaps(hm(a.start_time), hm(a.end_time), hm(b.start_time), hm(b.end_time))) continue;
      const ta = effTeacher(a), tb = effTeacher(b);
      const ra = a.room || cls(a.class_id).room, rb = b.room || cls(b.class_id).room;
      if ((ta && ta === tb) || (ra && ra === rb)) conflicts.push([a, b]);
    }
    const tile = (icon, label, val, cls2, sub) => `<div class="card" style="padding:.9rem 1.1rem;">
      <div style="font-size:1.7rem;line-height:1;">${icon}</div>
      <div style="font-size:1.7rem;font-weight:800;margin:.2rem 0;${cls2 ? "color:var(--" + cls2 + ")" : ""}">${val}</div>
      <div class="muted" style="font-size:.85rem;">${label}</div>${sub ? `<div class="muted" style="font-size:.78rem;margin-top:.2rem;">${sub}</div>` : ""}</div>`;
    box.innerHTML = tabsHtml() + `
      <div class="stat-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.8rem;">
        ${tile("🟢", "Đang dạy bây giờ", runningNow.length, "", runningNow.slice(0, 3).map(s => SM.esc(cName(s.class_id))).join(", "))}
        ${tile("📅", "Buổi học hôm nay", live.length)}
        ${tile("👩‍🏫", "GV đang dạy", teachersNow.size)}
        ${tile("🟩", "GV đang rảnh", available.length)}
        ${tile("⚠️", "Lớp chưa gán GV", unassigned.length, unassigned.length ? "danger" : "", unassigned.slice(0, 3).map(c => SM.esc(c.name)).join(", "))}
        ${tile("❗", "Trùng lịch hôm nay", conflicts.length, conflicts.length ? "danger" : "")}
        ${tile("💰", "Chờ duyệt chấm công", "—", "", "Giai đoạn B")}
        ${tile("🧮", "Lương ước tính tháng", "—", "", "Giai đoạn B")}
      </div>
      ${unassigned.length ? `<div class="card" style="padding:.8rem 1.1rem;margin-top:1rem;border-left:3px solid var(--danger);">
        <b>⚠️ Lớp chưa gán giáo viên (${unassigned.length})</b>
        <div style="margin-top:.4rem;display:flex;flex-wrap:wrap;gap:.4rem;">${unassigned.map(c => `<span class="badge warn" style="cursor:pointer" data-open="${c.id}">${SM.esc(c.name)}</span>`).join("")}</div></div>` : ""}
      ${conflicts.length ? `<div class="card" style="padding:.8rem 1.1rem;margin-top:1rem;border-left:3px solid var(--danger);">
        <b>❗ Trùng lịch hôm nay (${conflicts.length})</b>
        ${conflicts.map(([a, b]) => `<div class="muted" style="font-size:.87rem;margin-top:.3rem;">${SM.esc(cName(a.class_id))} ↔ ${SM.esc(cName(b.class_id))} · ${hm(a.start_time)}–${hm(a.end_time)} — trùng ${effTeacher(a) && effTeacher(a) === effTeacher(b) ? "giáo viên " + SM.esc(tName(effTeacher(a))) : "phòng"}</div>`).join("")}</div>` : ""}`;
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => classDetail(b.dataset.open));
  }

  return {
    render(el, me) { ME = me; box = el; st.tab = "today"; st.availRows = null; loadAll(); }
  };
})();

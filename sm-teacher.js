/* ============================================================
   Giai đoạn E — CỔNG GIÁO VIÊN ("Của tôi")
   GV đăng nhập chỉ thấy dữ liệu của mình (RLS lo phần cách ly).
   Tabs: Hôm nay · Lịch tuần · Lớp của tôi · Lương của tôi.
   Dùng lại classes/sessions/enrollments/teacher_checkins/teacher_payslips.
   ============================================================ */
window.Me = (function () {
  let ME = null, box = null, busy = false, me = null;
  const st = { tab: "today" };
  let classes = [], enrollments = [], weekSess = [], checkins = {}, payslips = [];

  const cls = id => classes.find(c => c.id === id) || {};
  const cName = id => cls(id).name || "—";
  const hm = t => (t || "").slice(0, 5);
  const MONTHS = Array.from({ length: 12 }, (_, i) => "Tháng " + (i + 1));
  const CKSTAT = { on_time: { l: "Đúng giờ", c: "ok" }, late: { l: "Muộn", c: "warn" }, absent_excused: { l: "Vắng có phép", c: "mute" }, confirmed: { l: "Đã xác nhận", c: "ok" }, absent: { l: "Vắng", c: "bad" } };
  const isoLocal = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const fromISO = s => new Date(s + "T00:00:00");
  const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return isoLocal(d); };
  const weekStart = s => addDays(s, -((fromISO(s).getDay() + 6) % 7));    // về Thứ 2
  const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const cntActive = cid => enrollments.filter(e => e.class_id === cid).length;

  async function loadAll() {
    busy = true; paint();
    const { data: t } = await sb.from("teachers").select("id,full_name").eq("user_id", ME.user.id).maybeSingle();
    me = t;
    if (!me) { busy = false; box.innerHTML = `<h1>Của tôi</h1><div class="card placeholder"><div class="big">🔗</div><p><b>Tài khoản chưa liên kết giáo viên</b></p><p class="muted">Nhờ chủ trung tâm liên kết tài khoản của bạn với hồ sơ giáo viên (Cài đặt → Tài khoản giáo viên).</p></div>`; return; }
    const today = SM.todayISO(), ws = weekStart(today), we = addDays(ws, 6);
    const [cl, enr, ss] = await Promise.all([
      SM.refClasses(),
      sb.from("enrollments").select("class_id, student:students(id,code,full_name,phone)").eq("status", "active"),
      sb.from("sessions").select("id,class_id,date,start_time,end_time,teacher_id,room,online_link,status,type").gte("date", ws).lte("date", we).order("date").order("start_time")
    ]);
    classes = cl || []; enrollments = enr.data || []; weekSess = ss.data || [];
    checkins = {};
    const tIds = weekSess.map(s => s.id);
    if (tIds.length) { const { data: ck } = await sb.from("teacher_checkins").select("*").in("session_id", tIds); (ck || []).forEach(c => checkins[c.session_id] = c); }
    const { data: ps } = await sb.from("teacher_payslips").select("*").order("period_year", { ascending: false }).order("period_month", { ascending: false });
    payslips = ps || [];
    busy = false; paint();
  }

  function tabsHtml() {
    const T = [["today", "📅 Hôm nay"], ["week", "🗓️ Lịch tuần"], ["classes", "🏫 Lớp của tôi"], ["salary", "💰 Lương của tôi"]];
    return `<h1>Xin chào, ${SM.esc(me ? me.full_name : "")} 👋</h1>
      <div class="toolbar" style="gap:.4rem;flex-wrap:wrap;margin-bottom:.8rem;">${T.map(([k, l]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${l}</button>`).join("")}</div>`;
  }
  function paint() {
    if (!box) return;
    if (busy) { box.innerHTML = `<h1>Của tôi</h1><div class="card placeholder"><span class="spinner"></span></div>`; return; }
    if (!me) return;
    if (st.tab === "week") paintWeek();
    else if (st.tab === "classes") paintClasses();
    else if (st.tab === "salary") paintSalary();
    else paintToday();
    box.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { st.tab = b.dataset.tab; paint(); });
  }

  function sessRow(s, showDate) {
    const ck = checkins[s.id], now = nowHM(), today = SM.todayISO();
    const running = s.date === today && hm(s.start_time) <= now && now < hm(s.end_time);
    const status = ck ? `<span class="badge ${CKSTAT[ck.status].c}">${CKSTAT[ck.status].l}</span>`
      : (s.status === "cancelled" ? `<span class="badge bad">Đã hủy</span>` : running ? `<span class="badge ok">🟢 Đang diễn ra</span>` : s.status === "held" ? `<span class="badge warn">chờ check-in</span>` : `<span class="badge mute">theo lịch</span>`);
    const canCheckin = !ck && s.status !== "cancelled" && s.date === today;
    return `<tr>
      ${showDate ? `<td data-th="Ngày">${SM.dmy(s.date)}</td>` : ""}
      <td data-th="Giờ"><b>${hm(s.start_time)}–${hm(s.end_time)}</b></td>
      <td data-th="Lớp"><b>${SM.esc(cName(s.class_id))}</b>${s.type !== "regular" ? ` <span class="muted">(${s.type === "makeup" ? "bù" : "thêm"})</span>` : ""}</td>
      <td data-th="HV">${cntActive(s.class_id)}</td>
      <td data-th="Phòng">${SM.esc(s.room || cls(s.class_id).room || (s.online_link || cls(s.class_id).online_link ? "Online" : "—"))}</td>
      <td data-th="Chấm công">${status}</td>
      <td class="cell-actions">${canCheckin ? `<a class="btn" href="#checkin?s=${s.id}">✅ Check-in</a>` : ""}</td></tr>`;
  }

  function paintToday() {
    const today = SM.todayISO();
    const list = weekSess.filter(s => s.date === today).sort((a, b) => a.start_time < b.start_time ? -1 : 1);
    const now = nowHM();
    const next = list.find(s => s.status !== "cancelled" && hm(s.end_time) > now);
    box.innerHTML = tabsHtml() + `
      <p class="muted" style="margin:.1rem 0 .7rem;">${SM.WEEKDAYS[fromISO(today).getDay()]}, ${SM.dmy(today)} · <b>${list.filter(s => s.status !== "cancelled").length}</b> buổi</p>
      ${next ? `<div class="card" style="padding:.9rem 1.1rem;margin-bottom:.9rem;border-left:3px solid var(--accent);">
        <div class="muted" style="font-size:.82rem;">Buổi tiếp theo</div>
        <div style="font-size:1.15rem;font-weight:700;margin:.15rem 0;">${SM.esc(cName(next.class_id))}</div>
        <div>${hm(next.start_time)}–${hm(next.end_time)} · ${SM.esc(next.room || cls(next.class_id).room || (next.online_link || cls(next.class_id).online_link ? "Online" : "—"))} · ${cntActive(next.class_id)} học viên</div>
        ${!checkins[next.id] && next.status !== "cancelled" ? `<a class="btn" href="#checkin?s=${next.id}" style="margin-top:.6rem;display:inline-block;">✅ Check-in buổi này</a>` : ""}</div>` : ""}
      ${!list.length ? `<div class="card placeholder"><div class="big">🌤️</div><p>Hôm nay bạn không có buổi dạy nào.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Giờ</th><th>Lớp</th><th>HV</th><th>Phòng</th><th>Chấm công</th><th></th></tr></thead><tbody>${list.map(s => sessRow(s, false)).join("")}</tbody></table></div>`}`;
  }

  function paintWeek() {
    const today = SM.todayISO(), ws = weekStart(today);
    let html = tabsHtml() + `<p class="muted" style="margin:.1rem 0 .7rem;">Tuần ${SM.dmy(ws)} – ${SM.dmy(addDays(ws, 6))}</p>`;
    let any = false;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const list = weekSess.filter(s => s.date === d).sort((a, b) => a.start_time < b.start_time ? -1 : 1);
      if (!list.length) continue; any = true;
      html += `<div class="card" style="padding:.5rem .9rem;margin-bottom:.7rem;${d === today ? "border-left:3px solid var(--accent);" : ""}">
        <h3 style="font-size:.98rem;margin:.2rem 0 .4rem;font-family:var(--serif);">${SM.WEEKDAYS[fromISO(d).getDay()]}, ${SM.dmy(d)}${d === today ? ' <span class="badge ok">hôm nay</span>' : ""}</h3>
        <div class="sm-table-wrap"><table class="sm-table"><tbody>${list.map(s => sessRow(s, false)).join("")}</tbody></table></div></div>`;
    }
    if (!any) html += `<div class="card placeholder"><div class="big">🗓️</div><p>Tuần này chưa có buổi dạy nào.</p></div>`;
    box.innerHTML = html;
  }

  function paintClasses() {
    const mine = classes.filter(c => !c.archived_at).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    box.innerHTML = tabsHtml() + (!mine.length ? `<div class="card placeholder"><div class="big">🏫</div><p>Bạn chưa được phân công lớp nào.</p></div>`
      : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Lớp</th><th>Môn</th><th>HV</th><th>Phòng</th><th>Thời gian</th><th></th></tr></thead><tbody>
        ${mine.map(c => `<tr>
          <td data-th="Lớp"><b>${SM.esc(c.name)}</b></td><td data-th="Môn">${SM.esc(c.subject || "—")}</td>
          <td data-th="HV">${cntActive(c.id)}${c.max_students != null ? "/" + c.max_students : ""}</td>
          <td data-th="Phòng">${SM.esc(c.room || (c.online_link ? "Online" : "—"))}</td>
          <td data-th="Thời gian">${c.start_date ? SM.dmy(c.start_date) : "—"}${c.end_date ? " → " + SM.dmy(c.end_date) : ""}</td>
          <td class="cell-actions"><button class="btn ghost" data-roster="${c.id}">Học viên</button></td></tr>`).join("")}
      </tbody></table></div>`);
    box.querySelectorAll("[data-roster]").forEach(b => b.onclick = () => rosterModal(b.dataset.roster));
  }
  function rosterModal(cid) {
    const list = enrollments.filter(e => e.class_id === cid && e.student);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:520px;"><div class="mh"><h3>Học viên · ${SM.esc(cName(cid))}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">${!list.length ? `<p class="muted">Chưa có học viên.</p>` : `<div class="sm-table-wrap"><table class="sm-table"><tbody>
        ${list.map(e => `<tr><td><code>${SM.esc(e.student.code || "")}</code></td><td><b>${SM.esc(e.student.full_name)}</b></td><td>${SM.esc(e.student.phone || "—")}</td></tr>`).join("")}
      </tbody></table></div>`}</div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
  }

  function paintSalary() {
    const st2 = (total, paid) => total <= 0 ? { l: "—", c: "mute" } : paid <= 0 ? { l: "Chưa trả", c: "bad" } : paid >= total ? { l: "Đã trả", c: "ok" } : { l: "Trả một phần", c: "warn" };
    box.innerHTML = tabsHtml() + `<p class="muted" style="margin:.1rem 0 .7rem;">Phiếu lương do trung tâm lập. Lương tính theo số buổi bạn đã dạy.</p>
      ${!payslips.length ? `<div class="card placeholder"><div class="big">💰</div><p>Chưa có phiếu lương nào.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Kỳ</th><th>Số buổi</th><th class="r">Tiền buổi</th><th class="r">Điều chỉnh</th><th class="r">Tổng</th><th class="r">Đã trả</th><th>Trạng thái</th></tr></thead><tbody>
          ${payslips.map(p => { const s = st2(p.total, p.paid_amount); return `<tr>
            <td data-th="Kỳ"><b>${MONTHS[p.period_month - 1]}/${p.period_year}</b></td>
            <td data-th="Số buổi">${p.session_count}</td>
            <td data-th="Tiền buổi" class="r">${SM.vnd(p.base_amount)}</td>
            <td data-th="Điều chỉnh" class="r">${p.adjustment_total ? (p.adjustment_total < 0 ? "−" : "+") + SM.vnd(Math.abs(p.adjustment_total)) : "—"}</td>
            <td data-th="Tổng" class="r"><b>${SM.vnd(p.total)}</b></td>
            <td data-th="Đã trả" class="r">${SM.vnd(p.paid_amount)}</td>
            <td data-th="Trạng thái"><span class="badge ${s.c}">${s.l}</span></td></tr>`; }).join("")}
        </tbody></table></div>`}`;
  }

  return {
    render(el, meProfile) { ME = meProfile; box = el; st.tab = "today"; loadAll(); }
  };
})();

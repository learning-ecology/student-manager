/* ============================================================
   Giai đoạn B — LƯƠNG GIÁO VIÊN
   Lương = số buổi ĐÃ DẠY (sessions.status='held') × định mức phù hợp.
   • Định mức (teacher_rates): theo GV, tùy chọn theo lớp, theo buổi/giờ, hiệu lực từ ngày.
   • Phiếu lương (teacher_payslips): GV × tháng — ảnh chụp số buổi/tiền + điều chỉnh
     (+thưởng/−khấu trừ) + đã trả + trạng thái. Chốt (khóa) để giữ lịch sử.
   Dùng lại: teachers, classes, sessions. Cần chạy phaseB-payroll.sql.
   ============================================================ */
window.Payroll = (function () {
  let ME = null, box = null, busy = false;
  const now = new Date();
  const st = { tab: "run", year: now.getFullYear(), month: now.getMonth() + 1, teacher: "", cls: "", from: "", to: "" };
  let teachers = [], classes = [], rates = [], sessions = [], payslips = [];

  const MONTHS = Array.from({ length: 12 }, (_, i) => "Tháng " + (i + 1));
  const cls = id => classes.find(c => c.id === id) || {};
  const cName = id => cls(id).name || "—";
  const tName = id => (teachers.find(t => t.id === id) || {}).full_name || "GV";
  const toMin = t => (+(t || "0").slice(0, 2)) * 60 + (+(t || "0").slice(3, 5));
  const hoursOf = s => Math.max(0, (toMin(s.end_time) - toMin(s.start_time)) / 60);
  const fmtH = h => (Math.round(h * 100) / 100).toString().replace(/\.0+$/, "") + "h";
  const isoLocal = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const monthRange = (y, m) => ({ start: `${y}-${String(m).padStart(2, "0")}-01`, end: isoLocal(new Date(y, m, 0)) });
  const payStatus = (total, paid) => total <= 0 ? { l: "—", c: "mute" } : paid <= 0 ? { l: "Chưa trả", c: "bad" } : paid >= total ? { l: "Đã trả", c: "ok" } : { l: "Trả một phần", c: "warn" };

  // Chọn định mức phù hợp nhất cho (GV, lớp, ngày): ưu tiên định mức theo LỚP, rồi tới định mức chung; lấy hiệu lực gần nhất ≤ ngày.
  function resolveRate(teacherId, classId, dateISO) {
    const cand = rates.filter(r => r.teacher_id === teacherId && r.effective_from <= dateISO && (r.class_id === classId || r.class_id == null));
    if (!cand.length) return null;
    const byRecent = (a, b) => a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0;
    const cl = cand.filter(r => r.class_id === classId).sort(byRecent);
    if (cl.length) return cl[0];
    return cand.filter(r => r.class_id == null).sort(byRecent)[0] || null;
  }
  // Tính LIVE theo danh sách buổi đã dạy → gộp theo GV.
  function computeAll(sess) {
    const map = {};
    for (const s of sess) {
      const tid = s.teacher_id || cls(s.class_id).teacher_id;
      if (!tid) continue;                                  // buổi chưa gán GV → bỏ qua (báo ở tab Điều hành)
      const hours = hoursOf(s);
      const r = resolveRate(tid, s.class_id, s.date);
      const amount = !r ? 0 : (r.kind === "per_hour" ? Math.round(r.amount * hours) : r.amount);
      const g = map[tid] = map[tid] || { count: 0, base: 0, lines: [] };
      g.count++; g.base += amount;
      g.lines.push({ date: s.date, class_id: s.class_id, class: cName(s.class_id), hours, kind: r ? r.kind : null, rate: r ? r.amount : 0, amount, noRate: !r });
    }
    return map;
  }
  const adjSum = arr => (arr || []).reduce((n, a) => n + (Number(a.amount) || 0), 0);

  /* ---------------- tải dữ liệu ---------------- */
  function periodRange() {
    if (st.from && st.to) return { start: st.from, end: st.to, live: true };
    const r = monthRange(st.year, st.month); return { start: r.start, end: r.end, live: false };
  }
  async function load() {
    busy = true; paint();
    const p = periodRange();
    const [tc, cl, rt, ss] = await Promise.all([
      SM.refTeachers(), SM.refClasses(),
      sb.from("teacher_rates").select("*"),
      sb.from("sessions").select("id,class_id,date,start_time,end_time,teacher_id,status").eq("status", "held").gte("date", p.start).lte("date", p.end)
    ]);
    teachers = tc || []; classes = cl || [];
    if (rt.error) { busy = false; box.innerHTML = errCard(rt.error); return; }
    rates = rt.data || []; sessions = ss.data || [];
    // phiếu lương của kỳ (chỉ khi xem theo tháng)
    if (!p.live) {
      const { data: ps } = await sb.from("teacher_payslips").select("*").eq("period_year", st.year).eq("period_month", st.month);
      payslips = ps || [];
    } else payslips = [];
    busy = false; paint();
  }
  const errCard = e => `<h1>Lương giáo viên</h1><div class="card placeholder"><div class="big">⚙️</div><p><b>Chưa chạy phaseB-payroll.sql</b></p><p class="muted">${SM.esc(e.message || "")}</p><p class="muted">Vào Supabase → SQL Editor, dán file <code>phaseB-payroll.sql</code> và Run, rồi tải lại trang.</p></div>`;

  /* ---------------- khung + tabs ---------------- */
  function tabsHtml() {
    const T = [["run", "💰 Bảng lương"], ["rates", "⚙️ Định mức"]];
    return `<h1>Lương giáo viên</h1>
      <div class="toolbar" style="gap:.4rem;margin-bottom:.8rem;">
        ${T.map(([k, l]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${l}</button>`).join("")}</div>`;
  }
  function paint() {
    if (!box) return;
    if (busy) { box.innerHTML = tabsHtml() + `<div class="card placeholder"><span class="spinner"></span></div>`; wireTabs(); return; }
    if (st.tab === "rates") paintRates(); else paintRun();
    wireTabs();
  }
  function wireTabs() { box.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { st.tab = b.dataset.tab; paint(); }); }

  /* ---------------- TAB: BẢNG LƯƠNG ---------------- */
  function paintRun() {
    const p = periodRange();
    const payslipMode = !p.live && !st.cls;                          // gộp phiếu lương khi xem theo tháng, không lọc lớp
    let sess = sessions;
    if (st.cls) sess = sess.filter(s => s.class_id === st.cls);
    const computed = computeAll(sess);
    // danh sách GV cần hiển thị = có buổi trong kỳ ∪ có phiếu lương
    const ids = new Set(Object.keys(computed));
    if (payslipMode) payslips.forEach(ps => ids.add(ps.teacher_id));
    let rows = [...ids].map(tid => {
      const ps = payslipMode ? payslips.find(x => x.teacher_id === tid) : null;
      const locked = ps && ps.locked;
      const count = locked ? ps.session_count : (computed[tid] ? computed[tid].count : 0);
      const base = locked ? ps.base_amount : (computed[tid] ? computed[tid].base : 0);
      const adj = ps ? adjSum(ps.adjustments) : 0;
      const total = base + adj, paid = ps ? ps.paid_amount : 0;
      const noRate = computed[tid] && computed[tid].lines.some(l => l.noRate);
      return { tid, count, base, adj, total, paid, locked, noRate };
    });
    if (st.teacher) rows = rows.filter(r => r.tid === st.teacher);
    rows.sort((a, b) => tName(a.tid).localeCompare(tName(b.tid)));

    const teacherOpts = teachers.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map(t => `<option value="${t.id}" ${st.teacher === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("");
    const classOpts = classes.filter(c => !c.archived_at).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}" ${st.cls === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("");
    const tot = rows.reduce((o, r) => ({ base: o.base + r.base, total: o.total + r.total, paid: o.paid + r.paid }), { base: 0, total: 0, paid: 0 });

    const row = r => {
      const s = payStatus(r.total, r.paid);
      return `<tr>
        <td data-th="Giáo viên"><b>${SM.esc(tName(r.tid))}</b>${r.noRate ? ` <span class="badge warn" title="Có buổi chưa đặt định mức">thiếu định mức</span>` : ""}${r.locked ? ` <span class="badge mute">đã chốt</span>` : ""}</td>
        <td data-th="Số buổi">${r.count}</td>
        <td data-th="Tiền buổi" class="r">${SM.vnd(r.base)}</td>
        ${payslipMode ? `<td data-th="Điều chỉnh" class="r">${r.adj ? (r.adj < 0 ? "−" : "+") + SM.vnd(Math.abs(r.adj)) : "—"}</td>
        <td data-th="Tổng" class="r"><b>${SM.vnd(r.total)}</b></td>
        <td data-th="Đã trả" class="r">${SM.vnd(r.paid)}</td>
        <td data-th="Trạng thái"><span class="badge ${s.c}">${s.l}</span></td>` : `<td data-th="Tổng" class="r"><b>${SM.vnd(r.base)}</b></td>`}
        <td class="cell-actions"><button class="btn ghost" data-open="${r.tid}">Chi tiết</button></td></tr>`;
    };

    box.innerHTML = tabsHtml() + `
      <div class="toolbar" style="gap:.5rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:.7rem;">
        <div class="field"><label>Kỳ lương</label><div style="display:flex;align-items:center;gap:.3rem;">
          <button class="btn ghost" data-mv="-1" ${p.live ? "disabled" : ""}>‹</button>
          <b style="min-width:120px;text-align:center;">${p.live ? "Khoảng tùy chọn" : MONTHS[st.month - 1] + "/" + st.year}</b>
          <button class="btn ghost" data-mv="1" ${p.live ? "disabled" : ""}>›</button></div></div>
        <div class="field"><label>Giáo viên</label><select id="pr-teacher"><option value="">Tất cả</option>${teacherOpts}</select></div>
        <div class="field"><label>Lớp</label><select id="pr-cls"><option value="">Tất cả</option>${classOpts}</select></div>
        <div class="field"><label>Từ ngày</label><input id="pr-from" value="${st.from ? SM.dmy(st.from) : ""}" placeholder="DD/MM/YYYY" style="width:130px"></div>
        <div class="field"><label>Đến ngày</label><input id="pr-to" value="${st.to ? SM.dmy(st.to) : ""}" placeholder="DD/MM/YYYY" style="width:130px"></div>
        ${st.from || st.to ? `<div class="field"><label>&nbsp;</label><button class="btn ghost" id="pr-clear">✕ Bỏ lọc ngày</button></div>` : ""}
      </div>
      ${p.live ? `<p class="muted" style="font-size:.85rem;margin:0 0 .5rem;">Đang xem theo khoảng ngày (live) — chỉ hiển thị tiền buổi, không gồm điều chỉnh/đã trả.</p>` : st.cls ? `<p class="muted" style="font-size:.85rem;margin:0 0 .5rem;">Đang lọc theo lớp — chỉ hiển thị tiền buổi của lớp này.</p>` : ""}
      ${!rows.length ? `<div class="card placeholder"><div class="big">💤</div><p>Không có buổi đã dạy trong kỳ này.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
            <th>Giáo viên</th><th>Số buổi</th><th class="r">Tiền buổi</th>
            ${payslipMode ? `<th class="r">Điều chỉnh</th><th class="r">Tổng</th><th class="r">Đã trả</th><th>Trạng thái</th>` : `<th class="r">Tổng</th>`}<th></th></tr></thead>
          <tbody>${rows.map(row).join("")}</tbody>
          <tfoot><tr class="sub"><td><b>Tổng cộng (${rows.length} GV)</b></td><td></td><td class="r"><b>${SM.vnd(tot.base)}</b></td>
            ${payslipMode ? `<td></td><td class="r"><b>${SM.vnd(tot.total)}</b></td><td class="r"><b>${SM.vnd(tot.paid)}</b></td><td></td>` : `<td class="r"><b>${SM.vnd(tot.base)}</b></td>`}<td></td></tr></tfoot>
        </table></div>`}`;

    box.querySelectorAll("[data-mv]").forEach(b => b.onclick = () => {
      let m = st.month + (+b.dataset.mv); let y = st.year;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      st.month = m; st.year = y; load();
    });
    const teEl = box.querySelector("#pr-teacher"); if (teEl) teEl.onchange = e => { st.teacher = e.target.value; paintRun(); wireTabs(); };
    const clEl = box.querySelector("#pr-cls"); if (clEl) clEl.onchange = e => { st.cls = e.target.value; paintRun(); wireTabs(); };
    const apply = () => {
      const f = box.querySelector("#pr-from").value.trim(), t = box.querySelector("#pr-to").value.trim();
      const fi = f ? SM.parseDmy(f) : "", ti = t ? SM.parseDmy(t) : "";
      st.from = fi || ""; st.to = ti || ""; load();
    };
    ["pr-from", "pr-to"].forEach(id => { const el = box.querySelector("#" + id); if (el) el.onchange = apply; });
    const clr = box.querySelector("#pr-clear"); if (clr) clr.onclick = () => { st.from = ""; st.to = ""; load(); };
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => teacherDetail(b.dataset.open));
  }

  /* ---------------- CHI TIẾT / PHIẾU LƯƠNG 1 GV ---------------- */
  function teacherDetail(tid) {
    const p = periodRange();
    let sess = sessions.filter(s => (s.teacher_id || cls(s.class_id).teacher_id) === tid);
    if (st.cls) sess = sess.filter(s => s.class_id === st.cls);
    const comp = computeAll(sess)[tid] || { count: 0, base: 0, lines: [] };
    const editable = !p.live && !st.cls;                     // chỉ sửa phiếu khi xem theo tháng đầy đủ
    const ps = editable ? payslips.find(x => x.teacher_id === tid) : null;
    const locked = ps && ps.locked;
    // khóa → hiển thị ảnh chụp; ngược lại dùng số live
    const lines = locked ? (ps.detail || []) : comp.lines;
    const count = locked ? ps.session_count : comp.count;
    const base = locked ? ps.base_amount : comp.base;
    let adjustments = ps ? JSON.parse(JSON.stringify(ps.adjustments || [])) : [];
    let paidLocal = ps ? ps.paid_amount : 0;

    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>Lương · ${SM.esc(tName(tid))} · ${p.live ? SM.dmy(p.start) + "–" + SM.dmy(p.end) : MONTHS[st.month - 1] + "/" + st.year}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <div class="sm-table-wrap" style="max-height:230px;overflow:auto;"><table class="sm-table"><thead><tr><th>Ngày</th><th>Lớp</th><th>Thời lượng</th><th>Định mức</th><th class="r">Tiền</th></tr></thead><tbody>
          ${lines.length ? lines.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(l => `<tr>
            <td data-th="Ngày">${SM.dmy(l.date)}</td><td data-th="Lớp">${SM.esc(l.class || cName(l.class_id))}</td>
            <td data-th="Thời lượng">${fmtH(l.hours)}</td>
            <td data-th="Định mức">${l.noRate ? '<span class="badge warn">chưa đặt</span>' : (l.kind === "per_hour" ? SM.vnd(l.rate) + "/h" : SM.vnd(l.rate) + "/buổi")}</td>
            <td data-th="Tiền" class="r">${SM.vnd(l.amount)}</td></tr>`).join("") : `<tr><td colspan="5" class="muted" style="text-align:center">Không có buổi đã dạy.</td></tr>`}
        </tbody><tfoot><tr class="sub"><td colspan="4"><b>Tiền buổi (${count} buổi)</b></td><td class="r"><b>${SM.vnd(base)}</b></td></tr></tfoot></table></div>
        ${locked ? `<p class="muted" style="font-size:.82rem;margin:.4rem 0 0;">🔒 Phiếu đã chốt — số buổi & tiền buổi được giữ nguyên dù lớp/buổi thay đổi.</p>` : ""}

        <h4 style="margin:.8rem 0 .3rem;font-size:.95rem;">Điều chỉnh (thưởng +/ khấu trừ −)</h4>
        <div id="adj-list"></div>
        ${editable ? `<button class="btn ghost" id="adj-add" style="margin-top:.3rem;">➕ Thêm dòng</button>` : `<p class="muted" style="font-size:.83rem;">Chỉ sửa được khi xem theo tháng (không lọc lớp/khoảng ngày).</p>`}

        <table class="sm-table" style="margin-top:.8rem;max-width:340px;"><tbody>
          <tr><td>Tiền buổi</td><td class="r">${SM.vnd(base)}</td></tr>
          <tr><td>Điều chỉnh</td><td class="r" id="sum-adj"></td></tr>
          <tr class="tot"><td><b>Tổng lương</b></td><td class="r"><b id="sum-total"></b></td></tr>
          <tr><td>Đã trả</td><td class="r">${editable ? `<input id="pr-paid" type="number" min="0" value="${paidLocal}" style="width:130px;text-align:right;padding:.3rem .5rem;">` : SM.vnd(paidLocal)}</td></tr>
          <tr><td>Trạng thái</td><td class="r" id="sum-status"></td></tr>
        </tbody></table>
        ${editable ? `<div class="field" style="margin-top:.5rem;"><label>Ghi chú</label><input id="pr-note" value="${SM.esc(ps ? ps.note || "" : "")}"></div>` : ""}
      </div>
      <div class="mf">
        ${editable ? `<button class="btn ghost" id="pr-paidfull" style="margin-right:auto;">Đánh dấu đã trả đủ</button>
          <button class="btn ghost" id="pr-lock">${locked ? "🔓 Mở khóa" : "🔒 Chốt (khóa số buổi)"}</button>
          <button class="btn" id="pr-save">💾 Lưu phiếu</button>` : `<button class="btn ghost" data-x="close">Đóng</button>`}
        <span class="msg" id="pr-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    const updateSummary = () => {
      const adjTotal = adjSum(adjustments), total = base + adjTotal;
      const s = payStatus(total, paidLocal);
      ov.querySelector("#sum-adj").textContent = adjTotal ? (adjTotal < 0 ? "−" : "+") + SM.vnd(Math.abs(adjTotal)) : "0đ";
      ov.querySelector("#sum-total").textContent = SM.vnd(total);
      ov.querySelector("#sum-status").innerHTML = `<span class="badge ${s.c}">${s.l}</span>`;
    };
    const renderAdj = () => {
      const wrap = ov.querySelector("#adj-list");
      wrap.innerHTML = adjustments.map((a, i) => `<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.35rem;">
        <input class="adj-label" data-i="${i}" value="${SM.esc(a.label || "")}" placeholder="Lý do (vd: thưởng, phạt đi trễ)" style="flex:1;" ${editable ? "" : "disabled"}>
        <input class="adj-amt" data-i="${i}" type="number" value="${a.amount || 0}" style="width:130px;text-align:right;" ${editable ? "" : "disabled"} title="Âm = khấu trừ">
        ${editable ? `<button class="btn ghost adj-del" data-i="${i}" style="padding:.3rem .55rem;color:var(--danger)">✕</button>` : ""}</div>`).join("")
        || `<p class="muted" style="font-size:.85rem;">Chưa có điều chỉnh.</p>`;
      wrap.querySelectorAll(".adj-label").forEach(el => el.oninput = () => adjustments[+el.dataset.i].label = el.value);
      wrap.querySelectorAll(".adj-amt").forEach(el => el.oninput = () => { adjustments[+el.dataset.i].amount = Math.round(+el.value || 0); updateSummary(); });
      wrap.querySelectorAll(".adj-del").forEach(el => el.onclick = () => { adjustments.splice(+el.dataset.i, 1); renderAdj(); updateSummary(); });
    };
    renderAdj(); updateSummary();
    const addBtn = ov.querySelector("#adj-add"); if (addBtn) addBtn.onclick = () => { adjustments.push({ label: "", amount: 0 }); renderAdj(); updateSummary(); };
    const paidEl = ov.querySelector("#pr-paid"); if (paidEl) paidEl.oninput = () => { paidLocal = Math.max(0, Math.round(+paidEl.value || 0)); updateSummary(); };
    const full = ov.querySelector("#pr-paidfull"); if (full) full.onclick = () => { paidLocal = base + adjSum(adjustments); if (paidEl) paidEl.value = paidLocal; updateSummary(); };
    const lockBtn = ov.querySelector("#pr-lock"); if (lockBtn) lockBtn.onclick = () => savePayslip(!locked);
    const saveBtn = ov.querySelector("#pr-save"); if (saveBtn) saveBtn.onclick = () => savePayslip(locked);

    async function savePayslip(newLocked) {
      const say = (t, e) => { const m = ov.querySelector("#pr-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const note = (ov.querySelector("#pr-note") || {}).value || "";
      const cleanAdj = adjustments.filter(a => (a.label && a.label.trim()) || a.amount).map(a => ({ label: (a.label || "").trim(), amount: Math.round(+a.amount || 0) }));
      const adjTotal = adjSum(cleanAdj);
      // đang khóa & vẫn khóa → GIỮ ảnh chụp cũ; ngược lại chụp số live hiện tại
      const keep = locked && newLocked;
      const baseAmt = keep ? ps.base_amount : comp.base;
      const cnt = keep ? ps.session_count : comp.count;
      const det = keep ? (ps.detail || []) : comp.lines;
      const row = {
        tenant_id: ME.profile.tenant_id, teacher_id: tid, period_year: st.year, period_month: st.month,
        session_count: cnt, base_amount: baseAmt,
        adjustments: cleanAdj, adjustment_total: adjTotal, total: baseAmt + adjTotal,
        paid_amount: paidLocal, detail: det, locked: !!newLocked, note,
        created_by: ME.user.id, updated_at: new Date().toISOString()
      };
      const btns = ov.querySelectorAll(".mf .btn"); btns.forEach(b => b.disabled = true);
      const { error } = await sb.from("teacher_payslips").upsert(row, { onConflict: "tenant_id,teacher_id,period_year,period_month" });
      btns.forEach(b => b.disabled = false);
      if (error) return say("Không lưu được: " + error.message, true);
      SM.toast(newLocked && !locked ? "🔒 Đã chốt phiếu lương" : "✓ Đã lưu phiếu lương", "ok");
      ov.remove(); load();
    }
  }

  /* ---------------- TAB: ĐỊNH MỨC ---------------- */
  function paintRates() {
    const list = rates.slice().sort((a, b) => tName(a.teacher_id).localeCompare(tName(b.teacher_id)) || (a.effective_from < b.effective_from ? 1 : -1));
    box.innerHTML = tabsHtml() + `
      <div class="toolbar" style="margin-bottom:.7rem;"><button class="btn" id="rt-add">➕ Thêm định mức</button></div>
      <p class="muted" style="font-size:.86rem;margin:.1rem 0 .7rem;">Định mức theo <b>lớp</b> được ưu tiên hơn định mức <b>chung</b> của giáo viên. Khi có nhiều mốc, hệ thống lấy mốc <b>hiệu lực gần nhất ≤ ngày dạy</b>.</p>
      ${!list.length ? `<div class="card placeholder"><div class="big">⚙️</div><p>Chưa có định mức nào. Bấm ➕ Thêm định mức.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr><th>Giáo viên</th><th>Áp dụng</th><th>Loại</th><th class="r">Mức</th><th>Hiệu lực từ</th><th>Ghi chú</th><th></th></tr></thead><tbody>
          ${list.map(r => `<tr>
            <td data-th="Giáo viên"><b>${SM.esc(tName(r.teacher_id))}</b></td>
            <td data-th="Áp dụng">${r.class_id ? SM.esc(cName(r.class_id)) : '<span class="muted">Mọi lớp</span>'}</td>
            <td data-th="Loại">${r.kind === "per_hour" ? "Theo giờ" : "Theo buổi"}</td>
            <td data-th="Mức" class="r">${SM.vnd(r.amount)}${r.kind === "per_hour" ? "/h" : "/buổi"}</td>
            <td data-th="Hiệu lực từ">${SM.dmy(r.effective_from)}</td>
            <td data-th="Ghi chú">${SM.esc(r.note || "")}</td>
            <td class="cell-actions"><div class="row-actions"><button class="btn ghost" data-edit="${r.id}">Sửa</button>
              <button class="btn ghost" data-del="${r.id}" style="color:var(--danger);border-color:var(--danger)">Xóa</button></div></td></tr>`).join("")}
        </tbody></table></div>`}`;
    box.querySelector("#rt-add").onclick = () => rateForm(null);
    box.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => rateForm(rates.find(r => r.id === b.dataset.edit)));
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => delRate(rates.find(r => r.id === b.dataset.del)));
  }
  function rateForm(r) {
    const isNew = !r; r = r || {};
    const teacherOpts = teachers.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map(t => `<option value="${t.id}" ${r.teacher_id === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("");
    const classOpts = classes.filter(c => !c.archived_at).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${c.id}" ${r.class_id === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("");
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:480px;"><div class="mh"><h3>${isNew ? "➕ Thêm định mức" : "✏️ Sửa định mức"}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field" style="grid-column:1/-1"><label>Giáo viên *</label><select id="r-teacher"><option value="">— chọn —</option>${teacherOpts}</select></div>
        <div class="field" style="grid-column:1/-1"><label>Áp dụng cho lớp</label><select id="r-class"><option value="">— Mọi lớp của GV —</option>${classOpts}</select></div>
        <div class="field"><label>Loại</label><select id="r-kind"><option value="per_session" ${r.kind !== "per_hour" ? "selected" : ""}>Theo buổi</option><option value="per_hour" ${r.kind === "per_hour" ? "selected" : ""}>Theo giờ</option></select></div>
        <div class="field"><label>Mức (VND)</label><input id="r-amount" type="number" min="0" value="${r.amount != null ? r.amount : 0}"></div>
        <div class="field"><label>Hiệu lực từ (DD/MM/YYYY)</label><input id="r-from" value="${r.effective_from ? SM.dmy(r.effective_from) : SM.dmy(SM.todayISO())}"></div>
        <div class="field"><label>Ghi chú</label><input id="r-note" value="${SM.esc(r.note || "")}"></div>
      </div></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="r-save">💾 Lưu</button><span class="msg" id="r-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#r-save").onclick = async () => {
      const V = id => ov.querySelector("#" + id).value;
      const say = (t, e) => { const m = ov.querySelector("#r-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const teacher = V("r-teacher"); if (!teacher) return say("Chọn giáo viên.", true);
      const from = SM.parseDmy(V("r-from").trim()); if (!from) return say("Ngày hiệu lực không hợp lệ.", true);
      const row = { teacher_id: teacher, class_id: V("r-class") || null, kind: V("r-kind"),
        amount: Math.max(0, Math.round(+V("r-amount") || 0)), effective_from: from, note: V("r-note").trim(), tenant_id: ME.profile.tenant_id };
      ov.querySelector("#r-save").disabled = true;
      let error;
      if (r.id) ({ error } = await sb.from("teacher_rates").update(row).eq("id", r.id));
      else ({ error } = await sb.from("teacher_rates").insert(row));
      ov.querySelector("#r-save").disabled = false;
      if (error) return say("Không lưu được: " + error.message, true);
      ov.remove(); SM.toast("✓ Đã lưu định mức", "ok"); load();
    };
  }
  async function delRate(r) {
    if (!r) return;
    const ok = await SM.confirmDialog({ title: "Xóa định mức?", danger: true, okText: "Xóa", body: `Xóa định mức của <b>${SM.esc(tName(r.teacher_id))}</b>${r.class_id ? " · lớp " + SM.esc(cName(r.class_id)) : ""}. Phiếu lương đã chốt không đổi.` });
    if (!ok) return;
    const { error } = await sb.from("teacher_rates").delete().eq("id", r.id);
    if (error) return SM.toast("Không xóa được: " + error.message, "err");
    SM.toast("🗑 Đã xóa định mức", "ok"); load();
  }

  return {
    _calc: { resolveRate, computeAll, hoursOf, payStatus },   // để kiểm thử
    render(el, me) { ME = me; box = el; st.tab = "run"; st.teacher = ""; st.cls = ""; st.from = ""; st.to = ""; load(); }
  };
})();

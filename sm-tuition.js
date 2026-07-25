/* ============================================================
   Giai đoạn 6 — Học phí & hóa đơn tháng
   • Mức phí có ngày hiệu lực (tuition_rates) + cấu hình buổi nào tính phí.
   • Tính hóa đơn tháng cho từng (học viên × lớp): nháp → chốt.
     Nháp có thể tính lại/xóa; đã chốt là BẤT BIẾN (sửa qua điều chỉnh GĐ7).
   Toàn bộ phép tính tiền nằm ở computeInvoice() — hàm thuần, đã kiểm thử.
   ============================================================ */
window.Tuition = (function () {
  let ME = null, box = null;
  const st = { tab: "invoices", year: 0, month: 0, classId: "", rateClass: "" };
  let classes = [], invoices = [], busy = false;

  const METHOD = { per_scheduled: "Theo buổi có lịch", per_attended: "Theo buổi học thực tế",
                   per_cycle: "Theo chu kỳ (mỗi X buổi)",
                   fixed_monthly: "Cố định mỗi tháng", fixed_course: "Trọn khóa", custom: "Tùy học viên" };
  const PER_SESSION = new Set(["per_scheduled", "per_attended", "per_cycle"]);

  // Tính một CHU KỲ: lấy N buổi đầu (bỏ buổi hủy; nếu không tính tương lai thì chỉ tới hôm nay).
  // sessions: đã sắp tăng dần theo ngày. Trả về ids của chu kỳ + ngày đầu/cuối + số đếm + ngày bắt đầu kỳ sau.
  function cycleFrom(sessions, n, includeFuture, today) {
    const avail = (sessions || []).filter(s => s.status !== "cancelled" && (includeFuture || s.date <= today))
      .sort((a, b) => a.date === b.date ? (a.start_time < b.start_time ? -1 : 1) : (a.date < b.date ? -1 : 1));
    const cyc = avail.slice(0, n);
    const next = avail[n];
    return {
      ids: new Set(cyc.map(s => s.id)),
      billFrom: cyc.length ? cyc[0].date : null,
      billTo: cyc.length ? cyc[cyc.length - 1].date : null,
      counted: cyc.length, complete: cyc.length >= n,
      nextStart: next ? next.date : null
    };
  }
  const ISTATUS = {
    draft:          { l: "Nháp",          c: "warn" },
    unpaid:         { l: "Chưa thu",      c: "bad"  },
    partially_paid: { l: "Thu một phần",  c: "warn" },
    paid:           { l: "Đã thanh toán", c: "ok"   },
    overdue:        { l: "Quá hạn",       c: "bad"  },
    waived:         { l: "Không phát sinh",c: "mute" },
    cancelled:      { l: "Đã hủy",        c: "mute" }
  };
  const ATT_SHORT = { present: "Có mặt", late: "Muộn", left_early: "Về sớm",
                      authorised_absence: "Vắng CP", unauthorised_absence: "Vắng KP",
                      makeup: "Học bù", cancelled: "Hủy" };
  const DEFAULT_FLAGS = { charge_present: true, charge_authorised_absence: false, charge_unauthorised_absence: true,
                          charge_cancelled: false, charge_makeup: false, charge_extra: true };

  const cName = id => (classes.find(c => c.id === id) || {}).name || "—";
  const cls = id => classes.find(c => c.id === id) || {};
  const fmtDate = d => SM.dmy(d).slice(0, 5);   // DD/MM
  const MONTHS = Array.from({ length: 12 }, (_, i) => "Tháng " + (i + 1));

  function monthRange(y, m) {
    const s = y + "-" + String(m).padStart(2, "0") + "-01";
    const last = new Date(y, m, 0).getDate();
    const e = y + "-" + String(m).padStart(2, "0") + "-" + String(last).padStart(2, "0");
    return { start: s, end: e };
  }

  /* ============ PHÉP TÍNH TIỀN — HÀM THUẦN (đã kiểm thử) ============ */
  // ctx = { cls, enr, sessions, rates, attMap, year, month }
  // trả về { subtotal, discount, total, lines[], other[], skipped[], winStart, winEnd }
  function computeInvoice(ctx) {
    const { cls: c, enr, sessions, rates, attMap, year, month, chargeSet } = ctx;
    const { start: ms, end: me } = monthRange(year, month);
    const winStart = (enr.joined_on > ms) ? enr.joined_on : ms;
    const leftCap = enr.left_on && enr.left_on < me ? enr.left_on : me;
    const winEnd = leftCap;
    const method = c.tuition_method;
    const sorted = (rates || []).slice().sort((a, b) => a.effective_from < b.effective_from ? -1 : 1);
    const rateFor = d => { let r = null; for (const x of sorted) { if (x.effective_from <= d) r = x; else break; } return r; };
    const flagsOf = r => r || DEFAULT_FLAGS;
    const lines = [], skipped = [];
    let subtotal = 0;

    if (PER_SESSION.has(method) && chargeSet) {
      // CHỌN TAY: tính đúng các buổi đã tick (bỏ buổi hủy), không phụ thuộc điểm danh/ngày ghi danh.
      const list = (sessions || []).filter(s => chargeSet.has(s.id) && s.status !== "cancelled")
        .sort((a, b) => a.date === b.date ? (a.start_time < b.start_time ? -1 : 1) : (a.date < b.date ? -1 : 1));
      for (const s of list) {
        const r = rateFor(s.date);
        const unit = (enr.tuition_override > 0 ? enr.tuition_override : (r ? r.amount : c.tuition_amount)) || 0;
        subtotal += unit;
        lines.push({ kind: "lesson", quantity: 1, unit_amount: unit, amount: unit,
          description: fmtDate(s.date) + (s.type === "makeup" ? " · bù" : s.type === "extra" ? " · thêm" : "") });
      }
    } else if (PER_SESSION.has(method)) {
      const inWin = (sessions || []).filter(s => s.date >= winStart && s.date <= winEnd)
        .sort((a, b) => a.date === b.date ? (a.start_time < b.start_time ? -1 : 1) : (a.date < b.date ? -1 : 1));
      for (const s of inWin) {
        const r = rateFor(s.date), f = flagsOf(r);
        let eff;
        if (s.status === "cancelled") eff = "cancelled";
        else {
          const rec = attMap[s.id];
          if (rec) eff = rec;
          else if (method === "per_attended") { skipped.push({ date: s.date, reason: "chưa điểm danh" }); continue; }
          else eff = "present";                       // per_scheduled: chưa điểm danh coi như có mặt
        }
        let charge;
        if (s.type === "extra") charge = f.charge_extra;
        else if (s.type === "makeup") charge = f.charge_makeup;
        else if (eff === "cancelled") charge = f.charge_cancelled;
        else if (eff === "present" || eff === "late" || eff === "left_early" || eff === "makeup") charge = f.charge_present;
        else if (eff === "authorised_absence") charge = f.charge_authorised_absence;
        else if (eff === "unauthorised_absence") charge = f.charge_unauthorised_absence;
        else charge = true;
        if (!charge) { skipped.push({ date: s.date, reason: "không tính (" + (ATT_SHORT[eff] || eff) + ")" }); continue; }
        const unit = (enr.tuition_override > 0 ? enr.tuition_override : (r ? r.amount : c.tuition_amount)) || 0;
        subtotal += unit;
        lines.push({ kind: "lesson", quantity: 1, unit_amount: unit, amount: unit,
          description: fmtDate(s.date) + " · " + (ATT_SHORT[eff] || eff) + (s.type === "makeup" ? " (bù)" : s.type === "extra" ? " (thêm)" : "") });
      }
    } else if (method === "fixed_monthly" || method === "custom") {
      const unit = (enr.tuition_override > 0 ? enr.tuition_override : c.tuition_amount) || 0;
      subtotal = unit;
      lines.push({ kind: "lesson", quantity: 1, unit_amount: unit, amount: unit, description: "Học phí tháng " + month + "/" + year });
    } else if (method === "fixed_course") {
      if (enr.joined_on.slice(0, 7) === ms.slice(0, 7)) {
        const unit = (enr.tuition_override > 0 ? enr.tuition_override : c.tuition_amount) || 0;
        subtotal = unit;
        lines.push({ kind: "lesson", quantity: 1, unit_amount: unit, amount: unit, description: "Học phí trọn khóa (thu 1 lần)" });
      }
    }

    // giảm giá / học bổng từ ghi danh
    let discount = 0; const dparts = [];
    if (enr.discount_percent > 0) { discount += Math.round(subtotal * enr.discount_percent / 100); dparts.push(enr.discount_percent + "%"); }
    if (enr.discount_amount > 0) { discount += enr.discount_amount; dparts.push(SM.vnd(enr.discount_amount)); }
    if (discount > subtotal) discount = subtotal;
    const other = [];
    if (discount > 0) other.push({ kind: "discount", quantity: 1, unit_amount: -discount, amount: -discount,
      description: "Giảm giá" + (dparts.length ? " (" + dparts.join(" + ") + ")" : "") + (enr.scholarship_note ? " · " + enr.scholarship_note : "") });

    return { subtotal, discount, total: subtotal - discount, lines, other, skipped, winStart, winEnd };
  }

  /* ============ TẢI DỮ LIỆU ĐỂ TÍNH 1 LỚP ============ */
  async function loadClassBilling(classId, from, to) {
    const [sess, rates] = await Promise.all([
      sb.from("sessions").select("id,date,start_time,end_time,type,status").eq("class_id", classId).gte("date", from).lte("date", to).order("date"),
      sb.from("tuition_rates").select("*").eq("class_id", classId).order("effective_from")
    ]);
    return { sessions: sess.data || [], rates: rates.data || [] };
  }

  // Tính (hoặc tính lại) hóa đơn NHÁP cho 1 học viên. Không đụng hóa đơn đã chốt.
  // opts = { billFrom, billTo, chargeSet (Set|null), sessions, rates }.
  //  - chargeSet có → chọn tay: tính đúng các buổi được tick trong [billFrom,billTo].
  //  - chargeSet null → tự động theo điểm danh + khung ghi danh (như cũ).
  async function buildInvoice(studentId, classId, year, month, opts) {
    const c = cls(classId);
    opts = opts || {};
    const billFrom = opts.billFrom || monthRange(year, month).start;   // khóa chống trùng + mốc kỳ
    const billTo = opts.billTo || monthRange(year, month).end;
    const py = +billFrom.slice(0, 4), pm = +billFrom.slice(5, 7);       // kỳ hiển thị = tháng của billFrom
    // ghi danh giao với khoảng tính phí
    const { data: enr } = await sb.from("enrollments").select("*")
      .eq("student_id", studentId).eq("class_id", classId)
      .lte("joined_on", billTo).order("joined_on", { ascending: false }).limit(1).maybeSingle();
    if (!enr || (enr.left_on && enr.left_on < billFrom)) return { skipped: true, reason: "không có ghi danh trong kỳ" };

    const { sessions, rates } = (opts.sessions ? { sessions: opts.sessions, rates: opts.rates } : await loadClassBilling(classId, billFrom, billTo));
    const chargeSet = opts.chargeSet || null;
    const attMap = {};
    if (!chargeSet) {   // chế độ tự động cần điểm danh
      const sessIds = sessions.map(s => s.id);
      if (sessIds.length) {
        const { data: at } = await sb.from("attendance").select("session_id,status").eq("student_id", studentId).in("session_id", sessIds);
        (at || []).forEach(a => attMap[a.session_id] = a.status);
      }
    }
    const r = computeInvoice({ cls: c, enr, sessions, rates, attMap, year: py, month: pm, chargeSet });

    // hóa đơn hiện có? (khóa theo ngày bắt đầu kỳ)
    const { data: ex } = await sb.from("invoices").select("id,status")
      .eq("student_id", studentId).eq("class_id", classId).eq("bill_from", billFrom).maybeSingle();
    if (ex && ex.status !== "draft" && ex.status !== "cancelled") return { skipped: true, reason: "đã chốt (" + (ISTATUS[ex.status] || {}).l + ")" };

    let invId = ex ? ex.id : null;
    const now = new Date().toISOString();
    if (!invId) {
      const { data, error } = await sb.from("invoices").insert({
        student_id: studentId, class_id: classId, period_year: py, period_month: pm,
        bill_from: billFrom, bill_to: billTo, status: "draft", created_by: ME.user.id
      }).select("id").single();
      if (error) throw error; invId = data.id;
    } else {
      await sb.from("invoices").update({ status: "draft", bill_to: billTo, period_year: py, period_month: pm, updated_at: now }).eq("id", invId);
      await sb.from("invoice_lines").delete().eq("invoice_id", invId);
    }
    const allLines = r.lines.concat(r.other).map(l => ({ invoice_id: invId, kind: l.kind, description: l.description, quantity: l.quantity, unit_amount: l.unit_amount, amount: l.amount }));
    if (allLines.length) { const { error } = await sb.from("invoice_lines").insert(allLines); if (error) throw error; }
    await sb.from("invoices").update({
      subtotal: r.subtotal, discount_total: r.discount, credit_applied: 0, adjustment_total: 0, total: r.total, updated_at: now
    }).eq("id", invId);
    return { id: invId, total: r.total, built: true };
  }

  // Tính hóa đơn nháp cho MỌI học viên của 1 lớp.
  //  o = { loadFrom, loadTo, chargeSet, billFrom, billTo }
  //    - loadFrom/loadTo: khoảng nạp buổi học.
  //    - chargeSet: buổi cần tính (null → mọi buổi không hủy trong khoảng nạp).
  //    - billFrom/billTo: mốc kỳ ghi lên hóa đơn (khóa chống trùng).
  async function buildForClass(classId, o) {
    const c = cls(classId);
    const { sessions, rates } = await loadClassBilling(classId, o.loadFrom, o.loadTo);
    const set = o.chargeSet || new Set(sessions.filter(s => s.status !== "cancelled").map(s => s.id));
    const billFrom = o.billFrom || o.loadFrom, billTo = o.billTo || o.loadTo;
    const { data: enr } = await sb.from("enrollments").select("student_id,joined_on,left_on")
      .eq("class_id", classId).lte("joined_on", billTo);
    const students = [...new Set((enr || []).filter(e => !e.left_on || e.left_on >= billFrom).map(e => e.student_id))];
    if (!students.length) return { built: 0, skipped: 0, total: 0, name: c.name };
    const opts = { billFrom, billTo, chargeSet: set, sessions, rates };
    let built = 0, skipped = 0, sum = 0;
    for (const sid of students) {
      try {
        const res = await buildInvoice(sid, classId, +billFrom.slice(0, 4), +billFrom.slice(5, 7), opts);
        if (res.built) { built++; sum += res.total; } else skipped++;
      } catch (e) { skipped++; SM.toast("Lỗi tính cho 1 học viên: " + (e.message || e), "err"); }
    }
    return { built, skipped, total: sum, name: c.name };
  }

  /* ============ TAB HÓA ĐƠN ============ */
  function tabsHtml() {
    const T = [["invoices", "🧾 Hóa đơn tháng"], ["rates", "💰 Mức phí"]];
    return `<h1 style="margin:.2rem 0 .7rem;">Học phí</h1>
      <div class="toolbar">${T.map(([k, v]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${v}</button>`).join("")}</div>`;
  }

  async function loadInvoices() {
    busy = true; paintInvoices();
    let q = sb.from("invoices").select("*, student:students(code,full_name), klass:classes(name)")
      .eq("period_year", st.year).eq("period_month", st.month).order("created_at");
    if (st.classId) q = q.eq("class_id", st.classId);
    const { data, error } = await q;
    busy = false;
    invoices = error ? [] : (data || []);
    if (error) SM.toast("Lỗi tải hóa đơn: " + error.message, "err");
    paintInvoices();
  }

  function paintInvoices() {
    const sum = invoices.reduce((a, i) => { a.total += i.total; a[i.status] = (a[i.status] || 0) + 1; a.n++; return a; }, { total: 0, n: 0 });
    const drafts = invoices.filter(i => i.status === "draft").length;
    let table;
    if (busy) table = `<div class="card placeholder"><span class="spinner"></span></div>`;
    else if (!invoices.length) table = `<div class="card placeholder"><div class="big">🧾</div>
        <p>Chưa có hóa đơn nào cho ${MONTHS[st.month - 1]}/${st.year}${st.classId ? " · " + SM.esc(cName(st.classId)) : ""}.</p>
        <p class="muted">Chọn một lớp rồi bấm <b>⚡ Tính hóa đơn nháp</b> để tạo.</p></div>`;
    else table = `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Mã</th><th>Học viên</th><th>Lớp</th><th>Tạm tính</th><th>Giảm</th><th>Phải thu</th><th>Trạng thái</th><th></th>
      </tr></thead><tbody>
        ${invoices.map(i => `<tr>
          <td data-th="Mã"><code>${SM.esc(i.student ? i.student.code : "")}</code></td>
          <td data-th="Học viên"><b>${SM.esc(i.student ? i.student.full_name : "—")}</b></td>
          <td data-th="Lớp">${SM.esc(i.klass ? i.klass.name : cName(i.class_id))}</td>
          <td data-th="Tạm tính">${SM.vnd(i.subtotal)}</td>
          <td data-th="Giảm">${i.discount_total ? "−" + SM.vnd(i.discount_total) : "—"}</td>
          <td data-th="Phải thu"><b>${SM.vnd(i.total)}</b></td>
          <td data-th="Trạng thái"><span class="badge ${(ISTATUS[i.status] || {}).c || "mute"}">${(ISTATUS[i.status] || {}).l || i.status}</span></td>
          <td class="cell-actions"><div class="row-actions"><button class="btn ghost" data-inv="${i.id}">Xem</button></div></td>
        </tr>`).join("")}
      </tbody></table></div>`;

    box.innerHTML = tabsHtml() + `
      <div class="cal-head">
        <div class="row-actions">
          <button class="btn ghost" data-nav="prev">‹</button>
          <button class="btn ghost" data-nav="now">Tháng này</button>
          <button class="btn ghost" data-nav="next">›</button>
        </div>
        <div class="field" style="margin:0;"><select id="i-month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${st.month === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;"><input id="i-year" type="number" value="${st.year}" style="width:90px;"></div>
        <div class="field" style="margin:0;"><select id="i-class"><option value="">Tất cả lớp</option>
          ${classes.map(c => `<option value="${c.id}" ${st.classId === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}</select></div>
        <span style="flex:1"></span>
        <button class="btn" data-act="build">⚡ Tính hóa đơn nháp${st.classId ? "" : " (tất cả lớp)"}</button>
        ${drafts ? `<button class="btn ghost" data-act="finalizeall">🔒 Chốt tất cả nháp (${drafts})</button>` : ""}
      </div>
      ${invoices.length ? `<p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">
        ${sum.n} hóa đơn · tổng phải thu <b>${SM.vnd(sum.total)}</b>
        ${sum.draft ? ` · <span class="badge warn">${sum.draft} nháp</span>` : ""}
        ${sum.unpaid ? ` · <span class="badge bad">${sum.unpaid} chưa thu</span>` : ""}
        ${sum.paid ? ` · <span class="badge ok">${sum.paid} đã thu</span>` : ""}</p>` : ""}
      ${table}`;

    const im = box.querySelector("#i-month"), iy = box.querySelector("#i-year"), ic = box.querySelector("#i-class");
    if (im) im.addEventListener("change", () => { st.month = +im.value; loadInvoices(); });
    if (iy) iy.addEventListener("change", () => { const v = parseInt(iy.value, 10); if (v > 2000 && v < 2100) { st.year = v; loadInvoices(); } });
    if (ic) ic.addEventListener("change", () => { st.classId = ic.value; loadInvoices(); });
  }

  function doBuild() { genDialog(st.classId || null); }

  const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const addDaysISO = (s, nn) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + nn); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  // Hộp thoại tính hóa đơn:
  //  • Lớp "theo chu kỳ" (per_cycle): tự tính N buổi từ ngày bắt đầu → khoảng kỳ + kỳ sau.
  //  • Lớp theo buổi khác: chọn khoảng ngày + tick từng buổi.
  //  • Lớp cố định / tất cả lớp: gọn hơn.
  async function genDialog(classId) {
    const single = !!classId;
    const c = single ? cls(classId) : null;
    const perSession = single ? PER_SESSION.has(c.tuition_method) : true;
    const cycle = single && c.tuition_method === "per_cycle";
    const { start: ms, end: me } = monthRange(st.year, st.month);
    const today = SM.todayISO();
    let from = ms, to = me, includeFuture = true, n = 12;
    let sessions = [], rates = [];
    const checked = new Set();
    const rateFor = d => { let r = null; for (const x of rates.slice().sort((a, b) => a.effective_from < b.effective_from ? -1 : 1)) { if (x.effective_from <= d) r = x; else break; } return r; };
    const unitFor = d => { const r = rateFor(d); return (r ? r.amount : (c ? c.tuition_amount : 0)) || 0; };
    const effTo = () => includeFuture ? to : (to < today ? to : today);
    const availList = () => sessions.filter(s => includeFuture || s.date <= today);

    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:560px;"><div class="mh">
        <h3>⚡ Tính hóa đơn nháp${single ? " · " + SM.esc(c.name) : " · tất cả lớp"}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb" id="gen-body"><div class="card placeholder"><span class="spinner"></span></div></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    const body = ov.querySelector("#gen-body");

    // gợi ý ngày bắt đầu cho lớp theo chu kỳ: sau buổi cuối đã lên hóa đơn (nếu có), nếu không thì ngày cấu hình.
    if (cycle) {
      n = c.billing_cycle || 12;
      includeFuture = c.billing_include_future !== false;
      const { data: last } = await sb.from("invoices").select("bill_to").eq("class_id", classId).not("bill_to", "is", null).order("bill_to", { ascending: false }).limit(1).maybeSingle();
      from = (last && last.bill_to) ? addDaysISO(last.bill_to, 1) : (c.billing_start || ms);
    }

    async function reload() {
      if (single && perSession) {
        const loadTo = cycle ? addDaysISO(from, 420) : effTo();
        const r = await loadClassBilling(classId, from, loadTo);
        sessions = (r.sessions || []).filter(s => s.status !== "cancelled")
          .sort((a, b) => a.date === b.date ? (a.start_time < b.start_time ? -1 : 1) : (a.date < b.date ? -1 : 1));
        rates = r.rates;
        checked.clear();
        if (cycle) cycleFrom(sessions, n, includeFuture, today).ids.forEach(id => checked.add(id));
        else sessions.forEach(s => checked.add(s.id));
      }
      render();
    }

    function selInfo() {
      const sel = sessions.filter(s => checked.has(s.id)).sort((a, b) => a.date < b.date ? -1 : 1);
      const units = sel.map(s => unitFor(s.date));
      const uniq = [...new Set(units)];
      const av = availList();
      const billTo = sel.length ? sel[sel.length - 1].date : null;
      const next = billTo ? (av.find(s => s.date > billTo) || null) : null;
      return { sel, count: sel.length, total: units.reduce((a, b) => a + b, 0),
        price: uniq.length === 0 ? "—" : uniq.length === 1 ? SM.vnd(uniq[0]) : "nhiều mức",
        billFrom: sel.length ? sel[0].date : null, billTo, nextStart: next ? next.date : null };
    }

    function summaryHtml() {
      const future = includeFuture ? "Có" : "Không";
      if (cycle) {
        const i = selInfo();
        return `<table class="inv-lines">
          <tr><td>Bắt đầu kỳ</td><td class="r">${SM.dmy(from)}</td></tr>
          <tr><td>Số buổi / chu kỳ</td><td class="r">${n}</td></tr>
          <tr><td>Khoảng tính phí</td><td class="r">${i.billFrom ? SM.dmy(i.billFrom) + " – " + SM.dmy(i.billTo) : "—"}</td></tr>
          <tr><td>Số buổi đã đếm</td><td class="r"><b>${i.count} / ${n}</b>${i.count < n ? ' <span class="badge warn">chưa đủ</span>' : ""}</td></tr>
          <tr><td>Đơn giá</td><td class="r">${i.price}</td></tr>
          <tr><td>Tính buổi tương lai</td><td class="r">${future}</td></tr>
          <tr class="tot"><td>Tổng học phí (tạm tính)</td><td class="r">${SM.vnd(i.total)}</td></tr>
          <tr><td>Kỳ sau bắt đầu</td><td class="r">${i.nextStart ? SM.dmy(i.nextStart) : "chưa có buổi kế tiếp"}</td></tr>
        </table><p class="muted" style="font-size:.8rem;margin:.3rem 0 0;">Giảm giá riêng của học viên (nếu có) sẽ trừ thêm khi tạo hóa đơn.</p>`;
      }
      if (single && perSession) {
        const i = selInfo();
        return `<table class="inv-lines">
          <tr><td>Kỳ hóa đơn</td><td class="r">${MONTHS[st.month - 1]}/${st.year}</td></tr>
          <tr><td>Khoảng tính phí</td><td class="r">${SM.dmy(from)} – ${SM.dmy(effTo())}</td></tr>
          <tr><td>Số buổi tính phí</td><td class="r"><b>${i.count}</b></td></tr>
          <tr><td>Đơn giá</td><td class="r">${i.price}</td></tr>
          <tr><td>Tính buổi tương lai</td><td class="r">${future}</td></tr>
          <tr class="tot"><td>Tổng học phí (tạm tính)</td><td class="r">${SM.vnd(i.total)}</td></tr>
        </table><p class="muted" style="font-size:.8rem;margin:.3rem 0 0;">Giảm giá riêng của học viên (nếu có) sẽ trừ thêm khi tạo hóa đơn.</p>`;
      }
      if (single) return `<table class="inv-lines">
          <tr><td>Kỳ hóa đơn</td><td class="r">${MONTHS[st.month - 1]}/${st.year}</td></tr>
          <tr><td>Cách tính</td><td class="r">${METHOD[c.tuition_method]}</td></tr>
          <tr class="tot"><td>Học phí</td><td class="r">${SM.vnd(c.tuition_amount)}</td></tr>
        </table><p class="muted" style="font-size:.82rem;">Mức cố định; giảm giá riêng của học viên áp dụng khi tạo.</p>`;
      return `<p class="muted" style="font-size:.86rem;">Sẽ tạo hóa đơn nháp cho <b>mọi lớp đang hoạt động</b>, tính tất cả buổi trong khoảng ${SM.dmy(from)} – ${SM.dmy(effTo())}${includeFuture ? "" : " (đến hôm nay)"}.</p>`;
    }

    function render() {
      const rows = cycle ? availList().slice(0, n + 6) : sessions;
      body.innerHTML = `
        ${cycle ? `<div class="grid2">
            <div class="field"><label>Ngày bắt đầu kỳ (DD/MM/YYYY)</label><input id="g-from" value="${SM.dmy(from)}"></div>
            <div class="field"><label>Số buổi / chu kỳ</label><input id="g-n" type="number" min="1" value="${n}"></div>
          </div>`
          : `<div class="grid2">
            <div class="field"><label>Từ ngày (DD/MM/YYYY)</label><input id="g-from" value="${SM.dmy(from)}"></div>
            <div class="field"><label>Đến ngày (DD/MM/YYYY)</label><input id="g-to" value="${SM.dmy(to)}"></div>
          </div>`}
        <label style="display:flex;align-items:center;gap:.5rem;font-weight:600;margin:.1rem 0 .6rem;">
          <input type="checkbox" id="g-future" ${includeFuture ? "checked" : ""} style="width:auto"> Tính cả buổi trong tương lai (chưa diễn ra)</label>
        ${single && perSession ? `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
            <b style="font-size:.9rem;">${cycle ? "Buổi trong chu kỳ" : "Chọn buổi tính phí"} (${rows.length})</b>
            <span class="row-actions"><button class="btn ghost" data-g="all" style="padding:.2rem .5rem;font-size:.8rem;">Chọn tất cả</button>
              <button class="btn ghost" data-g="none" style="padding:.2rem .5rem;font-size:.8rem;">Bỏ chọn</button></span></div>
          <div id="g-list" class="card" style="max-height:220px;overflow:auto;padding:.3rem .5rem;margin:.4rem 0 .7rem;">
            ${rows.length ? rows.map((s, idx) => `<label class="g-row" style="display:flex;align-items:center;gap:.6rem;padding:.32rem .2rem;border-bottom:1px solid var(--line);cursor:pointer;${s.date > today ? "opacity:.85" : ""}">
                <input type="checkbox" data-sess="${s.id}" ${checked.has(s.id) ? "checked" : ""} style="width:auto">
                ${cycle ? `<span class="muted" style="min-width:52px;font-size:.8rem;">Buổi ${idx + 1}</span>` : ""}
                <b style="min-width:74px;">${SM.dmy(s.date).slice(0, 5)} ${WD[new Date(s.date + "T00:00:00").getDay()]}</b>
                <span class="muted" style="font-size:.82rem;flex:1;">${SM.hm(s.start_time)}–${SM.hm(s.end_time)}${s.type !== "regular" ? " · " + (s.type === "makeup" ? "bù" : "thêm") : ""}${s.date > today ? " · sắp tới" : ""}</span>
                <span>${SM.vnd(unitFor(s.date))}</span>
              </label>`).join("") : `<p class="muted" style="padding:.6rem">Không có buổi học nào trong khoảng này.</p>`}
          </div>` : ""}
        <div id="g-summary">${summaryHtml()}</div>`;

      const gf = body.querySelector("#g-from"), gt = body.querySelector("#g-to"), fut = body.querySelector("#g-future"), gn = body.querySelector("#g-n");
      gf.addEventListener("change", () => { const v = SM.parseDmy(gf.value.trim()); if (v) { from = v; reload(); } else { gf.value = SM.dmy(from); } });
      if (gt) gt.addEventListener("change", () => { const v = SM.parseDmy(gt.value.trim()); if (v) { to = v; reload(); } else { gt.value = SM.dmy(to); } });
      if (gn) gn.addEventListener("change", () => { const v = parseInt(gn.value, 10); if (v > 0) { n = v; reload(); } else { gn.value = n; } });
      fut.addEventListener("change", () => { includeFuture = fut.checked; reload(); });
      body.querySelectorAll("[data-sess]").forEach(cb => cb.addEventListener("change", () => {
        cb.checked ? checked.add(cb.dataset.sess) : checked.delete(cb.dataset.sess);
        body.querySelector("#g-summary").innerHTML = summaryHtml();
      }));
      const ga = body.querySelector('[data-g="all"]'), gnb = body.querySelector('[data-g="none"]');
      if (ga) ga.addEventListener("click", () => { rows.forEach(s => checked.add(s.id)); render(); });
      if (gnb) gnb.addEventListener("click", () => { rows.forEach(s => checked.delete(s.id)); render(); });
    }

    ov.querySelector(".sm-modal").insertAdjacentHTML("beforeend",
      `<div class="mf"><button class="btn ghost" data-x="close">Hủy</button>
        <button class="btn" id="g-go">⚡ Tạo hóa đơn nháp</button>
        <span class="msg" id="g-msg" style="align-self:center"></span></div>`);
    ov.querySelector('[data-x="close"]').onclick = () => ov.remove();
    ov.querySelector("#g-go").addEventListener("click", async () => {
      const say = (t, e) => { const m = ov.querySelector("#g-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const btn = ov.querySelector("#g-go"); btn.disabled = true; say("Đang tính…");
      let built = 0, skipped = 0;
      try {
        if (cycle) {
          const i = selInfo();
          if (!i.count) { btn.disabled = false; return say("Chưa có buổi nào để tính.", true); }
          const r = await buildForClass(classId, { loadFrom: i.billFrom, loadTo: i.billTo, chargeSet: new Set([...checked]), billFrom: i.billFrom, billTo: i.billTo });
          built = r.built; skipped = r.skipped;
        } else if (single) {
          if (to < from) { btn.disabled = false; return say("Đến ngày phải sau Từ ngày.", true); }
          const eff = effTo();
          const set = perSession ? new Set([...checked]) : new Set();
          const r = await buildForClass(classId, { loadFrom: from, loadTo: eff, chargeSet: perSession ? set : new Set(), billFrom: ms, billTo: eff });
          built = r.built; skipped = r.skipped;
        } else {
          if (to < from) { btn.disabled = false; return say("Đến ngày phải sau Từ ngày.", true); }
          const eff = effTo();
          for (const cc of classes.filter(x => x.status !== "completed")) {
            const r = await buildForClass(cc.id, { loadFrom: from, loadTo: eff, chargeSet: null, billFrom: ms, billTo: eff });
            built += r.built; skipped += r.skipped;
          }
        }
      } catch (e) { btn.disabled = false; return say("Lỗi: " + (e.message || e), true); }
      ov.remove();
      SM.toast(`✓ Đã tính ${built} hóa đơn nháp` + (skipped ? ` · bỏ qua ${skipped}` : ""), "ok");
      loadInvoices();
    });

    reload();
  }

  async function invoiceDetail(id) {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>Hóa đơn</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="card placeholder"><span class="spinner"></span></div></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    const { data: inv } = await sb.from("invoices").select("*, student:students(code,full_name), klass:classes(name)").eq("id", id).single();
    const { data: lines } = await sb.from("invoice_lines").select("*").eq("invoice_id", id).order("created_at");
    const stt = ISTATUS[inv.status] || { l: inv.status, c: "mute" };
    const isDraft = inv.status === "draft";
    const lessons = (lines || []).filter(l => l.kind === "lesson");
    const others = (lines || []).filter(l => l.kind !== "lesson");
    // gộp dòng bài học theo đơn giá cho gọn
    const groups = {};
    lessons.forEach(l => { const k = l.unit_amount; (groups[k] = groups[k] || { qty: 0, unit: l.unit_amount, amount: 0 }); groups[k].qty += Number(l.quantity); groups[k].amount += l.amount; });
    const grpArr = Object.values(groups).sort((a, b) => b.unit - a.unit);

    ov.querySelector(".sm-modal").innerHTML = `
      <div class="mh"><h3>Hóa đơn · ${SM.esc(inv.student ? inv.student.full_name : "")}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .3rem;">${SM.esc(inv.klass ? inv.klass.name : cName(inv.class_id))} · Kỳ <b>${MONTHS[inv.period_month - 1]}/${inv.period_year}</b>
          ${inv.bill_from && inv.bill_to ? `· <span class="muted">buổi ${SM.dmy(inv.bill_from)}–${SM.dmy(inv.bill_to)}</span>` : ""}
          · <span class="badge ${stt.c}">${stt.l}</span>${inv.finalized_at ? ` · chốt ngày ${SM.dmy(inv.finalized_at)}` : ""}${inv.due_date ? ` · hạn ${SM.dmy(inv.due_date)}` : ""}</p>
        ${!lessons.length && !others.length ? `<p class="muted">Không có khoản phí nào phát sinh trong kỳ này.</p>`
          : `<table class="inv-lines">
              ${grpArr.map(g => `<tr><td>${g.qty} buổi tính phí × ${SM.vnd(g.unit)}</td><td class="r">${SM.vnd(g.amount)}</td></tr>`).join("")}
              ${others.map(o => `<tr><td>${SM.esc(o.description)}</td><td class="r">${o.amount < 0 ? "−" : ""}${SM.vnd(Math.abs(o.amount))}</td></tr>`).join("")}
              <tr class="sub"><td>Tạm tính</td><td class="r">${SM.vnd(inv.subtotal)}</td></tr>
              ${inv.discount_total ? `<tr><td>Tổng giảm</td><td class="r">−${SM.vnd(inv.discount_total)}</td></tr>` : ""}
              ${inv.adjustment_total ? `<tr><td>Điều chỉnh</td><td class="r">${SM.vnd(inv.adjustment_total)}</td></tr>` : ""}
              <tr class="tot"><td>Phải thanh toán</td><td class="r">${SM.vnd(inv.total)}</td></tr>
            </table>`}
        ${lessons.length ? `<details style="margin-top:.7rem;"><summary class="muted" style="cursor:pointer;font-size:.85rem;">Chi tiết từng buổi (${lessons.length})</summary>
          <table class="inv-lines" style="margin-top:.4rem;">${lessons.map(l => `<tr><td>${SM.esc(l.description)}</td><td class="r">${SM.vnd(l.amount)}</td></tr>`).join("")}</table></details>` : ""}
        ${isDraft ? `<p class="muted" style="font-size:.83rem;margin:.7rem 0 0;">Đây là bản <b>nháp</b> — có thể tính lại hoặc xóa. Chốt xong sẽ khóa, chỉ sửa được bằng điều chỉnh (GĐ7).</p>`
          : `<p class="muted" style="font-size:.83rem;margin:.7rem 0 0;">Hóa đơn đã chốt — bất biến. Mọi thay đổi phải qua bút toán điều chỉnh (GĐ7).</p>`}
      </div>
      <div class="mf">
        ${isDraft ? `<button class="btn ghost" data-x="del" style="color:var(--danger);border-color:var(--danger);margin-right:auto;">🗑 Xóa nháp</button>
          <button class="btn ghost" data-x="rebuild">↻ Tính lại</button>
          <button class="btn" data-x="finalize">🔒 Chốt hóa đơn</button>`
          : `<button class="btn ghost" data-x="close">Đóng</button>`}
        <span class="msg" id="iv-msg" style="align-self:center"></span>
      </div>`;

    const modal = ov.querySelector(".sm-modal");
    modal.querySelector('[data-x="close"]').onclick = () => ov.remove();
    const say = (t, e) => { const m = ov.querySelector("#iv-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
    const del = modal.querySelector('[data-x="del"]');
    if (del) del.onclick = async () => {
      const ok = await SM.confirmDialog({ title: "Xóa hóa đơn nháp?", danger: true, okText: "Xóa",
        body: `Xóa hóa đơn nháp của <b>${SM.esc(inv.student ? inv.student.full_name : "")}</b> kỳ ${MONTHS[inv.period_month - 1]}/${inv.period_year}. Có thể tính lại bất cứ lúc nào.` });
      if (!ok) return;
      const { error } = await sb.from("invoices").delete().eq("id", id).eq("status", "draft");
      if (error) return say("Không xóa được: " + error.message, true);
      ov.remove(); SM.toast("🗑 Đã xóa hóa đơn nháp", "ok"); loadInvoices();
    };
    const reb = modal.querySelector('[data-x="rebuild"]');
    if (reb) reb.onclick = async () => {
      reb.disabled = true; say("Đang tính lại…");
      try {
        const mr = monthRange(inv.period_year, inv.period_month);
        const bf = inv.bill_from || mr.start, bt = inv.bill_to || mr.end;
        const { sessions, rates } = await loadClassBilling(inv.class_id, bf, bt);
        const set = new Set(sessions.filter(s => s.status !== "cancelled").map(s => s.id));
        await buildInvoice(inv.student_id, inv.class_id, +bf.slice(0, 4), +bf.slice(5, 7), { billFrom: bf, billTo: bt, chargeSet: set, sessions, rates });
        ov.remove(); SM.toast("✓ Đã tính lại (mọi buổi trong kỳ)", "ok"); loadInvoices();
      } catch (e) { reb.disabled = false; say("Lỗi: " + (e.message || e), true); }
    };
    const fin = modal.querySelector('[data-x="finalize"]');
    if (fin) fin.onclick = () => finalizeDialog(inv, ov);
  }

  function finalizeDialog(inv, parentOv) {
    const { end } = monthRange(inv.period_year, inv.period_month);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:420px;"><div class="mh"><h3>Chốt hóa đơn</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .6rem;">Chốt hóa đơn <b>${SM.vnd(inv.total)}</b> của <b>${SM.esc(inv.student ? inv.student.full_name : "")}</b>.
          Sau khi chốt sẽ <b>không sửa trực tiếp được nữa</b>.</p>
        <div class="field"><label>Hạn thanh toán (DD/MM/YYYY)</label><input id="fz-due" value="${SM.dmy(end)}"></div>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="fz-go">🔒 Chốt</button>
        <span class="msg" id="fz-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#fz-go").onclick = async () => {
      const say = (t, e) => { const m = ov.querySelector("#fz-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const due = SM.parseDmy(ov.querySelector("#fz-due").value.trim());
      if (!due) return say("Hạn thanh toán không hợp lệ.", true);
      ov.querySelector("#fz-go").disabled = true;
      const newStatus = inv.total <= 0 ? "waived" : "unpaid";
      const { error } = await sb.from("invoices").update({ status: newStatus, due_date: due, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", inv.id).eq("status", "draft");
      if (error) { ov.querySelector("#fz-go").disabled = false; return say("Không chốt được: " + error.message, true); }
      ov.remove(); if (parentOv) parentOv.remove();
      SM.toast("🔒 Đã chốt hóa đơn", "ok"); loadInvoices();
    };
  }

  async function finalizeAll() {
    const drafts = invoices.filter(i => i.status === "draft");
    if (!drafts.length) return;
    const { end } = monthRange(st.year, st.month);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:440px;"><div class="mh"><h3>Chốt tất cả hóa đơn nháp</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><p style="margin:.1rem 0 .6rem;">Chốt <b>${drafts.length}</b> hóa đơn nháp của ${MONTHS[st.month - 1]}/${st.year}
          (tổng ${SM.vnd(drafts.reduce((a, i) => a + i.total, 0))}). Không thể sửa trực tiếp sau khi chốt.</p>
        <div class="field"><label>Hạn thanh toán chung (DD/MM/YYYY)</label><input id="fa-due" value="${SM.dmy(end)}"></div></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="fa-go">🔒 Chốt ${drafts.length} hóa đơn</button>
        <span class="msg" id="fa-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#fa-go").onclick = async () => {
      const say = (t, e) => { const m = ov.querySelector("#fa-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const due = SM.parseDmy(ov.querySelector("#fa-due").value.trim());
      if (!due) return say("Hạn thanh toán không hợp lệ.", true);
      ov.querySelector("#fa-go").disabled = true; say("Đang chốt…");
      let ok = 0;
      for (const i of drafts) {
        const status = i.total <= 0 ? "waived" : "unpaid";
        const { error } = await sb.from("invoices").update({ status, due_date: due, finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", i.id).eq("status", "draft");
        if (!error) ok++;
      }
      ov.remove(); SM.toast(`🔒 Đã chốt ${ok}/${drafts.length} hóa đơn`, "ok"); loadInvoices();
    };
  }

  /* ============ TAB MỨC PHÍ ============ */
  async function paintRates() {
    box.innerHTML = tabsHtml() + `
      <div class="toolbar">
        <div class="field" style="min-width:240px;"><label>Chọn lớp</label>
          <select id="r-class"><option value="">— chọn lớp —</option>
            ${classes.map(c => `<option value="${c.id}" ${st.rateClass === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}</select></div>
      </div>
      <div id="r-body">${st.rateClass ? `<div class="card placeholder"><span class="spinner"></span></div>` : `<div class="card placeholder"><div class="big">💰</div><p>Chọn một lớp để xem/đặt mức phí theo thời gian.</p></div>`}</div>`;
    const rc = box.querySelector("#r-class");
    if (rc) rc.addEventListener("change", () => { st.rateClass = rc.value; renderRates(); });
    if (st.rateClass) renderRates();
  }

  async function renderRates() {
    const body = box.querySelector("#r-body");
    if (!st.rateClass) return;
    body.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
    const c = cls(st.rateClass);
    const { data } = await sb.from("tuition_rates").select("*").eq("class_id", st.rateClass).order("effective_from", { ascending: false });
    const rates = data || [];
    const flagList = f => {
      const on = [];
      if (f.charge_present) on.push("có mặt");
      if (f.charge_authorised_absence) on.push("vắng CP");
      if (f.charge_unauthorised_absence) on.push("vắng KP");
      if (f.charge_cancelled) on.push("buổi hủy");
      if (f.charge_makeup) on.push("buổi bù");
      if (f.charge_extra) on.push("buổi thêm");
      return on.length ? on.join(", ") : "—";
    };
    body.innerHTML = `
      <div class="card" style="padding:1rem 1.2rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">
          <div><b style="font-size:1.05rem;">${SM.esc(c.name)}</b><br>
            <span class="muted" style="font-size:.86rem;">Cách tính: <b>${METHOD[c.tuition_method] || c.tuition_method}</b> · mức mặc định của lớp ${SM.vnd(c.tuition_amount)}</span></div>
          <button class="btn" data-rate-add="1">➕ Thêm mức phí</button>
        </div>
        ${PER_SESSION.has(c.tuition_method) ? "" : `<p class="muted" style="font-size:.84rem;margin:.6rem 0 0;">Lớp tính <b>${METHOD[c.tuition_method]}</b> — các cờ “buổi nào tính phí” không áp dụng; chỉ dùng số tiền.</p>`}
        ${rates.length ? `<div class="sm-table-wrap" style="margin-top:.8rem;"><table class="sm-table"><thead><tr>
            <th>Hiệu lực từ</th><th>Mức phí</th>${PER_SESSION.has(c.tuition_method) ? "<th>Buổi tính phí</th>" : ""}<th></th></tr></thead><tbody>
          ${rates.map(r => `<tr>
            <td data-th="Hiệu lực từ"><b>${SM.dmy(r.effective_from)}</b></td>
            <td data-th="Mức phí">${SM.vnd(r.amount)}</td>
            ${PER_SESSION.has(c.tuition_method) ? `<td data-th="Buổi tính phí"><span class="muted" style="font-size:.85rem;">${flagList(r)}</span></td>` : ""}
            <td class="cell-actions"><div class="row-actions">
              <button class="btn ghost" data-rate-edit="${r.id}">Sửa</button>
              <button class="btn ghost" data-rate-del="${r.id}" style="color:var(--danger);border-color:var(--danger)">Xóa</button>
            </div></td></tr>`).join("")}
        </tbody></table></div>`
          : `<p class="muted" style="margin:.8rem 0 0;">Chưa đặt mức phí theo thời gian. Hiện dùng <b>mức mặc định của lớp ${SM.vnd(c.tuition_amount)}</b> với quy tắc tính mặc định (tính buổi có mặt + vắng không phép + buổi thêm). Bấm ➕ để đặt mức có ngày hiệu lực.</p>`}
      </div>`;
    body._rates = rates;
  }

  function rateForm(existing) {
    const c = cls(st.rateClass);
    const perSession = PER_SESSION.has(c.tuition_method);
    const r = existing || { amount: c.tuition_amount || 0, effective_from: SM.todayISO(), ...DEFAULT_FLAGS };
    const flag = (k, label) => `<label style="display:flex;align-items:center;gap:.5rem;font-weight:600;font-size:.88rem;padding:.2rem 0;">
      <input type="checkbox" id="rf-${k}" ${r[k] ? "checked" : ""} style="width:auto;"> ${label}</label>`;
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:460px;"><div class="mh">
        <h3>${existing ? "✏️ Sửa mức phí" : "➕ Thêm mức phí"} · ${SM.esc(c.name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field"><label>Hiệu lực từ (DD/MM/YYYY) *</label><input id="rf-from" value="${SM.dmy(r.effective_from)}"></div>
        <div class="field"><label>Mức phí (VND) *</label><input id="rf-amount" type="number" min="0" value="${r.amount}"></div>
      </div>
      ${perSession ? `<p class="muted" style="font-size:.85rem;margin:.4rem 0 .2rem;">Buổi nào bị tính phí:</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 1rem;">
          ${flag("charge_present", "Buổi có mặt / muộn / về sớm")}
          ${flag("charge_unauthorised_absence", "Vắng không phép")}
          ${flag("charge_authorised_absence", "Vắng có phép")}
          ${flag("charge_makeup", "Buổi học bù")}
          ${flag("charge_cancelled", "Buổi bị hủy")}
          ${flag("charge_extra", "Buổi học thêm")}
        </div>` : `<p class="muted" style="font-size:.85rem;">Lớp tính ${METHOD[c.tuition_method]} — chỉ cần số tiền.</p>`}
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="rf-save">💾 Lưu</button>
        <span class="msg" id="rf-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#rf-save").onclick = async () => {
      const say = (t, e) => { const m = ov.querySelector("#rf-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const from = SM.parseDmy(ov.querySelector("#rf-from").value.trim());
      if (!from) return say("Ngày hiệu lực không hợp lệ.", true);
      const amount = Math.max(0, parseInt(ov.querySelector("#rf-amount").value, 10) || 0);
      const row = { class_id: st.rateClass, method: c.tuition_method, amount, effective_from: from };
      if (perSession) ["charge_present", "charge_authorised_absence", "charge_unauthorised_absence", "charge_cancelled", "charge_makeup", "charge_extra"]
        .forEach(k => row[k] = ov.querySelector("#rf-" + k).checked);
      ov.querySelector("#rf-save").disabled = true;
      let error;
      if (existing) ({ error } = await sb.from("tuition_rates").update(row).eq("id", existing.id));
      else ({ error } = await sb.from("tuition_rates").insert(row));
      if (error) { ov.querySelector("#rf-save").disabled = false; return say("Không lưu được: " + error.message, true); }
      ov.remove(); SM.toast("✓ Đã lưu mức phí", "ok"); renderRates();
    };
  }

  async function deleteRate(id) {
    const body = box.querySelector("#r-body");
    const r = (body._rates || []).find(x => x.id === id);
    const ok = await SM.confirmDialog({ title: "Xóa mức phí?", danger: true, okText: "Xóa",
      body: `Xóa mức phí hiệu lực từ <b>${SM.dmy(r.effective_from)}</b> (${SM.vnd(r.amount)}). Hóa đơn <b>đã chốt</b> không thay đổi; hóa đơn nháp cần bấm “Tính lại”.` });
    if (!ok) return;
    const { error } = await sb.from("tuition_rates").delete().eq("id", id);
    if (error) return SM.toast("Không xóa được: " + error.message, "err");
    SM.toast("🗑 Đã xóa mức phí", "ok"); renderRates();
  }

  /* ============ điều khiển ============ */
  function onClick(e) {
    const b = e.target.closest("[data-tab],[data-nav],[data-act],[data-inv],[data-rate-add],[data-rate-edit],[data-rate-del]");
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; return st.tab === "invoices" ? loadInvoices() : paintRates(); }
    if (b.dataset.nav) {
      if (b.dataset.nav === "now") { const d = new Date(); st.year = d.getFullYear(); st.month = d.getMonth() + 1; }
      else { let m = st.month + (b.dataset.nav === "next" ? 1 : -1), y = st.year; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } st.month = m; st.year = y; }
      return loadInvoices();
    }
    if (b.dataset.act === "build") return doBuild();
    if (b.dataset.act === "finalizeall") return finalizeAll();
    if (b.dataset.inv) return invoiceDetail(b.dataset.inv);
    if (b.dataset.rateAdd) return rateForm(null);
    if (b.dataset.rateEdit) { const r = (box.querySelector("#r-body")._rates || []).find(x => x.id === b.dataset.rateEdit); return r && rateForm(r); }
    if (b.dataset.rateDel) return deleteRate(b.dataset.rateDel);
  }

  return {
    _compute: computeInvoice,           // để kiểm thử
    _cycle: cycleFrom,
    async render(el, me) {
      ME = me; box = el;
      if (!st.year) { const d = new Date(); st.year = d.getFullYear(); st.month = d.getMonth() + 1; }
      box.onclick = onClick;
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      const { data } = await sb.from("classes").select("id,name,tuition_method,tuition_amount,status,billing_cycle,billing_start,billing_include_future").is("archived_at", null).order("name");
      classes = data || [];
      if (st.tab === "rates") paintRates(); else loadInvoices();
    }
  };
})();

/* ============================================================
   Giai đoạn 10 — Báo cáo & xuất CSV
   Ba báo cáo: Doanh thu (thu/hoàn theo kỳ, theo hình thức & lớp) ·
   Công nợ (số dư từng học viên) · Chuyên cần (tỉ lệ đi học theo lớp).
   Mỗi báo cáo xuất được ra CSV (UTF-8 có BOM để Excel đọc tiếng Việt).
   ============================================================ */
window.Reports = (function () {
  let ME = null, box = null;
  const st = { tab: "revenue", from: "", to: "", classId: "" };
  let classes = [], busy = false, lastExport = null;

  const MONTHS = Array.from({ length: 12 }, (_, i) => "Tháng " + (i + 1));
  const METHOD = { cash: "Tiền mặt", bank_transfer: "Chuyển khoản", card: "Thẻ", other: "Khác" };
  const ISTATUS = { unpaid: "Chưa thu", partially_paid: "Thu một phần", paid: "Đã thanh toán", overdue: "Quá hạn" };
  const OPEN = ["unpaid", "partially_paid", "paid", "overdue"];
  const ATTENDED = new Set(["present", "late", "left_early", "makeup"]);
  const ABSENT = new Set(["authorised_absence", "unauthorised_absence"]);
  const netPayments = list => (list || []).reduce((a, p) => a + (p.is_refund ? -p.amount : p.amount), 0);
  const cName = id => (classes.find(c => c.id === id) || {}).name || "—";
  const enrolledOn = (e, d) => e.joined_on <= d && (!e.left_on || e.left_on >= d);

  /* ---------------- CSV ---------------- */
  function toCSV(headers, rows) {
    const esc = v => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return "﻿" + [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\r\n");
  }
  function downloadCSV(filename, csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    SM.toast("⬇ Đã xuất " + filename, "ok");
  }

  /* ---------------- khung ---------------- */
  function tabsHtml() {
    const T = [["revenue", "💰 Doanh thu"], ["debt", "📒 Công nợ"], ["attendance", "📊 Chuyên cần"]];
    return `<h1 style="margin:.2rem 0 .7rem;">Báo cáo</h1>
      <div class="toolbar">${T.map(([k, v]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${v}</button>`).join("")}</div>`;
  }
  function dateBar(extra) {
    return `<div class="cal-head">
      <div class="field" style="margin:0;"><label>Từ ngày</label><input id="r-from" value="${SM.dmy(st.from)}" style="width:120px;"></div>
      <div class="field" style="margin:0;"><label>Đến ngày</label><input id="r-to" value="${SM.dmy(st.to)}" style="width:120px;"></div>
      ${extra || ""}
      <span style="flex:1"></span>
      <button class="btn" data-export="1" ${lastExport ? "" : "disabled"}>⬇ Xuất CSV</button>
    </div>`;
  }
  function bindDates() {
    const f = box.querySelector("#r-from"), t = box.querySelector("#r-to");
    if (f) f.addEventListener("change", () => { const v = SM.parseDmy(f.value.trim()); if (v) { st.from = v; run(); } });
    if (t) t.addEventListener("change", () => { const v = SM.parseDmy(t.value.trim()); if (v) { st.to = v; run(); } });
  }

  function run() { if (st.tab === "revenue") revenue(); else if (st.tab === "debt") debt(); else attendance(); }

  /* ================= DOANH THU ================= */
  async function revenue() {
    busy = true; paintShell(`<div class="card placeholder"><span class="spinner"></span></div>`);
    const { data } = await sb.from("payments").select("*, student:students(code,full_name), invoice:invoices(class_id,period_year,period_month)")
      .gte("paid_on", st.from).lte("paid_on", st.to).order("paid_on");
    const pays = data || [];
    busy = false;
    const inSum = pays.filter(p => !p.is_refund).reduce((a, p) => a + p.amount, 0);
    const outSum = pays.filter(p => p.is_refund).reduce((a, p) => a + p.amount, 0);
    const net = inSum - outSum;
    const byMethod = {}, byMonth = {}, byClass = {};
    pays.forEach(p => {
      const amt = p.is_refund ? -p.amount : p.amount;
      byMethod[p.method] = (byMethod[p.method] || 0) + amt;
      const mk = p.paid_on.slice(0, 7); byMonth[mk] = (byMonth[mk] || 0) + amt;
      const ck = p.invoice ? p.invoice.class_id : "_none"; byClass[ck] = (byClass[ck] || 0) + amt;
    });
    // dữ liệu xuất CSV
    lastExport = () => ({
      name: `doanh-thu_${st.from}_${st.to}.csv`,
      csv: toCSV(["Ngày", "Mã HV", "Học viên", "Lớp", "Hình thức", "Tham chiếu", "Loại", "Số tiền (VND)"],
        pays.map(p => [SM.dmy(p.paid_on), p.student ? p.student.code : "", p.student ? p.student.full_name : "",
          p.invoice ? cName(p.invoice.class_id) : "Trả trước/khác", METHOD[p.method] || p.method, p.reference || "",
          p.is_refund ? "Hoàn" : "Thu", p.is_refund ? -p.amount : p.amount]))
    });

    const miniTable = (title, obj, labelFn) => {
      const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
      return `<div class="card" style="padding:.9rem 1.1rem;flex:1;min-width:220px;">
        <b style="font-size:.9rem;">${title}</b>
        <table class="inv-lines" style="margin-top:.3rem;">
          ${keys.map(k => `<tr><td>${SM.esc(labelFn(k))}</td><td class="r">${SM.vnd(obj[k])}</td></tr>`).join("") || `<tr><td class="muted">—</td><td></td></tr>`}
        </table></div>`;
    };

    paintShell(`
      <p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">${pays.length} giao dịch từ ${SM.dmy(st.from)} đến ${SM.dmy(st.to)}</p>
      <div class="sm-cards" style="margin-bottom:1rem;">
        <div class="stat card"><div class="k">Thực thu (ròng)</div><div class="v">${SM.vnd(net)}</div><div class="sub">thu ${SM.vnd(inSum)}${outSum ? " · hoàn " + SM.vnd(outSum) : ""}</div></div>
      </div>
      <div style="display:flex;gap:.9rem;flex-wrap:wrap;margin-bottom:1rem;">
        ${miniTable("Theo tháng", byMonth, k => "Tháng " + (+k.slice(5, 7)) + "/" + k.slice(0, 4))}
        ${miniTable("Theo hình thức", byMethod, k => METHOD[k] || k)}
        ${miniTable("Theo lớp", byClass, k => k === "_none" ? "Trả trước/khác" : cName(k))}
      </div>
      ${pays.length ? `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Ngày</th><th>Học viên</th><th>Lớp</th><th>Hình thức</th><th>Số tiền</th></tr></thead><tbody>
        ${pays.slice().reverse().map(p => `<tr>
          <td data-th="Ngày">${SM.dmy(p.paid_on)}</td>
          <td data-th="Học viên"><b>${SM.esc(p.student ? p.student.full_name : "—")}</b> <code style="font-size:.76rem">${SM.esc(p.student ? p.student.code : "")}</code></td>
          <td data-th="Lớp">${p.invoice ? SM.esc(cName(p.invoice.class_id)) : '<span class="muted">Trả trước/khác</span>'}</td>
          <td data-th="Hình thức">${METHOD[p.method] || p.method}</td>
          <td data-th="Số tiền" style="color:${p.is_refund ? "var(--danger)" : "var(--good)"}">${p.is_refund ? "−" : "+"}${SM.vnd(p.amount)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card placeholder"><p class="muted">Không có giao dịch trong khoảng này.</p></div>`}
    `);
  }

  /* ================= CÔNG NỢ ================= */
  async function debt() {
    busy = true; paintShell(`<div class="card placeholder"><span class="spinner"></span></div>`, true);
    const [invR, payR] = await Promise.all([
      sb.from("invoices").select("id,student_id,total,status, student:students(code,full_name)").in("status", OPEN),
      sb.from("payments").select("student_id,invoice_id,amount,is_refund")
    ]);
    busy = false;
    const byStu = {};
    (invR.data || []).forEach(iv => (byStu[iv.student_id] = byStu[iv.student_id] || { student: iv.student, inv: [], pay: [] }).inv.push(iv));
    (payR.data || []).forEach(p => (byStu[p.student_id] = byStu[p.student_id] || { student: null, inv: [], pay: [] }).pay.push(p));
    let rows = Object.entries(byStu).map(([sid, b]) => {
      const ids = new Set(b.inv.map(i => i.id));
      const charged = b.inv.reduce((a, i) => a + i.total, 0);
      const paid = netPayments(b.pay.filter(p => !p.invoice_id || ids.has(p.invoice_id)));
      return { student: b.student, charged, paid, balance: charged - paid };
    }).filter(r => r.balance !== 0).sort((a, b) => b.balance - a.balance);
    const owed = rows.filter(r => r.balance > 0).reduce((a, r) => a + r.balance, 0);
    const credit = rows.filter(r => r.balance < 0).reduce((a, r) => a - r.balance, 0);

    lastExport = () => ({
      name: `cong-no_${SM.todayISO()}.csv`,
      csv: toCSV(["Mã HV", "Học viên", "Phải thu (VND)", "Đã thu (VND)", "Số dư (VND)", "Tình trạng"],
        rows.map(r => [r.student ? r.student.code : "", r.student ? r.student.full_name : "", r.charged, r.paid, r.balance, r.balance > 0 ? "Còn nợ" : "Dư"]))
    });

    paintShell(`
      <p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">Ảnh chụp tại ${SM.dmy(SM.todayISO())} · tổng còn nợ <b style="color:var(--danger)">${SM.vnd(owed)}</b>${credit ? ` · tổng dư <b style="color:var(--good)">${SM.vnd(credit)}</b>` : ""}</p>
      ${rows.length ? `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Mã</th><th>Học viên</th><th>Phải thu</th><th>Đã thu</th><th>Số dư</th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td data-th="Mã"><code>${SM.esc(r.student ? r.student.code : "")}</code></td>
          <td data-th="Học viên"><b>${SM.esc(r.student ? r.student.full_name : "—")}</b></td>
          <td data-th="Phải thu">${SM.vnd(r.charged)}</td>
          <td data-th="Đã thu">${SM.vnd(r.paid)}</td>
          <td data-th="Số dư">${r.balance > 0 ? `<b style="color:var(--danger)">Nợ ${SM.vnd(r.balance)}</b>` : `<b style="color:var(--good)">Dư ${SM.vnd(-r.balance)}</b>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card placeholder"><div class="big">📒</div><p class="muted">Không có công nợ.</p></div>`}
    `, true);
  }

  /* ================= CHUYÊN CẦN ================= */
  async function attendance() {
    const extra = `<div class="field" style="margin:0;"><label>Lớp</label><select id="r-class"><option value="">Tất cả lớp</option>
      ${classes.map(c => `<option value="${c.id}" ${st.classId === c.id ? "selected" : ""}>${SM.esc(c.name)}</option>`).join("")}</select></div>`;
    busy = true; paintShell(`<div class="card placeholder"><span class="spinner"></span></div>`, false, extra);
    const today = SM.todayISO();
    const to = st.to < today ? st.to : today;
    let sq = sb.from("sessions").select("id,class_id,date").gte("date", st.from).lte("date", to).neq("status", "cancelled");
    let eq = sb.from("enrollments").select("class_id,joined_on,left_on, student:students(id,code,full_name)");
    if (st.classId) { sq = sq.eq("class_id", st.classId); eq = eq.eq("class_id", st.classId); }
    const [sessR, enrR] = await Promise.all([sq, eq]);
    const sessions = sessR.data || [], enrolls = (enrR.data || []).filter(e => e.student);
    const sessIds = sessions.map(s => s.id);
    let att = [];
    for (let i = 0; i < sessIds.length; i += 200) {
      const { data } = await sb.from("attendance").select("session_id,student_id,status").in("session_id", sessIds.slice(i, i + 200));
      att = att.concat(data || []);
    }
    busy = false;
    const sessByClass = {}; sessions.forEach(s => (sessByClass[s.class_id] = sessByClass[s.class_id] || []).push(s));
    const attMap = {}; att.forEach(a => (attMap[a.student_id] = attMap[a.student_id] || {})[a.session_id] = a.status);

    const rows = enrolls.map(e => {
      const sid = e.student && e.student.id;
      const cs = (sessByClass[e.class_id] || []).filter(se => enrolledOn(e, se.date));
      let present = 0, absent = 0, notRec = 0;
      cs.forEach(se => { const v = (attMap[sid] || {})[se.id]; if (!v) notRec++; else if (ATTENDED.has(v)) present++; else if (ABSENT.has(v)) absent++; });
      const recorded = present + absent;
      const rate = recorded ? Math.round(present / recorded * 100) : null;
      return { className: cName(e.class_id), code: e.student.code, name: e.student.full_name, total: cs.length, present, absent, notRec, rate };
    }).filter(r => r.total > 0).sort((a, b) => a.className === b.className ? (a.rate ?? -1) - (b.rate ?? -1) : a.className.localeCompare(b.className, "vi"));

    lastExport = () => ({
      name: `chuyen-can_${st.from}_${to}.csv`,
      csv: toCSV(["Lớp", "Mã HV", "Học viên", "Số buổi", "Có mặt", "Vắng", "Chưa điểm danh", "Chuyên cần (%)"],
        rows.map(r => [r.className, r.code, r.name, r.total, r.present, r.absent, r.notRec, r.rate == null ? "" : r.rate]))
    });

    const rateBadge = r => r == null ? '<span class="muted">—</span>' : `<span class="badge ${r >= 90 ? "ok" : r >= 75 ? "warn" : "bad"}">${r}%</span>`;
    paintShell(`
      <p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">Từ ${SM.dmy(st.from)} đến ${SM.dmy(to)} · ${sessions.length} buổi đã diễn ra</p>
      ${rows.length ? `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Lớp</th><th>Mã</th><th>Học viên</th><th>Buổi</th><th>Có mặt</th><th>Vắng</th><th>Chưa ĐD</th><th>Chuyên cần</th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td data-th="Lớp">${SM.esc(r.className)}</td>
          <td data-th="Mã"><code>${SM.esc(r.code || "")}</code></td>
          <td data-th="Học viên"><b>${SM.esc(r.name)}</b></td>
          <td data-th="Buổi">${r.total}</td><td data-th="Có mặt">${r.present}</td><td data-th="Vắng">${r.absent}</td>
          <td data-th="Chưa ĐD">${r.notRec ? `<span class="badge warn">${r.notRec}</span>` : "0"}</td>
          <td data-th="Chuyên cần">${rateBadge(r.rate)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card placeholder"><div class="big">📊</div><p class="muted">Chưa có dữ liệu điểm danh trong khoảng này.</p></div>`}
    `, false, extra);
    const rc = box.querySelector("#r-class");
    if (rc) rc.addEventListener("change", () => { st.classId = rc.value; attendance(); });
  }

  /* ---------------- vẽ khung chung ---------------- */
  function paintShell(bodyHtml, noDates, extra) {
    box.innerHTML = tabsHtml() + (noDates ? `<div class="cal-head"><span style="flex:1"></span><button class="btn" data-export="1" ${lastExport ? "" : "disabled"}>⬇ Xuất CSV</button></div>` : dateBar(extra)) + bodyHtml;
    if (!noDates) bindDates();
  }

  function onClick(e) {
    const b = e.target.closest("[data-tab],[data-export]");
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; lastExport = null; return run(); }
    if (b.dataset.export) { if (lastExport) { const x = lastExport(); downloadCSV(x.name, x.csv); } }
  }

  return {
    _toCSV: toCSV,
    async render(el, me) {
      ME = me; box = el;
      if (!st.from) { const d = new Date(); st.from = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01"; st.to = SM.todayISO(); }
      box.onclick = onClick; lastExport = null;
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      classes = await SM.refClasses();
      run();
    }
  };
})();

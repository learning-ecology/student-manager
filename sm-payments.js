/* ============================================================
   Giai đoạn 7 — Thanh toán, biên nhận, điều chỉnh & số dư
   • Thu tiền theo hóa đơn (hoặc trả trước) · hoàn tiền · biên nhận in được.
   • Điều chỉnh hóa đơn ĐÃ CHỐT (không ghi đè — thêm bút toán, có truy vết).
   • Công nợ: số dư từng học viên (phải thu − đã thu), sổ chi tiết.
   Các phép tính số dư/trạng thái nằm ở hàm thuần, đã kiểm thử.
   ============================================================ */
window.Payments = (function () {
  let ME = null, box = null, CENTER = "Trung tâm";
  const st = { tab: "pay", from: "", to: "", q: "", method: "" };
  let payList = [], busy = false;

  const METHOD = { cash: "Tiền mặt", bank_transfer: "Chuyển khoản", card: "Thẻ", other: "Khác" };
  const ISTATUS = {
    draft: { l: "Nháp", c: "warn" }, unpaid: { l: "Chưa thu", c: "bad" },
    partially_paid: { l: "Thu một phần", c: "warn" }, paid: { l: "Đã thanh toán", c: "ok" },
    overdue: { l: "Quá hạn", c: "bad" }, waived: { l: "Không phát sinh", c: "mute" }, cancelled: { l: "Đã hủy", c: "mute" }
  };
  const MONTHS = Array.from({ length: 12 }, (_, i) => "Tháng " + (i + 1));
  const OPEN = new Set(["unpaid", "partially_paid", "paid", "overdue"]);   // hóa đơn đã chốt, còn hiệu lực
  const PAYABLE = new Set(["unpaid", "partially_paid", "overdue"]);        // còn nợ, được thu

  /* ---------------- hàm thuần (đã kiểm thử) ---------------- */
  const netPayments = list => (list || []).reduce((a, p) => a + (p.is_refund ? -p.amount : p.amount), 0);

  function invoiceOutstanding(inv, payments) {
    return inv.total - netPayments((payments || []).filter(p => p.invoice_id === inv.id));
  }
  function invoiceStatusFor(inv, payments, today) {
    if (inv.status === "draft" || inv.status === "cancelled" || inv.status === "waived") return inv.status;
    const paid = netPayments((payments || []).filter(p => p.invoice_id === inv.id));
    if (inv.total > 0 && paid >= inv.total) return "paid";
    if (paid > 0) return "partially_paid";
    return (inv.due_date && inv.due_date < today) ? "overdue" : "unpaid";
  }
  // invoices = hóa đơn đã chốt của học viên; payments = mọi thanh toán của học viên
  function computeStudentBalance(invoices, payments) {
    const ids = new Set((invoices || []).map(i => i.id));
    const charged = (invoices || []).reduce((a, i) => a + i.total, 0);
    const allocated = netPayments((payments || []).filter(p => p.invoice_id && ids.has(p.invoice_id)));
    const unalloc = netPayments((payments || []).filter(p => !p.invoice_id));
    const paid = allocated + unalloc;
    return { charged, paid, balance: charged - paid, credit: unalloc };
  }

  // đọc số tiền thành chữ (VND)
  function docSoTien(num) {
    let n = Math.round(Math.abs(Number(num) || 0));
    if (n === 0) return "Không đồng";
    const cs = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
    const dv = ["", "nghìn", "triệu", "tỷ"];
    function doc3(x, full) {
      const tram = Math.floor(x / 100), chuc = Math.floor((x % 100) / 10), dvi = x % 10;
      let s = "";
      if (tram > 0 || full) s += cs[tram] + " trăm";
      if (chuc > 1) { s += " " + cs[chuc] + " mươi"; if (dvi === 1) s += " mốt"; else if (dvi === 5) s += " lăm"; else if (dvi > 0) s += " " + cs[dvi]; }
      else if (chuc === 1) { s += " mười"; if (dvi === 5) s += " lăm"; else if (dvi > 0) s += " " + cs[dvi]; }
      else if (dvi > 0) { s += ((tram > 0 || full) ? " lẻ " : " ") + cs[dvi]; }
      return s.trim();
    }
    const groups = []; while (n > 0) { groups.unshift(n % 1000); n = Math.floor(n / 1000); }
    const L = groups.length; let s = "";
    for (let i = 0; i < L; i++) { const g = groups[i], idx = L - 1 - i; if (g === 0) continue; s += doc3(g, i > 0) + " " + dv[idx] + " "; }
    s = s.replace(/\s+/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1) + " đồng";
  }

  /* cập nhật trạng thái hóa đơn sau khi thu tiền / điều chỉnh */
  async function refreshInvoiceStatus(invoiceId) {
    if (!invoiceId) return;
    const { data: inv } = await sb.from("invoices").select("id,total,status,due_date").eq("id", invoiceId).single();
    if (!inv || inv.status === "draft" || inv.status === "cancelled" || inv.status === "waived") return;
    const { data: pays } = await sb.from("payments").select("amount,is_refund,invoice_id").eq("invoice_id", invoiceId);
    const status = invoiceStatusFor(inv, pays || [], SM.todayISO());
    if (status !== inv.status) await sb.from("invoices").update({ status, updated_at: new Date().toISOString() }).eq("id", invoiceId);
  }

  /* ================= TAB 1 — THU TIỀN ================= */
  function tabsHtml() {
    const T = [["pay", "💵 Thu tiền"], ["balances", "📒 Công nợ"]];
    return `<h1 style="margin:.2rem 0 .7rem;">Thanh toán</h1>
      <div class="toolbar">${T.map(([k, v]) => `<button class="btn ${st.tab === k ? "" : "ghost"}" data-tab="${k}">${v}</button>`).join("")}</div>`;
  }

  async function loadPayments() {
    busy = true; paintPayments();
    let q = sb.from("payments").select("*, student:students(code,full_name), invoice:invoices(period_year,period_month,class_id)")
      .gte("paid_on", st.from).lte("paid_on", st.to).order("paid_on", { ascending: false }).order("created_at", { ascending: false });
    if (st.method) q = q.eq("method", st.method);
    const { data, error } = await q;
    let rows = error ? [] : (data || []);
    if (st.q.trim()) { const s = st.q.trim().toLowerCase(); rows = rows.filter(p => p.student && ((p.student.full_name || "").toLowerCase().includes(s) || (p.student.code || "").toLowerCase().includes(s))); }
    payList = rows; busy = false;
    if (error) SM.toast("Lỗi tải thanh toán: " + error.message, "err");
    paintPayments();
  }

  function paintPayments() {
    const totIn = payList.filter(p => !p.is_refund).reduce((a, p) => a + p.amount, 0);
    const totOut = payList.filter(p => p.is_refund).reduce((a, p) => a + p.amount, 0);
    let table;
    if (busy) table = `<div class="card placeholder"><span class="spinner"></span></div>`;
    else if (!payList.length) table = `<div class="card placeholder"><div class="big">💵</div><p>Chưa có khoản thu nào trong khoảng thời gian này.</p></div>`;
    else table = `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Ngày</th><th>Học viên</th><th>Nội dung</th><th>Hình thức</th><th>Số tiền</th><th></th></tr></thead><tbody>
        ${payList.map(p => `<tr>
          <td data-th="Ngày">${SM.dmy(p.paid_on)}</td>
          <td data-th="Học viên"><b>${SM.esc(p.student ? p.student.full_name : "—")}</b>${p.student ? `<br><code style="font-size:.76rem">${SM.esc(p.student.code)}</code>` : ""}</td>
          <td data-th="Nội dung">${p.invoice ? "Hóa đơn " + MONTHS[p.invoice.period_month - 1] + "/" + p.invoice.period_year : '<span class="muted">Trả trước / không gắn hóa đơn</span>'}${p.reference ? `<br><span class="muted" style="font-size:.8rem">${SM.esc(p.reference)}</span>` : ""}</td>
          <td data-th="Hình thức">${METHOD[p.method] || p.method}</td>
          <td data-th="Số tiền"><b style="color:${p.is_refund ? "var(--danger)" : "var(--good)"}">${p.is_refund ? "−" : "+"}${SM.vnd(p.amount)}</b>${p.is_refund ? '<br><span class="badge bad">Hoàn tiền</span>' : ""}</td>
          <td class="cell-actions"><div class="row-actions">
            <button class="btn ghost" data-receipt="${p.id}">🧾 Biên nhận</button>
            <button class="btn ghost" data-delpay="${p.id}" style="color:var(--danger);border-color:var(--danger)">Xóa</button>
          </div></td></tr>`).join("")}
      </tbody></table></div>`;

    box.innerHTML = tabsHtml() + `
      <div class="cal-head">
        <div class="field" style="margin:0;"><label>Từ ngày</label><input id="p-from" value="${SM.dmy(st.from)}" style="width:120px;"></div>
        <div class="field" style="margin:0;"><label>Đến ngày</label><input id="p-to" value="${SM.dmy(st.to)}" style="width:120px;"></div>
        <div class="field" style="margin:0;"><label>Hình thức</label><select id="p-method"><option value="">Tất cả</option>
          ${Object.entries(METHOD).map(([k, v]) => `<option value="${k}" ${st.method === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;flex:1;min-width:160px;"><label>Tìm học viên</label><input id="p-q" value="${SM.esc(st.q)}" placeholder="tên / mã…"></div>
        <button class="btn" data-act="add">➕ Thu tiền</button>
      </div>
      ${payList.length ? `<p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">${payList.length} giao dịch · thu <b style="color:var(--good)">${SM.vnd(totIn)}</b>${totOut ? ` · hoàn <b style="color:var(--danger)">${SM.vnd(totOut)}</b> · thực thu <b>${SM.vnd(totIn - totOut)}</b>` : ""}</p>` : ""}
      ${table}`;

    const bind = (id, ev, fn) => { const el = box.querySelector(id); if (el) el.addEventListener(ev, fn); };
    let deb;
    bind("#p-from", "change", () => { const v = SM.parseDmy(box.querySelector("#p-from").value.trim()); if (v) { st.from = v; loadPayments(); } });
    bind("#p-to", "change", () => { const v = SM.parseDmy(box.querySelector("#p-to").value.trim()); if (v) { st.to = v; loadPayments(); } });
    bind("#p-method", "change", () => { st.method = box.querySelector("#p-method").value; loadPayments(); });
    bind("#p-q", "input", () => { clearTimeout(deb); deb = setTimeout(() => { st.q = box.querySelector("#p-q").value; loadPayments(); }, 300); });
  }

  /* ---------------- form thu tiền ---------------- */
  async function payForm(preStudent, preInvoice) {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>➕ Thu tiền</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <div class="field"><label>Học viên *</label>
          <div id="ps-picked" ${preStudent ? "" : 'style="display:none"'}></div>
          <input id="ps-q" placeholder="gõ tên / mã học viên…" ${preStudent ? 'style="display:none"' : ""}>
          <div id="ps-list" class="card" style="max-height:200px;overflow:auto;padding:.2rem;display:none;"></div>
        </div>
        <div id="pf-body" ${preStudent ? "" : 'style="display:none"'}>
          <div class="field"><label>Gắn với hóa đơn</label><select id="pf-invoice"><option value="">Trả trước / không gắn hóa đơn</option></select>
            <span class="muted" id="pf-outstanding" style="font-size:.82rem;"></span></div>
          <div class="grid2">
            <div class="field"><label>Số tiền (VND) *</label><input id="pf-amount" type="number" min="0" value="0"></div>
            <div class="field"><label>Ngày thu (DD/MM/YYYY)</label><input id="pf-date" value="${SM.dmy(SM.todayISO())}"></div>
            <div class="field"><label>Hình thức</label><select id="pf-method">${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
            <div class="field"><label>Mã tham chiếu</label><input id="pf-ref" placeholder="vd: mã CK, số biên lai"></div>
            <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><input id="pf-note"></div>
            <label style="display:flex;align-items:center;gap:.5rem;grid-column:1/-1;font-weight:600;"><input type="checkbox" id="pf-refund" style="width:auto"> Đây là khoản HOÀN TIỀN cho học viên</label>
          </div>
        </div>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="pf-save" ${preStudent ? "" : "disabled"}>💾 Lưu</button>
        <span class="msg" id="pf-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    let student = preStudent || null;
    const say = (t, e) => { const m = ov.querySelector("#pf-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };

    async function pickStudent(s) {
      student = s;
      ov.querySelector("#ps-picked").style.display = "";
      ov.querySelector("#ps-picked").innerHTML = `<b>${SM.esc(s.full_name)}</b> <code>${SM.esc(s.code)}</code> <button class="btn ghost" data-x="rechoose" style="padding:.2rem .5rem;font-size:.8rem;">đổi</button>`;
      ov.querySelector("#ps-q").style.display = "none";
      ov.querySelector("#ps-list").style.display = "none";
      ov.querySelector("#pf-body").style.display = "";
      ov.querySelector("#pf-save").disabled = false;
      // hóa đơn còn nợ
      const { data: invs } = await sb.from("invoices").select("id,period_year,period_month,total,status,due_date,class_id")
        .eq("student_id", s.id).in("status", [...PAYABLE]).order("period_year").order("period_month");
      const { data: pays } = await sb.from("payments").select("amount,is_refund,invoice_id").eq("student_id", s.id);
      const sel = ov.querySelector("#pf-invoice");
      sel.innerHTML = `<option value="">Trả trước / không gắn hóa đơn</option>` + (invs || []).map(iv => {
        const out = invoiceOutstanding(iv, (pays || []).filter(p => p.invoice_id === iv.id));
        return `<option value="${iv.id}" data-out="${out}">${MONTHS[iv.period_month - 1]}/${iv.period_year} — còn nợ ${SM.vnd(out)}</option>`;
      }).join("");
      if (preInvoice) sel.value = preInvoice;
      updateOut();
    }
    function updateOut() {
      const opt = ov.querySelector("#pf-invoice").selectedOptions[0];
      const out = opt ? parseInt(opt.dataset.out || "0", 10) : 0;
      ov.querySelector("#pf-outstanding").textContent = opt && opt.value ? "Còn nợ: " + SM.vnd(out) : "";
      if (opt && opt.value && !ov.querySelector("#pf-refund").checked) ov.querySelector("#pf-amount").value = out;
    }
    ov.querySelector("#pf-invoice") && ov.querySelector("#pf-invoice").addEventListener("change", updateOut);
    if (preStudent) pickStudent(preStudent);

    // tìm học viên
    let deb; const qEl = ov.querySelector("#ps-q"), listEl = ov.querySelector("#ps-list");
    qEl && qEl.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(search, 300); });
    async function search() {
      const q = qEl.value.trim(); if (!q) { listEl.style.display = "none"; return; }
      const { data } = await sb.from("students").select("id,code,full_name").is("archived_at", null)
        .or(`full_name.ilike.%${q.replace(/[%,]/g, " ")}%,code.ilike.%${q}%,phone.ilike.%${q}%`).limit(20);
      listEl.style.display = "block";
      listEl.innerHTML = (data || []).length ? (data || []).map(s => `<div data-pick='${SM.esc(JSON.stringify({ id: s.id, code: s.code, full_name: s.full_name }))}' style="padding:.4rem .5rem;border-bottom:1px solid var(--line);cursor:pointer;"><b>${SM.esc(s.full_name)}</b> <span class="muted">· ${SM.esc(s.code)}</span></div>`).join("") : `<p class="muted" style="padding:.6rem">Không tìm thấy.</p>`;
      listEl.querySelectorAll("[data-pick]").forEach(el => el.addEventListener("click", () => pickStudent(JSON.parse(el.dataset.pick))));
    }
    ov.addEventListener("click", e => { if (e.target.dataset.x === "rechoose") { student = null; ov.querySelector("#ps-picked").style.display = "none"; ov.querySelector("#ps-q").style.display = ""; ov.querySelector("#pf-body").style.display = "none"; ov.querySelector("#pf-save").disabled = true; } });
    ov.querySelector("#pf-refund").addEventListener("change", updateOut);

    ov.querySelector("#pf-save").addEventListener("click", async () => {
      if (!student) return say("Chọn học viên.", true);
      const amount = Math.round(parseFloat(ov.querySelector("#pf-amount").value) || 0);
      if (amount <= 0) return say("Số tiền phải lớn hơn 0.", true);
      const date = SM.parseDmy(ov.querySelector("#pf-date").value.trim());
      if (!date) return say("Ngày thu không hợp lệ.", true);
      const invoiceId = ov.querySelector("#pf-invoice").value || null;
      const row = {
        student_id: student.id, invoice_id: invoiceId, amount, is_refund: ov.querySelector("#pf-refund").checked,
        paid_on: date, method: ov.querySelector("#pf-method").value, reference: ov.querySelector("#pf-ref").value.trim(),
        note: ov.querySelector("#pf-note").value.trim(), created_by: ME.user.id
      };
      ov.querySelector("#pf-save").disabled = true;
      const { data, error } = await sb.from("payments").insert(row).select("id").single();
      if (error) { ov.querySelector("#pf-save").disabled = false; return say("Không lưu được: " + error.message, true); }
      await refreshInvoiceStatus(invoiceId);
      ov.remove(); SM.toast(row.is_refund ? "✓ Đã ghi hoàn tiền" : "✓ Đã thu tiền", "ok");
      const pid = data ? data.id : null;
      if (st.tab === "pay") loadPayments(); else if (curLedger) openLedger(curLedger);
      if (pid && !row.is_refund) receipt(pid);
    });
  }

  /* ---------------- biên nhận (in được) ---------------- */
  async function receipt(paymentId) {
    const { data: p } = await sb.from("payments").select("*, student:students(code,full_name), invoice:invoices(period_year,period_month)").eq("id", paymentId).single();
    if (!p) return;
    const ov = document.createElement("div"); ov.className = "sm-ov";
    const title = p.is_refund ? "PHIẾU HOÀN TIỀN" : "BIÊN NHẬN THU TIỀN";
    ov.innerHTML = `<div class="sm-modal" style="max-width:460px;"><div class="mh"><h3>🧾 Biên nhận</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="receipt-print" id="rcpt">
        <div style="text-align:center;margin-bottom:.6rem;">
          <div style="font-weight:800;font-size:1.1rem;">${SM.esc(CENTER)}</div>
          <div style="font-size:1.15rem;font-weight:800;letter-spacing:.03em;margin-top:.4rem;">${title}</div>
          <div class="muted" style="font-size:.82rem;">Số: ${SM.esc(String(p.id).slice(0, 8).toUpperCase())} · Ngày ${SM.dmy(p.paid_on)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:.92rem;">
          <tr><td style="padding:.3rem 0;color:var(--muted);width:38%">Học viên</td><td><b>${SM.esc(p.student ? p.student.full_name : "")}</b> (${SM.esc(p.student ? p.student.code : "")})</td></tr>
          <tr><td style="padding:.3rem 0;color:var(--muted)">Nội dung</td><td>${p.invoice ? "Học phí " + MONTHS[p.invoice.period_month - 1] + "/" + p.invoice.period_year : (p.is_refund ? "Hoàn tiền" : "Nộp trước / khác")}</td></tr>
          <tr><td style="padding:.3rem 0;color:var(--muted)">Hình thức</td><td>${METHOD[p.method] || p.method}${p.reference ? " · " + SM.esc(p.reference) : ""}</td></tr>
          <tr><td style="padding:.3rem 0;color:var(--muted)">Số tiền</td><td style="font-weight:800;font-size:1.15rem;">${SM.vnd(p.amount)}</td></tr>
          <tr><td style="padding:.3rem 0;color:var(--muted);vertical-align:top">Bằng chữ</td><td><i>${docSoTien(p.amount)}</i></td></tr>
          ${p.note ? `<tr><td style="padding:.3rem 0;color:var(--muted)">Ghi chú</td><td>${SM.esc(p.note)}</td></tr>` : ""}
        </table>
        <div style="display:flex;justify-content:space-between;margin-top:1.6rem;text-align:center;font-size:.85rem;">
          <div style="flex:1;">Người nộp<br><span class="muted">(ký, ghi rõ họ tên)</span></div>
          <div style="flex:1;">Người thu<br><span class="muted">(ký, ghi rõ họ tên)</span></div>
        </div>
      </div></div>
      <div class="mf"><button class="btn ghost" data-x="close">Đóng</button><button class="btn" id="rcpt-print">🖨 In biên nhận</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#rcpt-print").addEventListener("click", () => { document.body.classList.add("printing"); window.print(); setTimeout(() => document.body.classList.remove("printing"), 500); });
  }

  async function deletePayment(id) {
    const p = payList.find(x => x.id === id) || (await sb.from("payments").select("*").eq("id", id).single()).data;
    const ok = await SM.confirmDialog({ title: "Xóa khoản thu?", danger: true, okText: "Xóa",
      body: `Xóa giao dịch ${SM.vnd(p.amount)} ngày ${SM.dmy(p.paid_on)}. Trạng thái hóa đơn liên quan sẽ được tính lại.` });
    if (!ok) return;
    const invId = p.invoice_id;
    const { error } = await sb.from("payments").delete().eq("id", id);
    if (error) return SM.toast("Không xóa được: " + error.message, "err");
    await refreshInvoiceStatus(invId);
    SM.toast("🗑 Đã xóa giao dịch", "ok");
    if (st.tab === "pay") loadPayments(); else if (curLedger) openLedger(curLedger);
  }

  /* ================= TAB 2 — CÔNG NỢ ================= */
  let curLedger = null;
  async function paintBalances() {
    box.innerHTML = tabsHtml() + `<div id="b-body"><div class="card placeholder"><span class="spinner"></span></div></div>`;
    const body = box.querySelector("#b-body");
    const today = SM.todayISO();
    const { data: invs } = await sb.from("invoices").select("id,student_id,total,status,due_date, student:students(code,full_name)").in("status", [...OPEN]);
    const { data: pays } = await sb.from("payments").select("student_id,invoice_id,amount,is_refund");
    // gom theo học viên
    const byStu = {};
    (invs || []).forEach(iv => { const b = byStu[iv.student_id] = byStu[iv.student_id] || { student: iv.student, invoices: [], payments: [] }; b.invoices.push(iv); });
    (pays || []).forEach(p => { const b = byStu[p.student_id] = byStu[p.student_id] || { student: null, invoices: [], payments: [] }; b.payments.push(p); });
    let rows = Object.entries(byStu).map(([sid, b]) => {
      const bal = computeStudentBalance(b.invoices, b.payments);
      return { sid, student: b.student, ...bal };
    }).filter(r => r.balance !== 0 || r.charged !== 0);
    rows.sort((a, b) => b.balance - a.balance);
    const owed = rows.filter(r => r.balance > 0).reduce((a, r) => a + r.balance, 0);
    const credit = rows.filter(r => r.balance < 0).reduce((a, r) => a - r.balance, 0);

    if (!rows.length) { body.innerHTML = `<div class="card placeholder"><div class="big">📒</div><p>Chưa có công nợ. Hóa đơn được chốt ở mục Học phí sẽ xuất hiện tại đây.</p></div>`; return; }
    body.innerHTML = `
      <p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">Tổng còn nợ <b style="color:var(--danger)">${SM.vnd(owed)}</b>${credit ? ` · tổng dư (trả trước) <b style="color:var(--good)">${SM.vnd(credit)}</b>` : ""}</p>
      <div class="sm-table-wrap"><table class="sm-table"><thead><tr>
        <th>Mã</th><th>Học viên</th><th>Phải thu</th><th>Đã thu</th><th>Số dư</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td data-th="Mã"><code>${SM.esc(r.student ? r.student.code : "")}</code></td>
          <td data-th="Học viên"><b>${SM.esc(r.student ? r.student.full_name : "—")}</b></td>
          <td data-th="Phải thu">${SM.vnd(r.charged)}</td>
          <td data-th="Đã thu">${SM.vnd(r.paid)}</td>
          <td data-th="Số dư">${r.balance > 0 ? `<b style="color:var(--danger)">Nợ ${SM.vnd(r.balance)}</b>` : r.balance < 0 ? `<b style="color:var(--good)">Dư ${SM.vnd(-r.balance)}</b>` : "—"}</td>
          <td class="cell-actions"><div class="row-actions"><button class="btn ghost" data-ledger="${r.sid}">Sổ chi tiết</button>
            <button class="btn" data-paystu="${r.sid}">Thu tiền</button></div></td></tr>`).join("")}
      </tbody></table></div>`;
    body._rows = rows;
  }

  async function openLedger(studentId) {
    curLedger = studentId;
    const ov0 = document.querySelector(".sm-ov.ledger"); if (ov0) ov0.remove();
    const ov = document.createElement("div"); ov.className = "sm-ov ledger";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>Sổ chi tiết</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="card placeholder"><span class="spinner"></span></div></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") { ov.remove(); curLedger = null; } });
    // các nút hành động trong sổ (Thu/Điều chỉnh/Biên nhận) nằm NGOÀI #content nên
    // phải gắn thêm handler ở đây — box.onclick không "với tới" overlay này.
    ov.addEventListener("click", onClick);

    const today = SM.todayISO();
    const { data: s } = await sb.from("students").select("id,code,full_name").eq("id", studentId).single();
    const { data: invs } = await sb.from("invoices").select("id,period_year,period_month,total,status,due_date,subtotal,discount_total,adjustment_total,class_id").eq("student_id", studentId).in("status", [...OPEN]).order("period_year").order("period_month");
    const { data: pays } = await sb.from("payments").select("*").eq("student_id", studentId).order("paid_on");
    const bal = computeStudentBalance(invs || [], pays || []);

    ov.querySelector(".sm-modal").innerHTML = `
      <div class="mh"><h3>Sổ chi tiết · ${SM.esc(s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .6rem;"><code>${SM.esc(s.code)}</code> · Phải thu ${SM.vnd(bal.charged)} · Đã thu ${SM.vnd(bal.paid)} ·
          ${bal.balance > 0 ? `<b style="color:var(--danger)">Còn nợ ${SM.vnd(bal.balance)}</b>` : bal.balance < 0 ? `<b style="color:var(--good)">Đang dư ${SM.vnd(-bal.balance)}</b>` : "<b>Đã thanh toán đủ</b>"}</p>
        <h4 style="margin:.6rem 0 .3rem;font-family:var(--serif);">Hóa đơn</h4>
        ${(invs || []).length ? `<table class="inv-lines">
          ${(invs || []).map(iv => { const out = invoiceOutstanding(iv, (pays || []).filter(p => p.invoice_id === iv.id)); const stt = ISTATUS[iv.status] || {};
            return `<tr><td>${MONTHS[iv.period_month - 1]}/${iv.period_year} <span class="badge ${stt.c}">${stt.l}</span>${iv.adjustment_total ? ` <span class="muted" style="font-size:.78rem">(đã ĐC ${iv.adjustment_total > 0 ? "+" : ""}${SM.vnd(iv.adjustment_total)})</span>` : ""}</td>
              <td class="r">${SM.vnd(iv.total)}${out > 0 ? `<br><span class="muted" style="font-size:.8rem">còn ${SM.vnd(out)}</span>` : ""}</td>
              <td class="r" style="white-space:nowrap">${PAYABLE.has(iv.status) ? `<button class="btn ghost" data-payinv="${iv.id}" style="padding:.25rem .5rem;font-size:.8rem">Thu</button>` : ""}
                <button class="btn ghost" data-adjinv="${iv.id}" style="padding:.25rem .5rem;font-size:.8rem">Điều chỉnh</button></td></tr>`; }).join("")}
        </table>` : `<p class="muted">Không có hóa đơn đang mở.</p>`}
        <h4 style="margin:.9rem 0 .3rem;font-family:var(--serif);">Lịch sử thu / hoàn</h4>
        ${(pays || []).length ? `<table class="inv-lines">
          ${(pays || []).slice().reverse().map(p => `<tr><td>${SM.dmy(p.paid_on)} · ${METHOD[p.method] || p.method}${p.invoice_id ? "" : " · trả trước"}</td>
            <td class="r" style="color:${p.is_refund ? "var(--danger)" : "var(--good)"}">${p.is_refund ? "−" : "+"}${SM.vnd(p.amount)}</td>
            <td class="r"><button class="btn ghost" data-receipt="${p.id}" style="padding:.25rem .5rem;font-size:.8rem">🧾</button></td></tr>`).join("")}
        </table>` : `<p class="muted">Chưa có giao dịch.</p>`}
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Đóng</button><button class="btn" data-paystu="${studentId}">➕ Thu tiền</button></div>`;
    ov.querySelector('[data-x="close"]').onclick = () => { ov.remove(); curLedger = null; };
  }

  /* ---------------- điều chỉnh hóa đơn đã chốt ---------------- */
  async function adjustForm(invoiceId) {
    const { data: inv } = await sb.from("invoices").select("*, student:students(full_name)").eq("id", invoiceId).single();
    if (!inv) return;
    if (inv.status === "draft") return SM.toast("Hóa đơn nháp — hãy sửa trực tiếp / tính lại ở mục Học phí.", "err");
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:440px;"><div class="mh"><h3>Điều chỉnh hóa đơn</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .6rem;">${MONTHS[inv.period_month - 1]}/${inv.period_year} · ${SM.esc(inv.student ? inv.student.full_name : "")} · hiện tại <b>${SM.vnd(inv.total)}</b></p>
        <div class="grid2">
          <div class="field"><label>Kiểu</label><select id="aj-sign"><option value="-1">Giảm trừ (−)</option><option value="1">Tăng thêm (+)</option></select></div>
          <div class="field"><label>Số tiền (VND) *</label><input id="aj-amount" type="number" min="0" value="0"></div>
        </div>
        <div class="field"><label>Lý do *</label><input id="aj-reason" placeholder="vd: giảm do nghỉ ốm, tính nhầm buổi…"></div>
        <p class="muted" style="font-size:.83rem;">Điều chỉnh <b>không ghi đè</b> hóa đơn gốc — hệ thống thêm một bút toán có truy vết và cập nhật tổng phải thu.</p>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="aj-save">💾 Lưu điều chỉnh</button>
        <span class="msg" id="aj-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#aj-save").addEventListener("click", async () => {
      const say = (t, e) => { const m = ov.querySelector("#aj-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const mag = Math.round(parseFloat(ov.querySelector("#aj-amount").value) || 0);
      if (mag <= 0) return say("Số tiền phải lớn hơn 0.", true);
      const reason = ov.querySelector("#aj-reason").value.trim();
      if (!reason) return say("Nhập lý do điều chỉnh.", true);
      const amount = mag * parseInt(ov.querySelector("#aj-sign").value, 10);
      ov.querySelector("#aj-save").disabled = true;
      // 1) bút toán điều chỉnh
      const e1 = (await sb.from("adjustments").insert({ student_id: inv.student_id, invoice_id: inv.id, amount, reason, created_by: ME.user.id })).error;
      if (e1) { ov.querySelector("#aj-save").disabled = false; return say("Lỗi: " + e1.message, true); }
      // 2) dòng hóa đơn (không đụng dòng gốc)
      await sb.from("invoice_lines").insert({ invoice_id: inv.id, kind: "adjustment", description: "Điều chỉnh: " + reason, quantity: 1, unit_amount: amount, amount });
      // 3) cập nhật tổng + trạng thái
      const newAdj = (inv.adjustment_total || 0) + amount;
      const newTotal = inv.subtotal - inv.discount_total + newAdj;
      await sb.from("invoices").update({ adjustment_total: newAdj, total: newTotal, updated_at: new Date().toISOString() }).eq("id", inv.id);
      await refreshInvoiceStatus(inv.id);
      ov.remove(); SM.toast("✓ Đã lưu điều chỉnh", "ok");
      if (curLedger) openLedger(curLedger); else if (st.tab === "balances") paintBalances();
    });
  }

  /* ---------------- điều khiển ---------------- */
  function onClick(e) {
    const b = e.target.closest("[data-tab],[data-act],[data-receipt],[data-delpay],[data-ledger],[data-paystu],[data-payinv],[data-adjinv]");
    if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; return st.tab === "pay" ? loadPayments() : paintBalances(); }
    if (b.dataset.act === "add") return payForm(null);
    if (b.dataset.receipt) return receipt(b.dataset.receipt);
    if (b.dataset.delpay) return deletePayment(b.dataset.delpay);
    if (b.dataset.ledger) return openLedger(b.dataset.ledger);
    if (b.dataset.paystu) { return sb.from("students").select("id,code,full_name").eq("id", b.dataset.paystu).single().then(({ data }) => payForm(data)); }
    if (b.dataset.payinv) { return sb.from("invoices").select("student_id").eq("id", b.dataset.payinv).single().then(({ data }) => sb.from("students").select("id,code,full_name").eq("id", data.student_id).single().then(r => payForm(r.data, b.dataset.payinv))); }
    if (b.dataset.adjinv) return adjustForm(b.dataset.adjinv);
  }

  return {
    _fn: { netPayments, invoiceOutstanding, invoiceStatusFor, computeStudentBalance, docSoTien },
    async render(el, me) {
      ME = me; box = el;
      if (!st.from) { const d = new Date(); st.from = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01"; st.to = SM.todayISO(); }
      const { data: s } = await sb.from("settings").select("center_name").limit(1).maybeSingle();
      if (s && s.center_name) CENTER = s.center_name;
      box.onclick = onClick; curLedger = null;
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      if (st.tab === "balances") paintBalances(); else loadPayments();
    }
  };
})();

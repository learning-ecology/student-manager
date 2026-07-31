/* ============================================================
   Giai đoạn 9 — Tổng quan (Dashboard)
   Thẻ số liệu bấm được (điều hướng nhanh) + nhắc nhở nội bộ:
   buổi chưa điểm danh hôm nay, hóa đơn quá hạn, hóa đơn nháp chưa
   chốt, học viên đang nợ. Tất cả số liệu lấy trực tiếp từ CSDL.
   ============================================================ */
window.Dashboard = (function () {
  let ME = null, box = null;
  const MONTHS = Array.from({ length: 12 }, (_, i) => "Tháng " + (i + 1));

  // helpers tiền (cùng logic đã kiểm thử ở GĐ7)
  const netPayments = list => (list || []).reduce((a, p) => a + (p.is_refund ? -p.amount : p.amount), 0);
  const invoiceOutstanding = (inv, pays) => inv.total - netPayments((pays || []).filter(p => p.invoice_id === inv.id));

  async function render(el, me) {
    ME = me; box = el;
    const hello = me.profile.full_name ? ", " + SM.esc(me.profile.full_name) : "";
    box.innerHTML = `<h1>Xin chào${hello} 👋</h1><div class="card placeholder"><span class="spinner"></span></div>`;

    const today = SM.todayISO();
    const monthStart = today.slice(0, 8) + "01";
    const nowMonth = +today.slice(5, 7), nowYear = +today.slice(0, 4);

    const [stu, clsC, drafts, sessR, invR, payR, classesR, teachersR] = await Promise.all([
      sb.from("students").select("id", { count: "exact", head: true }).eq("status", "active").is("archived_at", null),
      sb.from("classes").select("id", { count: "exact", head: true }).eq("status", "active").is("archived_at", null),
      sb.from("invoices").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("sessions").select("id,class_id,teacher_id,start_time,end_time,status,type").eq("date", today).neq("status", "cancelled").order("start_time"),
      sb.from("invoices").select("id,student_id,total,status,due_date").in("status", ["unpaid", "partially_paid", "paid", "overdue"]),
      sb.from("payments").select("student_id,invoice_id,amount,is_refund,paid_on"),
      SM.refClasses(), SM.refTeachers()
    ]);

    const sessions = sessR.data || [];
    const invoices = invR.data || [];
    const payments = payR.data || [];
    const classMap = {}; (classesR || []).forEach(c => classMap[c.id] = c.name);
    const teachMap = {}; (teachersR || []).forEach(t => teachMap[t.id] = t.full_name);

    // điểm danh hôm nay
    let marked = new Set();
    const sessIds = sessions.map(s => s.id);
    if (sessIds.length) { const { data: at } = await sb.from("attendance").select("session_id").in("session_id", sessIds); (at || []).forEach(a => marked.add(a.session_id)); }
    const sessMarked = sessions.filter(s => marked.has(s.id)).length;
    const sessUnmarked = sessions.length - sessMarked;

    // tài chính: số dư từng học viên + hóa đơn quá hạn + thu trong tháng
    const byStu = {};
    invoices.forEach(iv => (byStu[iv.student_id] = byStu[iv.student_id] || { inv: [], pay: [] }).inv.push(iv));
    payments.forEach(p => (byStu[p.student_id] = byStu[p.student_id] || { inv: [], pay: [] }).pay.push(p));
    let totalOwed = 0, owedStudents = 0;
    Object.values(byStu).forEach(b => {
      const ids = new Set(b.inv.map(i => i.id));
      const charged = b.inv.reduce((a, i) => a + i.total, 0);
      const paid = netPayments(b.pay.filter(p => !p.invoice_id || ids.has(p.invoice_id)));
      const bal = charged - paid;
      if (bal > 0) { totalOwed += bal; owedStudents++; }
    });
    let overdueCount = 0, overdueSum = 0;
    invoices.forEach(iv => { const out = invoiceOutstanding(iv, payments); if (out > 0 && iv.due_date && iv.due_date < today) { overdueCount++; overdueSum += out; } });
    const monthIn = payments.filter(p => p.paid_on >= monthStart).reduce((a, p) => a + (p.is_refund ? -p.amount : p.amount), 0);

    const draftCount = drafts.count || 0;

    // ---- nhắc nhở ----
    const rem = [];
    if (sessUnmarked > 0) rem.push(["#attendance", "🔴", `<b>${sessUnmarked}</b> buổi hôm nay chưa điểm danh`, "Điểm danh ngay"]);
    if (overdueCount > 0) rem.push(["#payments", "⏰", `<b>${overdueCount}</b> hóa đơn quá hạn · tổng <b>${SM.vnd(overdueSum)}</b>`, "Xem công nợ"]);
    if (draftCount > 0) rem.push(["#tuition", "📝", `<b>${draftCount}</b> hóa đơn nháp chưa chốt`, "Chốt hóa đơn"]);
    if (owedStudents > 0) rem.push(["#payments", "💰", `<b>${owedStudents}</b> học viên đang nợ học phí · tổng <b>${SM.vnd(totalOwed)}</b>`, "Thu tiền"]);

    const card = (href, k, v, sub) => `<a class="stat card" href="${href}"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></a>`;
    const SSTAT = { held: "Đã học", scheduled: "Theo lịch" };

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap;">
        <h1 style="margin:.2rem 0;">Xin chào${hello} 👋</h1>
        <span class="muted">${SM.WEEKDAYS[new Date(today + "T00:00:00").getDay()]}, ${SM.dmy(today)}</span>
      </div>
      <div class="sm-cards" style="margin:.6rem 0 1.2rem;">
        ${card("#students", "Học viên đang học", stu.count || 0, "đang theo học")}
        ${card("#classes", "Lớp đang mở", clsC.count || 0, "lớp hoạt động")}
        ${card("#attendance", "Buổi học hôm nay", sessions.length, sessions.length ? `${sessMarked}/${sessions.length} đã điểm danh` : "không có buổi")}
        ${card("#payments", "Thu trong " + MONTHS[nowMonth - 1], SM.vnd(monthIn), "tháng " + nowMonth + "/" + nowYear)}
        ${card("#payments", "Còn nợ học phí", SM.vnd(totalOwed), owedStudents ? owedStudents + " học viên" : "không có")}
      </div>

      <h2 style="font-size:1.15rem;margin:.4rem 0 .6rem;font-family:var(--serif);">🔔 Nhắc nhở</h2>
      ${rem.length ? `<div class="reminders" style="margin-bottom:1.2rem;">
        ${rem.map(([href, ic, txt, go]) => `<a class="rem" href="${href}"><span class="ic">${ic}</span><span class="txt">${txt}</span><span class="go">${go} →</span></a>`).join("")}
      </div>` : `<div class="card" style="padding:1rem 1.2rem;margin-bottom:1.2rem;display:flex;align-items:center;gap:.6rem;"><span style="font-size:1.3rem;">✅</span> <span>Mọi việc đều ổn — không có nhắc nhở nào.</span></div>`}

      <h2 style="font-size:1.15rem;margin:.4rem 0 .6rem;font-family:var(--serif);">📅 Buổi học hôm nay</h2>
      ${sessions.length ? `<div class="card" style="padding:.4rem .9rem;">
        ${sessions.map(s => `<a href="#attendance" style="display:flex;align-items:center;gap:1rem;padding:.55rem .1rem;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;">
          <b style="min-width:56px;">${SM.hm(s.start_time)}</b>
          <span style="flex:1;"><b>${SM.esc(classMap[s.class_id] || "—")}</b>${s.type !== "regular" ? ` <span class="badge mute">${s.type === "makeup" ? "Bù" : "Thêm"}</span>` : ""}<br>
            <span class="muted" style="font-size:.82rem;">GV ${SM.esc(teachMap[s.teacher_id] || "—")} · ${SM.hm(s.start_time)}–${SM.hm(s.end_time)}</span></span>
          ${marked.has(s.id) ? '<span class="badge ok">Đã điểm danh</span>' : '<span class="badge warn">Chưa điểm danh</span>'}
        </a>`).join("")}
      </div>` : `<div class="card placeholder" style="padding:1.6rem;"><p class="muted">Hôm nay không có buổi học nào theo lịch.</p></div>`}`;

    // đảm bảo hàng cuối không có viền dưới thừa
    const last = box.querySelector(".card > a:last-child"); if (last) last.style.borderBottom = "0";
  }

  return { render };
})();

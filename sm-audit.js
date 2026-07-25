/* ============================================================
   Giai đoạn 12 — Nhật ký thay đổi (audit log)
   Xem lịch sử mọi thay đổi (thêm/sửa/xóa) trên các bảng quan trọng.
   Chỉ CHỦ SỞ HỮU xem được (RLS đã chặn tài khoản khác ở CSDL).
   ============================================================ */
window.Audit = (function () {
  let ME = null, box = null;
  const st = { entity: "", action: "", from: "", to: "", page: 1, per: 30 };
  let rows = [], total = 0, users = {}, busy = false;

  const ENTITY = {
    students: "Học viên", classes: "Lớp học", enrollments: "Ghi danh", invoices: "Hóa đơn",
    payments: "Thanh toán", adjustments: "Điều chỉnh", transfers: "Chuyển lớp", attendance: "Điểm danh"
  };
  const ACTION = { INSERT: { l: "Thêm", c: "ok" }, UPDATE: { l: "Sửa", c: "warn" }, DELETE: { l: "Xóa", c: "bad" } };
  const NOISE = new Set(["updated_at", "created_at", "recorded_at", "id"]);

  const uName = id => id ? (users[id] || "Người dùng") : "Hệ thống";

  function recLabel(entity, o) {
    if (!o) return "";
    switch (entity) {
      case "students": return o.full_name || o.code || "";
      case "classes": return o.name || "";
      case "invoices": return "kỳ " + (o.period_month ? o.period_month + "/" + o.period_year : "") + (o.total != null ? " · " + SM.vnd(o.total) : "");
      case "payments": return SM.vnd(o.amount) + (o.is_refund ? " (hoàn)" : "");
      case "adjustments": return SM.vnd(o.amount);
      case "attendance": return o.status || "";
      case "transfers": return "";
      case "enrollments": return "";
      default: return "";
    }
  }
  function changed(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const out = [];
    keys.forEach(k => { if (NOISE.has(k)) return; if (JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k])) out.push(k); });
    return out;
  }
  function fmtVal(v) {
    if (v === null || v === undefined || v === "") return "(trống)";
    if (typeof v === "boolean") return v ? "có" : "không";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  function summary(e) {
    const lbl = recLabel(e.entity, e.after || e.before);
    if (e.action === "UPDATE") { const c = changed(e.before, e.after); return (lbl ? lbl + " · " : "") + c.length + " trường thay đổi"; }
    return lbl;
  }

  async function loadUsers() {
    const { data } = await sb.from("app_users").select("id,full_name");
    users = {}; (data || []).forEach(u => users[u.id] = u.full_name || "");
  }
  async function load() {
    busy = true; paint();
    let q = sb.from("audit_log").select("*", { count: "exact" }).order("at", { ascending: false });
    if (st.entity) q = q.eq("entity", st.entity);
    if (st.action) q = q.eq("action", st.action);
    if (st.from) q = q.gte("at", st.from + "T00:00:00");
    if (st.to) q = q.lte("at", st.to + "T23:59:59");
    const from = (st.page - 1) * st.per;
    q = q.range(from, from + st.per - 1);
    const { data, count, error } = await q;
    busy = false;
    if (error) { SM.toast("Lỗi tải nhật ký: " + error.message, "err"); rows = []; total = 0; }
    else { rows = data || []; total = count || 0; }
    const maxPage = Math.max(1, Math.ceil(total / st.per));
    if (st.page > maxPage) { st.page = maxPage; return load(); }
    paint();
  }

  function paint() {
    const pages = Math.max(1, Math.ceil(total / st.per));
    const showFrom = total ? (st.page - 1) * st.per + 1 : 0, showTo = Math.min(total, st.page * st.per);
    box.innerHTML = `
      <h1 style="margin:.2rem 0 .7rem;">Nhật ký thay đổi</h1>
      <p class="muted" style="margin:.1rem 0 .7rem;font-size:.9rem;">Ghi lại mọi thao tác thêm/sửa/xóa trên học viên, lớp, ghi danh, điểm danh, hóa đơn, thanh toán, điều chỉnh và chuyển lớp.</p>
      <div class="toolbar">
        <div class="field"><label>Đối tượng</label><select id="a-entity"><option value="">Tất cả</option>
          ${Object.entries(ENTITY).map(([k, v]) => `<option value="${k}" ${st.entity === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Thao tác</label><select id="a-action"><option value="">Tất cả</option>
          ${Object.entries(ACTION).map(([k, v]) => `<option value="${k}" ${st.action === k ? "selected" : ""}>${v.l}</option>`).join("")}</select></div>
        <div class="field"><label>Từ ngày</label><input id="a-from" value="${st.from ? SM.dmy(st.from) : ""}" placeholder="tất cả" style="width:120px;"></div>
        <div class="field"><label>Đến ngày</label><input id="a-to" value="${st.to ? SM.dmy(st.to) : ""}" placeholder="tất cả" style="width:120px;"></div>
      </div>
      ${busy ? `<div class="card placeholder"><span class="spinner"></span></div>`
        : total === 0 ? `<div class="card placeholder"><div class="big">📜</div><p class="muted">${st.entity || st.action || st.from ? "Không có bản ghi phù hợp." : "Chưa có nhật ký."}</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
            <th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Đối tượng</th><th>Nội dung</th><th></th></tr></thead><tbody>
          ${rows.map(e => `<tr>
            <td data-th="Thời gian">${SM.dmyhm(e.at)}</td>
            <td data-th="Người thực hiện">${SM.esc(uName(e.actor_id))}</td>
            <td data-th="Thao tác"><span class="badge ${(ACTION[e.action] || {}).c || "mute"}">${(ACTION[e.action] || {}).l || e.action}</span></td>
            <td data-th="Đối tượng">${ENTITY[e.entity] || e.entity}</td>
            <td data-th="Nội dung">${SM.esc(summary(e))}</td>
            <td class="cell-actions"><div class="row-actions"><button class="btn ghost" data-detail="${e.id}">Chi tiết</button></div></td>
          </tr>`).join("")}
        </tbody></table></div>
        <div class="pager"><span>Hiển thị ${showFrom}–${showTo} / ${total}</span>
          <div class="pages">
            <button data-nav="first" ${st.page === 1 ? "disabled" : ""}>«</button>
            <button data-nav="prev" ${st.page === 1 ? "disabled" : ""}>‹</button>
            <span>Trang ${st.page}/${pages}</span>
            <button data-nav="next" ${st.page >= pages ? "disabled" : ""}>›</button>
            <button data-nav="last" ${st.page >= pages ? "disabled" : ""}>»</button>
          </div></div>`}`;
    const bind = (id, ev, fn) => { const el = box.querySelector(id); if (el) el.addEventListener(ev, fn); };
    bind("#a-entity", "change", () => { st.entity = box.querySelector("#a-entity").value; st.page = 1; load(); });
    bind("#a-action", "change", () => { st.action = box.querySelector("#a-action").value; st.page = 1; load(); });
    bind("#a-from", "change", () => { const v = box.querySelector("#a-from").value.trim(); st.from = v ? SM.parseDmy(v) : ""; st.page = 1; load(); });
    bind("#a-to", "change", () => { const v = box.querySelector("#a-to").value.trim(); st.to = v ? SM.parseDmy(v) : ""; st.page = 1; load(); });
  }

  function detail(id) {
    const e = rows.find(r => r.id == id); if (!e) return;
    const act = ACTION[e.action] || { l: e.action, c: "mute" };
    let bodyHtml;
    if (e.action === "UPDATE") {
      const c = changed(e.before, e.after);
      bodyHtml = c.length ? `<table class="inv-lines"><thead><tr><th>Trường</th><th>Trước</th><th>Sau</th></tr></thead><tbody>
        ${c.map(k => `<tr><td><b>${SM.esc(k)}</b></td><td class="muted">${SM.esc(fmtVal((e.before || {})[k]))}</td><td>${SM.esc(fmtVal((e.after || {})[k]))}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">Không có trường nào thay đổi (chỉ cập nhật thời gian).</p>`;
    } else {
      const obj = e.after || e.before || {};
      const keys = Object.keys(obj).filter(k => !NOISE.has(k) && obj[k] !== null && obj[k] !== "");
      bodyHtml = `<table class="inv-lines"><tbody>
        ${keys.map(k => `<tr><td><b>${SM.esc(k)}</b></td><td class="r" style="text-align:left;">${SM.esc(fmtVal(obj[k]))}</td></tr>`).join("")}
      </tbody></table>`;
    }
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3><span class="badge ${act.c}">${act.l}</span> ${ENTITY[e.entity] || e.entity}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p class="muted" style="margin:.1rem 0 .6rem;font-size:.86rem;">${SM.dmyhm(e.at)} · ${SM.esc(uName(e.actor_id))}${e.entity_id ? " · mã bản ghi <code>" + SM.esc(String(e.entity_id).slice(0, 8)) + "</code>" : ""}</p>
        ${bodyHtml}
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Đóng</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", ev => { if (ev.target === ov || ev.target.dataset.x === "close") ov.remove(); });
  }

  function onClick(e) {
    const b = e.target.closest("[data-nav],[data-detail]");
    if (!b) return;
    if (b.dataset.detail) return detail(b.dataset.detail);
    if (b.dataset.nav === "first") st.page = 1;
    else if (b.dataset.nav === "prev") st.page--;
    else if (b.dataset.nav === "next") st.page++;
    else if (b.dataset.nav === "last") st.page = Math.max(1, Math.ceil(total / st.per));
    load();
  }

  return {
    async render(el, me) {
      ME = me; box = el;
      box.onclick = onClick;
      if (me.profile.role !== "owner") {
        box.innerHTML = `<h1>Nhật ký thay đổi</h1><div class="card placeholder"><div class="big">🔒</div><p class="muted">Chỉ <b>chủ sở hữu</b> mới xem được nhật ký thay đổi.</p></div>`;
        return;
      }
      box.innerHTML = `<h1>Nhật ký thay đổi</h1><div class="card placeholder"><span class="spinner"></span></div>`;
      await loadUsers();
      load();
    }
  };
})();

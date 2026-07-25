/* ============================================================
   Giai đoạn 2 — Quản lý học viên
   Thêm/sửa/tìm/lọc/lưu trữ/khôi phục · bảng có sắp xếp, phân trang,
   thẻ responsive trên mobile · ảnh đại diện · ngày DD/MM/YYYY.
   ============================================================ */
window.Students = (function () {
  let ME = null, box = null;
  const st = {
    q: "", status: "", archived: false,
    page: 1, per: 20, sortKey: "created_at", sortDir: "desc"
  };
  let rows = [], total = 0, busy = false;

  const STATUS = { active: "Đang học", paused: "Tạm dừng", completed: "Hoàn thành", withdrawn: "Đã nghỉ" };
  const STATUS_BADGE = { active: "ok", paused: "warn", completed: "mute", withdrawn: "bad" };
  const GENDER = { male: "Nam", female: "Nữ", other: "Khác" };
  const initials = n => (String(n || "?").trim().split(/\s+/).slice(-2).map(w => w[0]).join("") || "?").toUpperCase();

  async function load() {
    busy = true; paint();
    let query = sb.from("students").select("*", { count: "exact" });
    query = st.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (st.status) query = query.eq("status", st.status);
    if (st.q.trim()) {
      const q = st.q.trim().replace(/[%,]/g, " ");
      query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,code.ilike.%${q}%,guardian_phone.ilike.%${q}%`);
    }
    query = query.order(st.sortKey, { ascending: st.sortDir === "asc" });
    const from = (st.page - 1) * st.per;
    query = query.range(from, from + st.per - 1);
    const { data, count, error } = await query;
    busy = false;
    if (error) { SM.toast("Lỗi tải danh sách: " + error.message, "err"); rows = []; total = 0; paint(); return; }
    rows = data || []; total = count || 0;
    // nếu trang vượt quá số bản ghi (vd sau khi lọc), lùi về trang cuối
    const maxPage = Math.max(1, Math.ceil(total / st.per));
    if (st.page > maxPage) { st.page = maxPage; return load(); }
    paint();
  }

  function th(key, label) {
    const on = st.sortKey === key;
    const arw = on ? (st.sortDir === "asc" ? "▲" : "▼") : "";
    return `<th data-sort="${key}">${label} <span class="arw">${arw}</span></th>`;
  }

  function paint() {
    const pages = Math.max(1, Math.ceil(total / st.per));
    const showFrom = total ? (st.page - 1) * st.per + 1 : 0;
    const showTo = Math.min(total, st.page * st.per);
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <h1 style="margin:.2rem 0;">Học viên ${st.archived ? "· <span class='muted' style='font-size:1rem'>Đã lưu trữ</span>" : ""}</h1>
        ${!st.archived ? `<div class="row-actions"><button class="btn ghost" data-act="import">📥 Nhập hàng loạt</button><button class="btn" data-act="add">➕ Thêm học viên</button></div>` : ""}
      </div>
      <div class="toolbar">
        <div class="field" style="min-width:240px;flex:1;"><label>Tìm (tên, SĐT, mã, SĐT phụ huynh)</label>
          <input id="q" value="${SM.esc(st.q)}" placeholder="gõ để tìm…"></div>
        <div class="field"><label>Trạng thái</label>
          <select id="fstatus"><option value="">Tất cả</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${st.status === k ? "selected" : ""}>${v}</option>`).join("")}
          </select></div>
        <div class="field"><label>&nbsp;</label>
          <button class="btn ghost" data-act="togglearch">${st.archived ? "← Danh sách chính" : "🗄️ Xem đã lưu trữ"}</button></div>
      </div>
      ${busy ? `<div class="card placeholder"><span class="spinner"></span></div>`
        : total === 0 ? `<div class="card placeholder"><div class="big">🗒️</div>
            <p>${st.q || st.status ? "Không tìm thấy học viên phù hợp." : (st.archived ? "Chưa có học viên nào bị lưu trữ." : "Chưa có học viên nào. Bấm ➕ Thêm học viên để bắt đầu.")}</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table">
            <thead><tr>
              ${th("code", "Mã")}<th>Ảnh</th>${th("full_name", "Họ tên")}
              <th>SĐT</th><th>Phụ huynh</th>${th("status", "Trạng thái")}${th("enrolled_on", "Nhập học")}<th></th>
            </tr></thead>
            <tbody>${rows.map(rowHtml).join("")}</tbody>
          </table></div>
          <div class="pager">
            <span>Hiển thị ${showFrom}–${showTo} / ${total}</span>
            <div class="pages">
              <label class="muted">Mỗi trang</label>
              <select id="per">${[10, 20, 50, 100].map(n => `<option ${st.per === n ? "selected" : ""}>${n}</option>`).join("")}</select>
              <button data-act="first" ${st.page === 1 ? "disabled" : ""}>«</button>
              <button data-act="prev" ${st.page === 1 ? "disabled" : ""}>‹</button>
              <span>Trang ${st.page}/${pages}</span>
              <button data-act="next" ${st.page >= pages ? "disabled" : ""}>›</button>
              <button data-act="last" ${st.page >= pages ? "disabled" : ""}>»</button>
            </div>
          </div>`}`;
    wire();
  }

  function rowHtml(s) {
    const av = s.photo_url
      ? `<img class="avatar" src="${SM.esc(s.photo_url)}" alt="">`
      : `<span class="avatar">${SM.esc(initials(s.full_name))}</span>`;
    return `<tr>
      <td data-th="Mã"><code>${SM.esc(s.code)}</code></td>
      <td data-th="Ảnh">${av}</td>
      <td data-th="Họ tên"><b>${SM.esc(s.full_name)}</b>${s.dob ? `<br><span class="muted" style="font-size:.82rem">${SM.dmy(s.dob)}${s.gender ? " · " + (GENDER[s.gender] || "") : ""}</span>` : ""}</td>
      <td data-th="SĐT">${SM.esc(s.phone || "—")}</td>
      <td data-th="Phụ huynh">${s.guardian_name ? SM.esc(s.guardian_name) : "—"}${s.guardian_phone ? `<br><span class="muted" style="font-size:.82rem">${SM.esc(s.guardian_phone)}</span>` : ""}</td>
      <td data-th="Trạng thái"><span class="badge ${STATUS_BADGE[s.status] || "mute"}">${STATUS[s.status] || s.status}</span></td>
      <td data-th="Nhập học">${SM.dmy(s.enrolled_on)}</td>
      <td class="cell-actions"><div class="row-actions">
        <button class="btn ghost" data-hist="${s.id}">Lịch sử lớp</button>
        <button class="btn ghost" data-edit="${s.id}">Sửa</button>
        ${st.archived
          ? `<button class="btn ghost" data-restore="${s.id}">Khôi phục</button>`
          : `<button class="btn ghost" data-arch="${s.id}" style="color:var(--danger);border-color:var(--danger)">Lưu trữ</button>`}
      </div></td>
    </tr>`;
  }

  // ---------- form (thêm/sửa) ----------
  function form(s) {
    s = s || {};
    const isNew = !s.id;
    const g = (k, d = "") => s[k] == null ? d : s[k];
    const ov = document.createElement("div");
    ov.className = "sm-ov";
    ov.innerHTML = `
      <div class="sm-modal">
        <div class="mh"><h3>${isNew ? "➕ Thêm học viên" : "✏️ Sửa: " + SM.esc(s.full_name)}</h3>
          <button class="btn ghost" data-x="close">✕</button></div>
        <div class="mb">
          <div class="photo-drop" id="photoDrop">
            <img id="photoPrev" src="${SM.esc(g("photo_url"))}" alt="" ${g("photo_url") ? "" : 'style="display:none"'}>
            <span class="avatar" id="photoInit" ${g("photo_url") ? 'style="display:none"' : ""}>${SM.esc(initials(g("full_name")))}</span>
            <div><b>Ảnh đại diện</b><br><span class="muted" style="font-size:.85rem">Bấm để chọn (JPG/PNG, ≤5MB)</span>
              <div id="photoMsg" class="msg"></div></div>
            <input type="file" id="photoFile" accept="image/*" hidden>
            <input type="hidden" id="f-photo" value="${SM.esc(g("photo_url"))}">
          </div>
          <div class="grid2" style="margin-top:.9rem;">
            <div class="field" style="grid-column:1/-1"><label>Họ và tên *</label><input id="f-name" value="${SM.esc(g("full_name"))}"></div>
            <div class="field"><label>Ngày sinh (DD/MM/YYYY)</label><input id="f-dob" value="${s.dob ? SM.dmy(s.dob) : ""}" placeholder="01/09/2010"></div>
            <div class="field"><label>Giới tính</label><select id="f-gender">
              <option value="">—</option>${Object.entries(GENDER).map(([k, v]) => `<option value="${k}" ${g("gender") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
            <div class="field"><label>SĐT học viên</label><input id="f-phone" value="${SM.esc(g("phone"))}"></div>
            <div class="field"><label>Email</label><input id="f-email" value="${SM.esc(g("email"))}"></div>
            <div class="field"><label>Tên phụ huynh</label><input id="f-gname" value="${SM.esc(g("guardian_name"))}"></div>
            <div class="field"><label>SĐT phụ huynh</label><input id="f-gphone" value="${SM.esc(g("guardian_phone"))}"></div>
            <div class="field" style="grid-column:1/-1"><label>Địa chỉ</label><input id="f-address" value="${SM.esc(g("address"))}"></div>
            <div class="field"><label>Ngày nhập học (DD/MM/YYYY)</label><input id="f-enrolled" value="${s.enrolled_on ? SM.dmy(s.enrolled_on) : SM.dmy(SM.todayISO())}"></div>
            <div class="field"><label>Trạng thái</label><select id="f-status">
              ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${g("status", "active") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
            <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea id="f-notes" style="min-height:60px">${SM.esc(g("notes"))}</textarea></div>
          </div>
          ${isNew ? `<p class="muted" style="font-size:.85rem">Mã học viên sẽ tự sinh khi lưu.</p>`
                  : `<p class="muted" style="font-size:.85rem">Mã: <code>${SM.esc(s.code)}</code></p>`}
        </div>
        <div class="mf">
          <button class="btn ghost" data-x="close">Hủy</button>
          <button class="btn" id="save">💾 Lưu</button>
          <span class="msg" id="fmsg" style="align-self:center"></span>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });

    // photo upload
    const drop = ov.querySelector("#photoDrop"), file = ov.querySelector("#photoFile");
    const prev = ov.querySelector("#photoPrev"), init = ov.querySelector("#photoInit");
    const hid = ov.querySelector("#f-photo"), pmsg = ov.querySelector("#photoMsg");
    drop.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { pmsg.textContent = "Chỉ nhận file ảnh."; pmsg.className = "msg err"; return; }
      if (f.size > 5 * 1024 * 1024) { pmsg.textContent = "Ảnh > 5MB."; pmsg.className = "msg err"; return; }
      pmsg.textContent = "Đang tải lên…"; pmsg.className = "msg";
      try {
        const blob = await resize(f, 400);
        const path = "s-" + Date.now() + ".jpg";
        const { error } = await sb.storage.from("student-photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (error) throw error;
        const url = sb.storage.from("student-photos").getPublicUrl(path).data.publicUrl;
        hid.value = url; prev.src = url; prev.style.display = ""; init.style.display = "none";
        pmsg.textContent = "✓ Đã tải ảnh.";
      } catch (e) { pmsg.textContent = "Lỗi tải ảnh: " + (e.message || e); pmsg.className = "msg err"; }
    });

    ov.querySelector("#save").addEventListener("click", () => save(ov, s));
  }

  function resize(file, max) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        cv.toBlob(b => b ? res(b) : rej(new Error("resize")), "image/jpeg", 0.85);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }

  async function save(ov, s) {
    const V = id => ov.querySelector("#" + id).value;
    const msg = ov.querySelector("#fmsg");
    const say = (t, e) => { msg.textContent = t; msg.className = "msg" + (e ? " err" : ""); };
    const name = V("f-name").trim();
    if (!name) return say("Thiếu họ tên.", true);
    const dobRaw = V("f-dob").trim(), enrRaw = V("f-enrolled").trim();
    const dob = dobRaw ? SM.parseDmy(dobRaw) : null;
    if (dobRaw && !dob) return say("Ngày sinh không hợp lệ (DD/MM/YYYY).", true);
    const enrolled = enrRaw ? SM.parseDmy(enrRaw) : SM.todayISO();
    if (enrRaw && !enrolled) return say("Ngày nhập học không hợp lệ (DD/MM/YYYY).", true);
    const email = V("f-email").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Email không hợp lệ.", true);

    const row = {
      full_name: name, photo_url: V("f-photo") || null,
      dob, gender: V("f-gender") || null,
      phone: V("f-phone").trim(), email,
      guardian_name: V("f-gname").trim(), guardian_phone: V("f-gphone").trim(),
      address: V("f-address").trim(), enrolled_on: enrolled,
      status: V("f-status"), notes: V("f-notes").trim(),
      updated_at: new Date().toISOString()
    };
    ov.querySelector("#save").disabled = true;
    let error;
    if (s.id) ({ error } = await sb.from("students").update(row).eq("id", s.id));
    else ({ error } = await sb.from("students").insert(row));   // code tự sinh bởi DB
    ov.querySelector("#save").disabled = false;
    if (error) return say("Không lưu được: " + error.message, true);
    ov.remove(); SM.toast("✓ Đã lưu học viên", "ok"); load();
  }

  async function archive(id, on) {
    const s = rows.find(r => r.id === id);
    const ok = await SM.confirmDialog({
      title: on ? "Lưu trữ học viên?" : "Khôi phục học viên?",
      danger: on, okText: on ? "Lưu trữ" : "Khôi phục",
      body: on ? `Ẩn <b>${SM.esc(s.full_name)}</b> khỏi danh sách chính. <b>Toàn bộ điểm danh, học phí, thanh toán vẫn được giữ nguyên</b> và có thể khôi phục bất cứ lúc nào.`
               : `Đưa <b>${SM.esc(s.full_name)}</b> trở lại danh sách chính.`
    });
    if (!ok) return;
    const { error } = await sb.from("students").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", id);
    if (error) return SM.toast("Lỗi: " + error.message, "err");
    SM.toast(on ? "🗄️ Đã lưu trữ" : "↩ Đã khôi phục", "ok"); load();
  }

  let deb = null;
  function wire() {
    box.querySelectorAll("[data-sort]").forEach(h => h.addEventListener("click", () => {
      const k = h.getAttribute("data-sort");
      if (st.sortKey === k) st.sortDir = st.sortDir === "asc" ? "desc" : "asc";
      else { st.sortKey = k; st.sortDir = "asc"; }
      st.page = 1; load();
    }));
    const q = box.querySelector("#q");
    if (q) q.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { st.q = q.value; st.page = 1; load(); }, 300); });
    const fs = box.querySelector("#fstatus");
    if (fs) fs.addEventListener("change", () => { st.status = fs.value; st.page = 1; load(); });
    const per = box.querySelector("#per");
    if (per) per.addEventListener("change", () => { st.per = +per.value; st.page = 1; load(); });
    box.onclick = onClick;   // gán (không cộng dồn) để không bị bấm 1 lần chạy nhiều lần
  }
  function onClick(e) {
    const b = e.target.closest("[data-act],[data-edit],[data-arch],[data-restore],[data-hist]");
    if (!b) return;
    if (b.dataset.hist) return historyModal(rows.find(r => r.id === b.dataset.hist));
    if (b.dataset.act === "add") return form(null);
    if (b.dataset.act === "import") return importModal();
    if (b.dataset.act === "togglearch") { st.archived = !st.archived; st.page = 1; st.status = ""; return load(); }
    if (b.dataset.act === "first") { st.page = 1; return load(); }
    if (b.dataset.act === "prev") { st.page--; return load(); }
    if (b.dataset.act === "next") { st.page++; return load(); }
    if (b.dataset.act === "last") { st.page = Math.max(1, Math.ceil(total / st.per)); return load(); }
    if (b.dataset.edit) return form(rows.find(r => r.id === b.dataset.edit));
    if (b.dataset.arch) return archive(b.dataset.arch, true);
    if (b.dataset.restore) return archive(b.dataset.restore, false);
  }

  /* ============ GĐ8 — Lịch sử lớp học · chuyển lớp · rời lớp ============ */
  async function historyModal(s) {
    if (!s) return;
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>Lịch sử lớp học · ${SM.esc(s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="card placeholder"><span class="spinner"></span></div></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.addEventListener("click", onHist);

    let enrolls = [], transfers = [], classesList = [];
    const cn = id => (classesList.find(c => c.id === id) || {}).name || "—";

    async function load() {
      const [enrR, trsR, clsR] = await Promise.all([
        sb.from("enrollments").select("*").eq("student_id", s.id).order("joined_on"),
        sb.from("transfers").select("*").eq("student_id", s.id).order("transfer_date"),
        sb.from("classes").select("id,name,archived_at")
      ]);
      enrolls = enrR.data || []; transfers = trsR.data || []; classesList = clsR.data || [];
      const active = enrolls.filter(e => e.status === "active");
      const former = enrolls.filter(e => e.status === "former");
      ov.querySelector(".sm-modal").innerHTML = `
        <div class="mh"><h3>Lịch sử lớp học · ${SM.esc(s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
        <div class="mb">
          <h4 style="margin:.2rem 0 .4rem;font-family:var(--serif);">Lớp đang học (${active.length})</h4>
          ${active.length ? active.map(e => `<div class="card" style="padding:.7rem .9rem;margin-bottom:.5rem;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">
              <div><b>${SM.esc(cn(e.class_id))}</b><br><span class="muted" style="font-size:.82rem;">Vào lớp ${SM.dmy(e.joined_on)}${e.tuition_override ? " · học phí riêng " + SM.vnd(e.tuition_override) : ""}${e.discount_percent ? " · giảm " + e.discount_percent + "%" : ""}${e.discount_amount ? " · giảm " + SM.vnd(e.discount_amount) : ""}</span></div>
              <div class="row-actions">
                <button class="btn ghost" data-transfer="${e.id}">↔ Chuyển lớp</button>
                <button class="btn ghost" data-leave="${e.id}" style="color:var(--danger);border-color:var(--danger)">Rời lớp</button>
              </div></div>`).join("") : `<p class="muted">Chưa học lớp nào. Thêm vào lớp ở mục Lớp học → chọn lớp → Học viên.</p>`}
          ${former.length ? `<h4 style="margin:1rem 0 .4rem;font-family:var(--serif);">Lớp đã rời (${former.length})</h4>
            ${former.map(e => `<div class="card" style="padding:.6rem .9rem;margin-bottom:.5rem;opacity:.85;">
              <b>${SM.esc(cn(e.class_id))}</b> <span class="muted" style="font-size:.82rem;">· ${SM.dmy(e.joined_on)} → ${SM.dmy(e.left_on)}</span>
              ${e.notes ? `<br><span class="muted" style="font-size:.82rem;">${SM.esc(e.notes)}</span>` : ""}</div>`).join("")}` : ""}
          ${transfers.length ? `<h4 style="margin:1rem 0 .4rem;font-family:var(--serif);">Lịch sử chuyển lớp (${transfers.length})</h4>
            <table class="inv-lines">${transfers.slice().reverse().map(t => `<tr>
              <td style="white-space:nowrap;vertical-align:top;">${SM.dmy(t.transfer_date)}</td>
              <td>${SM.esc(cn(t.from_class_id))} → <b>${SM.esc(cn(t.to_class_id))}</b>${t.reason ? `<br><span class="muted" style="font-size:.8rem;">${SM.esc(t.reason)}</span>` : ""}</td>
              <td class="r" style="vertical-align:top;">${t.credit_transferred ? "tín dụng " + SM.vnd(t.credit_transferred) : ""}</td></tr>`).join("")}</table>` : ""}
        </div>
        <div class="mf"><button class="btn ghost" data-x="close">Đóng</button></div>`;
    }
    function onHist(e) {
      const b = e.target.closest("[data-transfer],[data-leave]"); if (!b) return;
      const enr = enrolls.find(x => x.id === (b.dataset.transfer || b.dataset.leave)); if (!enr) return;
      if (b.dataset.transfer) transferForm(enr, s, classesList, cn, load);
      else leaveForm(enr, s, cn, load);
    }
    await load();
  }

  function transferForm(enr, s, classesList, cn, refresh) {
    const others = classesList.filter(c => c.id !== enr.class_id && !c.archived_at);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:470px;"><div class="mh"><h3>Chuyển lớp · ${SM.esc(s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field"><label>Từ lớp</label><input value="${SM.esc(cn(enr.class_id))}" disabled></div>
        <div class="field"><label>Sang lớp *</label><select id="tf-to"><option value="">— chọn lớp —</option>${others.map(c => `<option value="${c.id}">${SM.esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Ngày chuyển (DD/MM/YYYY)</label><input id="tf-date" value="${SM.dmy(SM.todayISO())}"></div>
        <div class="field"><label>Tín dụng chuyển theo (VND)</label><input id="tf-credit" type="number" min="0" value="0"></div>
        <div class="field" style="grid-column:1/-1"><label>Lý do</label><input id="tf-reason" placeholder="vd: đổi lịch học, nâng trình độ…"></div>
      </div>
      <p class="muted" style="font-size:.83rem;">Kết thúc ghi danh lớp cũ (giữ nguyên lịch sử điểm danh & học phí) và mở ghi danh lớp mới từ ngày chuyển. Học phí tháng chuyển tự tách theo ngày. Số dư/tín dụng của học viên vốn áp dụng cho mọi lớp.</p></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="tf-go">↔ Chuyển lớp</button><span class="msg" id="tf-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#tf-go").addEventListener("click", async () => {
      const say = (t, er) => { const m = ov.querySelector("#tf-msg"); m.textContent = t; m.className = "msg" + (er ? " err" : ""); };
      const to = ov.querySelector("#tf-to").value; if (!to) return say("Chọn lớp mới.", true);
      const date = SM.parseDmy(ov.querySelector("#tf-date").value.trim()); if (!date) return say("Ngày chuyển không hợp lệ.", true);
      if (date < enr.joined_on) return say("Ngày chuyển phải sau ngày vào lớp cũ (" + SM.dmy(enr.joined_on) + ").", true);
      const credit = Math.max(0, parseInt(ov.querySelector("#tf-credit").value, 10) || 0);
      const reason = ov.querySelector("#tf-reason").value.trim();
      ov.querySelector("#tf-go").disabled = true;
      const { error } = await sb.rpc("transfer_student", { p_student: s.id, p_from_class: enr.class_id, p_to_class: to, p_date: date, p_reason: reason, p_credit: credit, p_notes: "" });
      if (error) { ov.querySelector("#tf-go").disabled = false; return say("Lỗi chuyển: " + error.message, true); }
      ov.remove(); SM.toast("✓ Đã chuyển lớp", "ok"); refresh();
    });
  }

  function leaveForm(enr, s, cn, refresh) {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:440px;"><div class="mh"><h3>Rời lớp · ${SM.esc(s.full_name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <p style="margin:.1rem 0 .6rem;">Kết thúc ghi danh của <b>${SM.esc(s.full_name)}</b> ở lớp <b>${SM.esc(cn(enr.class_id))}</b>. Lịch sử điểm danh & học phí vẫn được giữ.</p>
        <div class="field"><label>Ngày rời lớp (DD/MM/YYYY) *</label><input id="lv-date" value="${SM.dmy(SM.todayISO())}"></div>
        <div class="field"><label>Lý do</label><input id="lv-reason" placeholder="vd: chuyển trường, nghỉ dài hạn…"></div>
        <p class="muted" style="font-size:.83rem;">Học phí chỉ tính các buổi đến ngày rời lớp. Hóa đơn <b>đã chốt</b> (nếu có) cần điều chỉnh tay ở mục Thanh toán.</p>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn danger" id="lv-go">Rời lớp</button><span class="msg" id="lv-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#lv-go").addEventListener("click", async () => {
      const say = (t, er) => { const m = ov.querySelector("#lv-msg"); m.textContent = t; m.className = "msg" + (er ? " err" : ""); };
      const date = SM.parseDmy(ov.querySelector("#lv-date").value.trim()); if (!date) return say("Ngày không hợp lệ.", true);
      if (date < enr.joined_on) return say("Ngày rời phải sau ngày vào lớp (" + SM.dmy(enr.joined_on) + ").", true);
      const reason = ov.querySelector("#lv-reason").value.trim();
      const noteVal = (enr.notes ? enr.notes + " · " : "") + "Rời lớp " + SM.dmy(date) + (reason ? ": " + reason : "");
      ov.querySelector("#lv-go").disabled = true;
      const { error } = await sb.from("enrollments").update({ status: "former", left_on: date, notes: noteVal }).eq("id", enr.id);
      if (error) { ov.querySelector("#lv-go").disabled = false; return say("Lỗi: " + error.message, true); }
      ov.remove(); SM.toast("✓ Đã cho rời lớp", "ok"); refresh();
    });
  }

  /* ============ GĐ11 — Nhập học viên hàng loạt (CSV / dán) ============ */
  const IMP_COLS = ["full_name", "dob", "gender", "phone", "email", "guardian_name", "guardian_phone", "address", "enrolled_on", "notes"];
  const normPhone = s => String(s || "").replace(/[^\d]/g, "");
  const normName = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  function mapGender(v) {
    v = (v || "").trim().toLowerCase();
    if (!v) return { ok: true, val: null };
    if (["nam", "male", "m", "trai", "boy"].includes(v)) return { ok: true, val: "male" };
    if (["nữ", "nu", "female", "f", "gái", "gai", "girl"].includes(v)) return { ok: true, val: "female" };
    if (["khác", "khac", "other", "o"].includes(v)) return { ok: true, val: "other" };
    return { ok: false };
  }
  function parseDelimited(text, delim) {
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== '\r') field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  async function parseAndValidate(text) {
    const delim = text.includes("\t") ? "\t" : ",";
    let rows = parseDelimited(text, delim).filter(r => r.some(c => (c || "").trim() !== ""));
    if (rows.length) {
      const first = (rows[0][0] || "").trim().toLowerCase();
      if (/họ tên|ho ten|^tên$|^name$|fullname|học viên/.test(first)) rows = rows.slice(1);
    }
    const { data: existing } = await sb.from("students").select("full_name,phone");
    const exPhone = new Set(), exName = new Set();
    (existing || []).forEach(s => { if (s.phone) exPhone.add(normPhone(s.phone)); if (s.full_name) exName.add(normName(s.full_name)); });
    const seenPhone = new Set(), seenName = new Set();
    const today = SM.todayISO();
    return rows.map(cells => {
      const raw = {}; IMP_COLS.forEach((k, i) => raw[k] = (cells[i] || "").trim());
      if (!raw.full_name) return { raw, status: "error", msg: "Thiếu họ tên" };
      let dob = null;
      if (raw.dob) { dob = SM.parseDmy(raw.dob); if (!dob) return { raw, status: "error", msg: "Ngày sinh sai (DD/MM/YYYY)" }; }
      const g = mapGender(raw.gender); if (!g.ok) return { raw, status: "error", msg: "Giới tính phải là Nam/Nữ/Khác" };
      if (raw.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.email)) return { raw, status: "error", msg: "Email không hợp lệ" };
      let enrolled = today;
      if (raw.enrolled_on) { enrolled = SM.parseDmy(raw.enrolled_on); if (!enrolled) return { raw, status: "error", msg: "Ngày nhập học sai (DD/MM/YYYY)" }; }
      const np = normPhone(raw.phone), nn = normName(raw.full_name);
      let dupMsg = "";
      if (np && (exPhone.has(np) || seenPhone.has(np))) dupMsg = "Trùng SĐT";
      else if (exName.has(nn) || seenName.has(nn)) dupMsg = "Trùng họ tên";
      if (np) seenPhone.add(np); seenName.add(nn);
      const row = { full_name: raw.full_name, dob, gender: g.val, phone: raw.phone, email: raw.email,
        guardian_name: raw.guardian_name, guardian_phone: raw.guardian_phone, address: raw.address,
        enrolled_on: enrolled, status: "active", notes: raw.notes };
      return dupMsg ? { raw, status: "dup", msg: dupMsg, row } : { raw, status: "ok", msg: "", row };
    });
  }

  function importModal() {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>📥 Nhập học viên hàng loạt</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb" id="imp-body"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    const body = ov.querySelector("#imp-body");
    let parsed = [];

    function step1() {
      body.innerHTML = `
        <p class="muted" style="margin:.1rem 0 .6rem;font-size:.88rem;">Dán dữ liệu từ Excel/Google Sheets (mỗi học viên một dòng) hoặc chọn tệp CSV. Thứ tự cột:</p>
        <div class="card" style="padding:.5rem .7rem;font-size:.8rem;overflow-x:auto;white-space:nowrap;margin-bottom:.5rem;">
          <b>Họ tên</b> · Ngày sinh (DD/MM/YYYY) · Giới tính (Nam/Nữ) · SĐT · Email · Tên phụ huynh · SĐT phụ huynh · Địa chỉ · Ngày nhập học · Ghi chú</div>
        <p class="muted" style="font-size:.82rem;margin:0 0 .5rem;">Chỉ <b>Họ tên</b> bắt buộc; các cột sau có thể để trống hoặc lược bớt. Dòng tiêu đề (nếu có) tự bỏ qua.</p>
        <textarea id="imp-text" style="min-height:150px;font-family:ui-monospace,monospace;font-size:.82rem;" placeholder="Nguyễn Văn An&#9;01/09/2010&#9;Nam&#9;0901234567&#10;Trần Thị Bích&#9;15/03/2011&#9;Nữ&#9;0912345678"></textarea>
        <div class="toolbar" style="margin-top:.5rem;align-items:center;">
          <label class="btn ghost" style="cursor:pointer;">📄 Chọn tệp CSV<input type="file" id="imp-file" accept=".csv,.tsv,.txt" hidden></label>
          <span style="flex:1"></span>
          <button class="btn" id="imp-preview">Xem trước →</button>
        </div>
        <p class="msg" id="imp-msg"></p>`;
      body.querySelector("#imp-file").addEventListener("change", async e => {
        const f = e.target.files[0]; if (!f) return;
        body.querySelector("#imp-text").value = await f.text();
      });
      body.querySelector("#imp-preview").addEventListener("click", async () => {
        const text = body.querySelector("#imp-text").value;
        if (!text.trim()) { const m = body.querySelector("#imp-msg"); m.textContent = "Chưa có dữ liệu."; m.className = "msg err"; return; }
        body.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
        parsed = await parseAndValidate(text);
        step2();
      });
    }

    function step2() {
      const ok = parsed.filter(r => r.status === "ok");
      const dup = parsed.filter(r => r.status === "dup");
      const err = parsed.filter(r => r.status === "error");
      const badge = { ok: '<span class="badge ok">Mới</span>', dup: '<span class="badge warn">Trùng</span>', error: '<span class="badge bad">Lỗi</span>' };
      const show = parsed.slice(0, 200);
      body.innerHTML = `
        <div class="toolbar" style="justify-content:space-between;align-items:center;">
          <button class="btn ghost" id="imp-back">← Sửa dữ liệu</button>
          <span><b>${ok.length}</b> mới · <b>${dup.length}</b> trùng · <b>${err.length}</b> lỗi</span>
        </div>
        ${dup.length ? `<label style="display:flex;align-items:center;gap:.5rem;margin:.2rem 0 .5rem;font-weight:600;"><input type="checkbox" id="imp-skipdup" checked style="width:auto"> Bỏ qua ${dup.length} dòng trùng (theo SĐT hoặc họ tên)</label>` : ""}
        <div class="sm-table-wrap" style="max-height:320px;overflow:auto;"><table class="sm-table"><thead><tr><th>#</th><th>Tình trạng</th><th>Họ tên</th><th>SĐT</th><th>Ngày sinh</th><th>Ghi chú</th></tr></thead><tbody>
          ${show.map((r, i) => `<tr>
            <td>${i + 1}</td><td>${badge[r.status]}</td>
            <td><b>${SM.esc(r.raw.full_name || "")}</b></td>
            <td>${SM.esc(r.raw.phone || "")}</td>
            <td>${SM.esc(r.raw.dob || "")}</td>
            <td style="font-size:.82rem;color:${r.status === "error" ? "var(--danger)" : "var(--muted)"}">${SM.esc(r.msg || "")}</td>
          </tr>`).join("")}
        </tbody></table></div>
        ${parsed.length > 200 ? `<p class="muted" style="font-size:.8rem;margin:.3rem 0 0;">Hiển thị 200/${parsed.length} dòng đầu; tất cả sẽ được xử lý khi nhập.</p>` : ""}
        <div class="mf" style="position:static;padding:.9rem 0 0;border:0;">
          <span class="msg" id="imp-msg2" style="margin-right:auto;"></span>
          <button class="btn ghost" data-x="close">Hủy</button>
          <button class="btn" id="imp-go">💾 Nhập</button>
        </div>`;
      body.querySelector("#imp-back").addEventListener("click", step1);
      const goBtn = body.querySelector("#imp-go");
      const skipEl = body.querySelector("#imp-skipdup");
      const nToImport = () => ok.length + (skipEl && !skipEl.checked ? dup.length : 0);
      const relabel = () => { const n = nToImport(); goBtn.textContent = "💾 Nhập " + n + " học viên"; goBtn.disabled = n === 0; };
      if (skipEl) skipEl.addEventListener("change", relabel);
      relabel();
      goBtn.addEventListener("click", async () => {
        const toInsert = parsed.filter(r => r.status === "ok" || (r.status === "dup" && skipEl && !skipEl.checked)).map(r => r.row);
        if (!toInsert.length) return;
        goBtn.disabled = true;
        const m = body.querySelector("#imp-msg2"); m.textContent = "Đang nhập…"; m.className = "msg";
        let done = 0, failed = 0;
        for (let i = 0; i < toInsert.length; i += 100) {
          const { error } = await sb.from("students").insert(toInsert.slice(i, i + 100));
          if (error) failed += Math.min(100, toInsert.length - i); else done += Math.min(100, toInsert.length - i);
        }
        ov.remove();
        SM.toast(`✓ Đã nhập ${done} học viên` + (failed ? ` · lỗi ${failed}` : ""), failed ? "err" : "ok");
        load();
      });
    }

    step1();
  }

  return {
    _import: { parseDelimited, parseAndValidate, mapGender, normPhone, normName },   // để kiểm thử
    render(el, me) { ME = me; box = el; load(); }
  };
})();

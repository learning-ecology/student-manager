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
        ${!st.archived ? `<button class="btn" data-act="add">➕ Thêm học viên</button>` : ""}
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
    const b = e.target.closest("[data-act],[data-edit],[data-arch],[data-restore]");
    if (!b) return;
    if (b.dataset.act === "add") return form(null);
    if (b.dataset.act === "togglearch") { st.archived = !st.archived; st.page = 1; st.status = ""; return load(); }
    if (b.dataset.act === "first") { st.page = 1; return load(); }
    if (b.dataset.act === "prev") { st.page--; return load(); }
    if (b.dataset.act === "next") { st.page++; return load(); }
    if (b.dataset.act === "last") { st.page = Math.max(1, Math.ceil(total / st.per)); return load(); }
    if (b.dataset.edit) return form(rows.find(r => r.id === b.dataset.edit));
    if (b.dataset.arch) return archive(b.dataset.arch, true);
    if (b.dataset.restore) return archive(b.dataset.restore, false);
  }

  return {
    render(el, me) { ME = me; box = el; load(); }
  };
})();

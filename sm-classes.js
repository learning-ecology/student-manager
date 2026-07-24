/* ============================================================
   Giai đoạn 3 — Lớp học & ghi danh
   CRUD lớp (thêm/sửa/nhân bản/lưu trữ/khôi phục) · sĩ số · danh sách
   học viên hiện tại / đã rời · thêm nhiều học viên · gỡ · chuyển lớp
   (an toàn qua RPC) · thao tác hàng loạt.
   ============================================================ */
window.Classes = (function () {
  let ME = null, box = null;
  let view = "list", curId = null;
  const stL = { q: "", status: "", archived: false, page: 1, per: 20, sortKey: "created_at", sortDir: "desc" };
  let classes = [], totalC = 0, teachers = [], counts = {}, busy = false;
  let roster = [], rosterBusy = false, showFormer = false;
  const sel = new Set();

  const CSTATUS = { planned: "Sắp mở", active: "Đang học", completed: "Đã kết thúc" };
  const CBADGE = { planned: "warn", active: "ok", completed: "mute" };
  const METHOD = { per_scheduled: "Theo buổi có lịch", per_attended: "Theo buổi học thực tế",
                   fixed_monthly: "Cố định mỗi tháng", fixed_course: "Trọn khóa", custom: "Tùy học viên" };
  const tName = id => (teachers.find(t => t.id === id) || {}).full_name || "—";
  const cls = id => classes.find(c => c.id === id) || {};

  async function loadTeachers() {
    const { data } = await sb.from("teachers").select("id, full_name").is("archived_at", null).order("full_name");
    teachers = data || [];
  }

  async function loadClasses() {
    busy = true; if (view === "list") paintList();
    let query = sb.from("classes").select("*", { count: "exact" });
    query = stL.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (stL.status) query = query.eq("status", stL.status);
    if (stL.q.trim()) { const q = stL.q.trim().replace(/[%,]/g, " "); query = query.or(`name.ilike.%${q}%,subject.ilike.%${q}%`); }
    query = query.order(stL.sortKey, { ascending: stL.sortDir === "asc" });
    const from = (stL.page - 1) * stL.per;
    query = query.range(from, from + stL.per - 1);
    const { data, count, error } = await query;
    // sĩ số hiện tại của mọi lớp (đang hoạt động)
    const en = await sb.from("enrollments").select("class_id").eq("status", "active");
    counts = {}; (en.data || []).forEach(r => { counts[r.class_id] = (counts[r.class_id] || 0) + 1; });
    busy = false;
    if (error) { SM.toast("Lỗi tải lớp: " + error.message, "err"); classes = []; totalC = 0; }
    else { classes = data || []; totalC = count || 0; }
    const maxPage = Math.max(1, Math.ceil(totalC / stL.per));
    if (stL.page > maxPage) { stL.page = maxPage; return loadClasses(); }
    if (view === "list") paintList();
  }

  async function loadRoster(id) {
    rosterBusy = true; paintRoster();
    const { data, error } = await sb.from("enrollments")
      .select("*, student:students(id, code, full_name, phone, photo_url, status)")
      .eq("class_id", id).order("status").order("joined_on");
    rosterBusy = false;
    roster = error ? [] : (data || []);
    if (error) SM.toast("Lỗi tải danh sách: " + error.message, "err");
    paintRoster();
  }

  /* ---------------- LIST ---------------- */
  function th(key, label) {
    const on = stL.sortKey === key, arw = on ? (stL.sortDir === "asc" ? "▲" : "▼") : "";
    return `<th data-sort="${key}">${label} <span class="arw">${arw}</span></th>`;
  }
  function paintList() {
    const pages = Math.max(1, Math.ceil(totalC / stL.per));
    const showFrom = totalC ? (stL.page - 1) * stL.per + 1 : 0, showTo = Math.min(totalC, stL.page * stL.per);
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <h1 style="margin:.2rem 0;">Lớp học ${stL.archived ? "· <span class='muted' style='font-size:1rem'>Đã lưu trữ</span>" : ""}</h1>
        ${!stL.archived ? `<button class="btn" data-act="add">➕ Thêm lớp</button>` : ""}
      </div>
      <div class="toolbar">
        <div class="field" style="min-width:220px;flex:1;"><label>Tìm (tên lớp, môn)</label>
          <input id="q" value="${SM.esc(stL.q)}" placeholder="gõ để tìm…"></div>
        <div class="field"><label>Trạng thái</label>
          <select id="fstatus"><option value="">Tất cả</option>
            ${Object.entries(CSTATUS).map(([k, v]) => `<option value="${k}" ${stL.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>&nbsp;</label>
          <button class="btn ghost" data-act="togglearch">${stL.archived ? "← Danh sách chính" : "🗄️ Xem đã lưu trữ"}</button></div>
      </div>
      ${busy ? `<div class="card placeholder"><span class="spinner"></span></div>`
        : totalC === 0 ? `<div class="card placeholder"><div class="big">🏫</div><p>${stL.q || stL.status ? "Không tìm thấy lớp." : (stL.archived ? "Chưa có lớp bị lưu trữ." : "Chưa có lớp nào. Bấm ➕ Thêm lớp.")}</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table">
            <thead><tr>${th("name", "Tên lớp")}<th>Môn</th><th>Giáo viên</th><th>Sĩ số</th>${th("status", "Trạng thái")}<th>Học phí</th><th></th></tr></thead>
            <tbody>${classes.map(rowHtml).join("")}</tbody></table></div>
          <div class="pager"><span>Hiển thị ${showFrom}–${showTo} / ${totalC}</span>
            <div class="pages"><label class="muted">Mỗi trang</label>
              <select id="per">${[10, 20, 50, 100].map(n => `<option ${stL.per === n ? "selected" : ""}>${n}</option>`).join("")}</select>
              <button data-act="first" ${stL.page === 1 ? "disabled" : ""}>«</button>
              <button data-act="prev" ${stL.page === 1 ? "disabled" : ""}>‹</button>
              <span>Trang ${stL.page}/${pages}</span>
              <button data-act="next" ${stL.page >= pages ? "disabled" : ""}>›</button>
              <button data-act="last" ${stL.page >= pages ? "disabled" : ""}>»</button>
            </div></div>`}`;
    wireList();
  }
  function rowHtml(c) {
    const n = counts[c.id] || 0, cap = c.max_students;
    return `<tr>
      <td data-th="Tên lớp"><b>${SM.esc(c.name)}</b>${c.start_date ? `<br><span class="muted" style="font-size:.82rem">Từ ${SM.dmy(c.start_date)}${c.end_date ? " → " + SM.dmy(c.end_date) : ""}</span>` : ""}</td>
      <td data-th="Môn">${SM.esc(c.subject || "—")}</td>
      <td data-th="Giáo viên">${SM.esc(tName(c.teacher_id))}</td>
      <td data-th="Sĩ số">${n}${cap != null ? " / " + cap : ""}${cap != null && n >= cap ? ' <span class="badge bad">đầy</span>' : ""}</td>
      <td data-th="Trạng thái"><span class="badge ${CBADGE[c.status] || "mute"}">${CSTATUS[c.status] || c.status}</span></td>
      <td data-th="Học phí">${SM.vnd(c.tuition_amount)}<br><span class="muted" style="font-size:.8rem">${METHOD[c.tuition_method] || ""}</span></td>
      <td class="cell-actions"><div class="row-actions">
        <button class="btn" data-roster="${c.id}">👥 Học viên (${n})</button>
        <button class="btn ghost" data-edit="${c.id}">Sửa</button>
        <button class="btn ghost" data-dup="${c.id}">Nhân bản</button>
        ${stL.archived ? `<button class="btn ghost" data-restore="${c.id}">Khôi phục</button>`
          : `<button class="btn ghost" data-arch="${c.id}" style="color:var(--danger);border-color:var(--danger)">Lưu trữ</button>`}
      </div></td></tr>`;
  }

  /* ---------------- CLASS FORM ---------------- */
  function classForm(c) {
    c = c || {}; const isNew = !c.id; const g = (k, d = "") => c[k] == null ? d : c[k];
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>${isNew ? "➕ Thêm lớp" : "✏️ Sửa lớp"}</h3>
        <button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field" style="grid-column:1/-1"><label>Tên lớp *</label><input id="c-name" value="${SM.esc(g("name"))}" placeholder="HSK 1 – Lớp A"></div>
        <div class="field"><label>Môn / khóa</label><input id="c-subject" value="${SM.esc(g("subject"))}"></div>
        <div class="field"><label>Giáo viên</label><div style="display:flex;gap:.4rem">
          <select id="c-teacher" style="flex:1"><option value="">— chưa gán —</option>
            ${teachers.map(t => `<option value="${t.id}" ${g("teacher_id") === t.id ? "selected" : ""}>${SM.esc(t.full_name)}</option>`).join("")}</select>
          <button class="btn ghost" id="c-addteacher" title="Thêm giáo viên">➕</button></div></div>
        <div class="field"><label>Phòng học</label><input id="c-room" value="${SM.esc(g("room"))}"></div>
        <div class="field"><label>Link học online</label><input id="c-link" value="${SM.esc(g("online_link"))}"></div>
        <div class="field"><label>Sĩ số tối đa</label><input id="c-max" type="number" min="1" value="${g("max_students", "")}" placeholder="không giới hạn"></div>
        <div class="field"><label>Trạng thái</label><select id="c-status">
          ${Object.entries(CSTATUS).map(([k, v]) => `<option value="${k}" ${g("status", "planned") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Ngày bắt đầu (DD/MM/YYYY)</label><input id="c-start" value="${c.start_date ? SM.dmy(c.start_date) : ""}"></div>
        <div class="field"><label>Ngày kết thúc dự kiến</label><input id="c-end" value="${c.end_date ? SM.dmy(c.end_date) : ""}"></div>
        <div class="field"><label>Cách tính học phí</label><select id="c-method">
          ${Object.entries(METHOD).map(([k, v]) => `<option value="${k}" ${g("tuition_method", "per_scheduled") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Mức học phí (VND)</label><input id="c-fee" type="number" min="0" value="${g("tuition_amount", 0)}"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea id="c-notes" style="min-height:56px">${SM.esc(g("notes"))}</textarea></div>
      </div><p class="muted" style="font-size:.85rem">Lịch học hằng tuần sẽ cấu hình ở giai đoạn 4.</p></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="c-save">💾 Lưu</button>
        <span class="msg" id="c-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    // dùng prompt đơn giản để thêm giáo viên nhanh
    ov.querySelector("#c-addteacher").onclick = async () => {
      const name = window.prompt("Tên giáo viên mới:");
      if (!name || !name.trim()) return;
      const { data, error } = await sb.from("teachers").insert({ full_name: name.trim() }).select("id, full_name").single();
      if (error) return SM.toast("Không thêm được: " + error.message, "err");
      teachers.push(data); teachers.sort((a, b) => a.full_name.localeCompare(b.full_name));
      const selEl = ov.querySelector("#c-teacher");
      selEl.innerHTML = `<option value="">— chưa gán —</option>` + teachers.map(t => `<option value="${t.id}">${SM.esc(t.full_name)}</option>`).join("");
      selEl.value = data.id;
      SM.toast("✓ Đã thêm giáo viên", "ok");
    };
    ov.querySelector("#c-save").addEventListener("click", () => saveClass(ov, c));
  }
  async function saveClass(ov, c) {
    const V = id => ov.querySelector("#" + id).value;
    const msg = ov.querySelector("#c-msg"); const say = (t, e) => { msg.textContent = t; msg.className = "msg" + (e ? " err" : ""); };
    const name = V("c-name").trim(); if (!name) return say("Thiếu tên lớp.", true);
    const sd = V("c-start").trim(), ed = V("c-end").trim();
    const start = sd ? SM.parseDmy(sd) : null; if (sd && !start) return say("Ngày bắt đầu không hợp lệ.", true);
    const end = ed ? SM.parseDmy(ed) : null; if (ed && !end) return say("Ngày kết thúc không hợp lệ.", true);
    if (start && end && end < start) return say("Ngày kết thúc phải sau ngày bắt đầu.", true);
    const maxRaw = V("c-max").trim();
    const row = {
      name, subject: V("c-subject").trim(), teacher_id: V("c-teacher") || null,
      room: V("c-room").trim(), online_link: V("c-link").trim(),
      max_students: maxRaw === "" ? null : Math.max(1, parseInt(maxRaw, 10) || 1),
      status: V("c-status"), start_date: start, end_date: end,
      tuition_method: V("c-method"), tuition_amount: Math.max(0, parseInt(V("c-fee"), 10) || 0),
      notes: V("c-notes").trim(), updated_at: new Date().toISOString()
    };
    ov.querySelector("#c-save").disabled = true;
    let error;
    if (c.id) ({ error } = await sb.from("classes").update(row).eq("id", c.id));
    else ({ error } = await sb.from("classes").insert(row));
    ov.querySelector("#c-save").disabled = false;
    if (error) return say("Không lưu được: " + error.message, true);
    ov.remove(); SM.toast("✓ Đã lưu lớp", "ok"); loadClasses();
  }
  async function duplicateClass(id) {
    const c = cls(id);
    const copy = { name: c.name + " (bản sao)", subject: c.subject, teacher_id: c.teacher_id, room: c.room,
      online_link: c.online_link, max_students: c.max_students, status: "planned",
      tuition_method: c.tuition_method, tuition_amount: c.tuition_amount, notes: c.notes };
    const { error } = await sb.from("classes").insert(copy);
    if (error) return SM.toast("Không nhân bản được: " + error.message, "err");
    SM.toast("✓ Đã nhân bản lớp (không kèm học viên/lịch)", "ok"); loadClasses();
  }
  async function archiveClass(id, on) {
    const c = cls(id), n = counts[id] || 0;
    const ok = await SM.confirmDialog({ title: on ? "Lưu trữ lớp?" : "Khôi phục lớp?", danger: on, okText: on ? "Lưu trữ" : "Khôi phục",
      body: on ? `Ẩn lớp <b>${SM.esc(c.name)}</b>${n ? " (đang có " + n + " học viên)" : ""}. Toàn bộ ghi danh, điểm danh, học phí <b>vẫn được giữ</b>.` : `Đưa lớp <b>${SM.esc(c.name)}</b> trở lại danh sách chính.` });
    if (!ok) return;
    const { error } = await sb.from("classes").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", id);
    if (error) return SM.toast("Lỗi: " + error.message, "err");
    SM.toast(on ? "🗄️ Đã lưu trữ" : "↩ Đã khôi phục", "ok"); loadClasses();
  }

  /* ---------------- ROSTER ---------------- */
  function paintRoster() {
    const c = cls(curId);
    const cur = roster.filter(e => e.status === "active");
    const former = roster.filter(e => e.status === "former");
    const list = showFormer ? former : cur;
    const cap = c.max_students;
    box.innerHTML = `
      <div class="toolbar" style="justify-content:space-between">
        <button class="btn ghost" data-act="back">← Danh sách lớp</button>
        ${!showFormer ? `<button class="btn" data-act="addstu">➕ Thêm học viên</button>` : ""}
      </div>
      <h1 style="margin:.1rem 0 .2rem;">${SM.esc(c.name)} <span class="badge ${CBADGE[c.status] || "mute"}">${CSTATUS[c.status] || ""}</span></h1>
      <p class="muted" style="margin:.1rem 0 .8rem;">${SM.esc(c.subject || "")} · GV ${SM.esc(tName(c.teacher_id))} · ${SM.vnd(c.tuition_amount)} (${METHOD[c.tuition_method] || ""})
        · Sĩ số <b>${cur.length}${cap != null ? " / " + cap : ""}</b></p>
      <div class="toolbar">
        <button class="btn ${showFormer ? "ghost" : ""}" data-act="tab-cur">Đang học (${cur.length})</button>
        <button class="btn ${showFormer ? "" : "ghost"}" data-act="tab-former">Đã rời lớp (${former.length})</button>
        ${!showFormer && sel.size ? `<span style="margin-left:auto;align-self:center">Đã chọn ${sel.size}:</span>
          <button class="btn ghost" data-act="bulk-transfer">Chuyển lớp</button>
          <button class="btn ghost" data-act="bulk-remove" style="color:var(--danger);border-color:var(--danger)">Gỡ khỏi lớp</button>` : ""}
      </div>
      ${rosterBusy ? `<div class="card placeholder"><span class="spinner"></span></div>`
        : !list.length ? `<div class="card placeholder"><div class="big">👥</div><p>${showFormer ? "Chưa có học viên nào rời lớp." : "Lớp chưa có học viên. Bấm ➕ Thêm học viên."}</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
            ${!showFormer ? `<th style="width:34px"><input type="checkbox" id="selall"></th>` : ""}
            <th>Mã</th><th>Học viên</th><th>SĐT</th><th>${showFormer ? "Rời ngày" : "Vào ngày"}</th>${showFormer ? "" : "<th></th>"}</tr></thead>
            <tbody>${list.map(e => rosterRow(e)).join("")}</tbody></table></div>`}`;
    wireRoster();
  }
  function rosterRow(e) {
    const s = e.student || {};
    const av = s.photo_url ? `<img class="avatar" src="${SM.esc(s.photo_url)}">` : `<span class="avatar">${SM.esc((s.full_name || "?").trim().split(/\s+/).slice(-1)[0][0] || "?").toUpperCase()}</span>`;
    return `<tr>
      ${!showFormer ? `<td><input type="checkbox" data-sel="${e.id}" data-stu="${s.id}" ${sel.has(e.id) ? "checked" : ""}></td>` : ""}
      <td data-th="Mã"><code>${SM.esc(s.code || "")}</code></td>
      <td data-th="Học viên"><span style="display:inline-flex;align-items:center;gap:.5rem">${av}<b>${SM.esc(s.full_name || "")}</b></span></td>
      <td data-th="SĐT">${SM.esc(s.phone || "—")}</td>
      <td data-th="Ngày">${showFormer ? SM.dmy(e.left_on) : SM.dmy(e.joined_on)}</td>
      ${showFormer ? "" : `<td class="cell-actions"><div class="row-actions">
        <button class="btn ghost" data-transfer="${e.id}" data-stu="${s.id}">Chuyển lớp</button>
        <button class="btn ghost" data-remove="${e.id}" data-stu="${s.id}" style="color:var(--danger);border-color:var(--danger)">Gỡ</button>
      </div></td>`}</tr>`;
  }

  async function addStudentsModal() {
    const c = cls(curId);
    const activeIds = new Set(roster.filter(e => e.status === "active").map(e => e.student && e.student.id));
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>Thêm học viên vào ${SM.esc(c.name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="field"><label>Tìm học viên (tên / mã / SĐT)</label><input id="as-q" placeholder="gõ ≥1 ký tự…"></div>
        <div id="as-list" class="card" style="max-height:320px;overflow:auto;padding:.3rem"><p class="muted" style="padding:1rem">Gõ để tìm học viên.</p></div>
        <p class="muted" id="as-count" style="font-size:.85rem;margin:.5rem 0 0"></p></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="as-add" disabled>➕ Thêm đã chọn</button>
        <span class="msg" id="as-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    const picked = new Set();
    const cap = c.max_students, curN = activeIds.size;
    const qEl = ov.querySelector("#as-q"), listEl = ov.querySelector("#as-list"), addBtn = ov.querySelector("#as-add"), cntEl = ov.querySelector("#as-count");
    const refreshCnt = () => {
      cntEl.textContent = picked.size ? `Đã chọn ${picked.size}` + (cap != null ? ` · lớp sẽ có ${curN + picked.size}${cap != null ? "/" + cap : ""}` : "") : "";
      addBtn.disabled = !picked.size || (cap != null && curN + picked.size > cap);
      if (cap != null && curN + picked.size > cap) { ov.querySelector("#as-msg").textContent = "Vượt sĩ số tối đa " + cap; ov.querySelector("#as-msg").className = "msg err"; }
      else ov.querySelector("#as-msg").textContent = "";
    };
    let deb;
    async function search() {
      const q = qEl.value.trim();
      if (!q) { listEl.innerHTML = `<p class="muted" style="padding:1rem">Gõ để tìm học viên.</p>`; return; }
      const { data } = await sb.from("students").select("id, code, full_name, phone")
        .is("archived_at", null).or(`full_name.ilike.%${q.replace(/[%,]/g, " ")}%,code.ilike.%${q}%,phone.ilike.%${q}%`).limit(40);
      const rows = (data || []).filter(s => !activeIds.has(s.id));
      listEl.innerHTML = rows.length ? rows.map(s => `
        <label style="display:flex;align-items:center;gap:.6rem;padding:.4rem .5rem;border-bottom:1px solid var(--line);cursor:pointer">
          <input type="checkbox" data-pick="${s.id}" ${picked.has(s.id) ? "checked" : ""}>
          <span><b>${SM.esc(s.full_name)}</b> <span class="muted">· ${SM.esc(s.code)}${s.phone ? " · " + SM.esc(s.phone) : ""}</span></span></label>`).join("")
        : `<p class="muted" style="padding:1rem">Không có học viên phù hợp (những em đã ở trong lớp được ẩn).</p>`;
      listEl.querySelectorAll("[data-pick]").forEach(cb => cb.addEventListener("change", () => {
        cb.checked ? picked.add(cb.dataset.pick) : picked.delete(cb.dataset.pick); refreshCnt();
      }));
    }
    qEl.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(search, 300); });
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      const rows = [...picked].map(sid => ({ student_id: sid, class_id: curId, joined_on: SM.todayISO(), status: "active" }));
      const { error } = await sb.from("enrollments").insert(rows);
      if (error) { addBtn.disabled = false; ov.querySelector("#as-msg").textContent = "Lỗi: " + error.message; ov.querySelector("#as-msg").className = "msg err"; return; }
      ov.remove(); SM.toast(`✓ Đã thêm ${rows.length} học viên`, "ok"); loadRoster(curId); loadClasses();
    });
  }

  async function removeStudents(enrollIds, studentLabel) {
    const ok = await SM.confirmDialog({ title: "Gỡ khỏi lớp?", danger: true, okText: "Gỡ khỏi lớp",
      body: `Kết thúc ghi danh của ${studentLabel} trong lớp này. <b>Lịch sử điểm danh và học phí vẫn được giữ</b> — học viên chuyển sang mục "Đã rời lớp".` });
    if (!ok) return;
    const today = SM.todayISO();
    for (const id of enrollIds) {
      const { error } = await sb.from("enrollments").update({ status: "former", left_on: today }).eq("id", id);
      if (error) { SM.toast("Lỗi gỡ: " + error.message, "err"); break; }
    }
    sel.clear(); SM.toast("✓ Đã gỡ khỏi lớp", "ok"); loadRoster(curId); loadClasses();
  }

  function transferModal(items) {
    // items: [{enrollId, studentId}]
    const others = classes.filter(c => c.id !== curId && !c.archived_at);
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal"><div class="mh"><h3>Chuyển lớp (${items.length} học viên)</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="grid2">
        <div class="field"><label>Từ lớp</label><input value="${SM.esc(cls(curId).name)}" disabled></div>
        <div class="field"><label>Sang lớp *</label><select id="t-to"><option value="">— chọn lớp —</option>
          ${others.map(c => `<option value="${c.id}">${SM.esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Ngày chuyển (DD/MM/YYYY)</label><input id="t-date" value="${SM.dmy(SM.todayISO())}"></div>
        <div class="field"><label>Tín dụng học phí chuyển theo (VND)</label><input id="t-credit" type="number" min="0" value="0"></div>
        <div class="field" style="grid-column:1/-1"><label>Lý do chuyển</label><input id="t-reason" placeholder="vd: đổi lịch học"></div>
        <div class="field" style="grid-column:1/-1"><label>Ghi chú</label><textarea id="t-notes" style="min-height:50px"></textarea></div>
      </div></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="t-go">Chuyển lớp</button>
        <span class="msg" id="t-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#t-go").addEventListener("click", async () => {
      const msg = ov.querySelector("#t-msg"); const say = (t, e) => { msg.textContent = t; msg.className = "msg" + (e ? " err" : ""); };
      const to = ov.querySelector("#t-to").value; if (!to) return say("Chọn lớp mới.", true);
      const date = SM.parseDmy(ov.querySelector("#t-date").value.trim()); if (!date) return say("Ngày chuyển không hợp lệ.", true);
      const credit = Math.max(0, parseInt(ov.querySelector("#t-credit").value, 10) || 0);
      const reason = ov.querySelector("#t-reason").value.trim(), notes = ov.querySelector("#t-notes").value.trim();
      ov.querySelector("#t-go").disabled = true;
      for (const it of items) {
        const { error } = await sb.rpc("transfer_student", { p_student: it.studentId, p_from_class: curId, p_to_class: to, p_date: date, p_reason: reason, p_credit: credit, p_notes: notes });
        if (error) { ov.querySelector("#t-go").disabled = false; return say("Lỗi chuyển: " + error.message, true); }
      }
      ov.remove(); sel.clear(); SM.toast(`✓ Đã chuyển ${items.length} học viên`, "ok"); loadRoster(curId); loadClasses();
    });
  }

  /* ---------------- wiring ---------------- */
  let deb = null;
  function wireList() {
    box.querySelectorAll("[data-sort]").forEach(h => h.addEventListener("click", () => {
      const k = h.getAttribute("data-sort");
      if (stL.sortKey === k) stL.sortDir = stL.sortDir === "asc" ? "desc" : "asc"; else { stL.sortKey = k; stL.sortDir = "asc"; }
      stL.page = 1; loadClasses();
    }));
    const q = box.querySelector("#q"); if (q) q.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { stL.q = q.value; stL.page = 1; loadClasses(); }, 300); });
    const fs = box.querySelector("#fstatus"); if (fs) fs.addEventListener("change", () => { stL.status = fs.value; stL.page = 1; loadClasses(); });
    const per = box.querySelector("#per"); if (per) per.addEventListener("change", () => { stL.per = +per.value; stL.page = 1; loadClasses(); });
    box.addEventListener("click", onListClick);
  }
  function onListClick(e) {
    const b = e.target.closest("[data-act],[data-edit],[data-arch],[data-restore],[data-dup],[data-roster]"); if (!b) return;
    if (b.dataset.act === "add") return classForm(null);
    if (b.dataset.act === "togglearch") { stL.archived = !stL.archived; stL.page = 1; stL.status = ""; return loadClasses(); }
    if (b.dataset.act === "first") { stL.page = 1; return loadClasses(); }
    if (b.dataset.act === "prev") { stL.page--; return loadClasses(); }
    if (b.dataset.act === "next") { stL.page++; return loadClasses(); }
    if (b.dataset.act === "last") { stL.page = Math.max(1, Math.ceil(totalC / stL.per)); return loadClasses(); }
    if (b.dataset.edit) return classForm(cls(b.dataset.edit));
    if (b.dataset.dup) return duplicateClass(b.dataset.dup);
    if (b.dataset.arch) return archiveClass(b.dataset.arch, true);
    if (b.dataset.restore) return archiveClass(b.dataset.restore, false);
    if (b.dataset.roster) { curId = b.dataset.roster; view = "roster"; showFormer = false; sel.clear(); return loadRoster(curId); }
  }
  function wireRoster() {
    const all = box.querySelector("#selall");
    if (all) all.addEventListener("change", () => {
      box.querySelectorAll("[data-sel]").forEach(cb => { cb.checked = all.checked; cb.checked ? sel.add(cb.dataset.sel) : sel.delete(cb.dataset.sel); });
      paintRoster();
    });
    box.querySelectorAll("[data-sel]").forEach(cb => cb.addEventListener("change", () => { cb.checked ? sel.add(cb.dataset.sel) : sel.delete(cb.dataset.sel); paintRoster(); }));
    box.addEventListener("click", onRosterClick);
  }
  function onRosterClick(e) {
    const b = e.target.closest("[data-act],[data-transfer],[data-remove]"); if (!b) return;
    if (b.dataset.act === "back") { view = "list"; sel.clear(); return paintList(); }
    if (b.dataset.act === "addstu") return addStudentsModal();
    if (b.dataset.act === "tab-cur") { showFormer = false; sel.clear(); return paintRoster(); }
    if (b.dataset.act === "tab-former") { showFormer = true; sel.clear(); return paintRoster(); }
    if (b.dataset.remove) { const s = roster.find(x => x.id === b.dataset.remove); return removeStudents([b.dataset.remove], "<b>" + SM.esc((s.student || {}).full_name || "") + "</b>"); }
    if (b.dataset.transfer) return transferModal([{ enrollId: b.dataset.transfer, studentId: b.dataset.stu }]);
    if (b.dataset.act === "bulk-remove") { const items = [...sel]; return removeStudents(items, "<b>" + items.length + " học viên</b>"); }
    if (b.dataset.act === "bulk-transfer") {
      const items = [...sel].map(eid => { const e2 = roster.find(x => x.id === eid); return { enrollId: eid, studentId: e2.student.id }; });
      return transferModal(items);
    }
  }

  return {
    async render(el, me) {
      ME = me; box = el; view = "list"; sel.clear();
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      await loadTeachers(); await loadClasses();
    }
  };
})();

/* ============================================================
   Giai đoạn J — Khóa học (Cohort)
   • Gom nhiều lớp thành một khóa (vd K24 – Thu 2026).
   • Thời khóa biểu tuần của khóa (từ lịch lặp class_schedules).
   • Xuất lịch PDF (A4 ngang, sẵn sàng in).
   ============================================================ */
window.Cohorts = (function () {
  let ME = null, box = null, view = "list", curId = null;
  let cohorts = [], teachers = [];
  const tName = id => (teachers.find(t => t.id === id) || {}).full_name || "—";
  const hm = t => (t || "").slice(0, 5);
  const DAYS = [{ dow: 1, lbl: "Thứ 2" }, { dow: 2, lbl: "Thứ 3" }, { dow: 3, lbl: "Thứ 4" },
                { dow: 4, lbl: "Thứ 5" }, { dow: 5, lbl: "Thứ 6" }, { dow: 6, lbl: "Thứ 7" }, { dow: 0, lbl: "Chủ nhật" }];

  /* ---------------- LIST ---------------- */
  async function loadList() {
    view = "list";
    const [{ data: cs }, { data: cls }] = await Promise.all([
      sb.from("cohorts").select("*").is("archived_at", null).order("created_at", { ascending: false }),
      sb.from("classes").select("cohort_id").is("archived_at", null)
    ]);
    cohorts = cs || [];
    const counts = {}; (cls || []).forEach(c => { if (c.cohort_id) counts[c.cohort_id] = (counts[c.cohort_id] || 0) + 1; });
    paintList(counts);
  }

  function paintList(counts) {
    box.innerHTML = `
      <div class="toolbar" style="justify-content:space-between;align-items:center;">
        <h1 style="margin:.1rem 0;">Khóa học</h1>
        <button class="btn" data-act="add">➕ Thêm khóa học</button>
      </div>
      <p class="muted" style="font-size:.9rem;margin:.1rem 0 .8rem;">Gom nhiều lớp thành một khóa (vd <b>K24 – Thu 2026</b>) để xem thời khóa biểu chung và xuất PDF.</p>
      ${!cohorts.length ? `<div class="card placeholder"><div class="big">🎓</div><p>Chưa có khóa học nào. Bấm ➕ Thêm khóa học.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table collapsible"><thead><tr>
            <th>Mã khóa</th><th>Tên</th><th>Thời gian</th><th>Số lớp</th><th></th></tr></thead><tbody>
            ${cohorts.map(c => `<tr>
              <td data-th="Mã khóa"><b>${SM.esc(c.code)}</b></td>
              <td data-th="Tên">${SM.esc(c.name || "—")}</td>
              <td class="sec" data-th="Thời gian">${c.start_date ? SM.dmy(c.start_date) : "—"}${c.end_date ? " → " + SM.dmy(c.end_date) : ""}</td>
              <td data-th="Số lớp">${counts[c.id] || 0}</td>
              <td class="cell-actions"><div class="row-actions">
                <button class="btn" data-open="${c.id}">📅 Xem</button>
                <button class="btn ghost" data-edit="${c.id}">Sửa</button>
                <button class="btn ghost" data-del="${c.id}" style="color:var(--danger);border-color:var(--danger)">Xóa</button>
              </div></td></tr>`).join("")}
          </tbody></table></div>`}`;
    box.onclick = onListClick;
  }

  function onListClick(e) {
    const b = e.target.closest("[data-act],[data-open],[data-edit],[data-del]"); if (!b) return;
    if (b.dataset.act === "add") return cohortForm(null);
    if (b.dataset.open) return loadDetail(b.dataset.open);
    if (b.dataset.edit) return cohortForm(cohorts.find(c => c.id === b.dataset.edit));
    if (b.dataset.del) return delCohort(cohorts.find(c => c.id === b.dataset.del));
  }

  /* ---------------- FORM ---------------- */
  function cohortForm(c) {
    c = c || {}; const isNew = !c.id; const g = (k, d = "") => c[k] == null ? d : c[k];
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:460px;">
      <div class="mh"><h3>${isNew ? "➕ Thêm khóa học" : "✏️ Sửa khóa học"}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <div class="grid2">
          <div class="field"><label>Mã khóa *</label><input id="co-code" value="${SM.esc(g("code"))}" placeholder="K24"></div>
          <div class="field"><label>Tên khóa</label><input id="co-name" value="${SM.esc(g("name"))}" placeholder="Thu 2026"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Bắt đầu (DD/MM/YYYY)</label><input id="co-start" value="${c.start_date ? SM.dmy(c.start_date) : ""}"></div>
          <div class="field"><label>Kết thúc (DD/MM/YYYY)</label><input id="co-end" value="${c.end_date ? SM.dmy(c.end_date) : ""}"></div>
        </div>
        <div class="field"><label>Ghi chú</label><textarea id="co-notes" style="min-height:48px">${SM.esc(g("notes"))}</textarea></div>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="co-save">💾 Lưu</button>
        <span class="msg" id="co-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#co-save").onclick = async () => {
      const say = (m, e) => { const el = ov.querySelector("#co-msg"); el.textContent = m; el.className = "msg" + (e ? " err" : ""); };
      const code = ov.querySelector("#co-code").value.trim(); if (!code) return say("Thiếu mã khóa.", true);
      const sd = ov.querySelector("#co-start").value.trim(), ed = ov.querySelector("#co-end").value.trim();
      const start = sd ? SM.parseDmy(sd) : null; if (sd && !start) return say("Ngày bắt đầu không hợp lệ.", true);
      const end = ed ? SM.parseDmy(ed) : null; if (ed && !end) return say("Ngày kết thúc không hợp lệ.", true);
      const row = { code, name: ov.querySelector("#co-name").value.trim(), start_date: start, end_date: end,
        notes: ov.querySelector("#co-notes").value.trim(), updated_at: new Date().toISOString() };
      ov.querySelector("#co-save").disabled = true;
      const res = isNew ? await sb.from("cohorts").insert(row) : await sb.from("cohorts").update(row).eq("id", c.id);
      if (res.error) { ov.querySelector("#co-save").disabled = false; return say("Không lưu được: " + res.error.message, true); }
      ov.remove(); SM.toast(isNew ? "✓ Đã tạo khóa học" : "✓ Đã lưu khóa học", "ok");
      if (view === "detail" && curId) loadDetail(curId); else loadList();
    };
  }

  async function delCohort(c) {
    const ok = await SM.confirmDialog({ title: "Xóa khóa học?", danger: true, okText: "Xóa",
      body: `Xóa khóa <b>${SM.esc(c.code)}</b>. Các lớp trong khóa <b>được giữ nguyên</b>, chỉ gỡ khỏi khóa.` });
    if (!ok) return;
    const { error } = await sb.from("cohorts").delete().eq("id", c.id);
    if (error) return SM.toast("Không xóa được: " + error.message, "err");
    SM.invalidate("classes"); SM.toast("🗑 Đã xóa khóa học", "ok"); loadList();
  }

  /* ---------------- DETAIL (grid + members) ---------------- */
  async function loadDetail(id) {
    curId = id; view = "detail";
    box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
    teachers = await SM.refTeachers();
    const { data: cohort } = await sb.from("cohorts").select("*").eq("id", id).single();
    if (!cohort) { SM.toast("Không tìm thấy khóa học", "err"); return loadList(); }
    const { data: classes } = await sb.from("classes")
      .select("id,name,room,teacher_id,color,start_date,end_date").eq("cohort_id", id).is("archived_at", null).order("name");
    const ids = (classes || []).map(c => c.id);
    let scheds = [];
    if (ids.length) scheds = (await sb.from("class_schedules").select("class_id,weekday,start_time,end_time,room,teacher_id").in("class_id", ids)).data || [];
    paintDetail(cohort, classes || [], scheds);
  }

  function buildByDay(classes, scheds) {
    const clsMap = {}; classes.forEach(c => clsMap[c.id] = c);
    const byDay = {}; DAYS.forEach(d => byDay[d.dow] = []);
    scheds.forEach(s => {
      const c = clsMap[s.class_id]; if (!c) return;
      byDay[s.weekday].push({ className: c.name, color: c.color, start: hm(s.start_time), end: hm(s.end_time),
        room: s.room || c.room || "", teacher: tName(s.teacher_id || c.teacher_id) });
    });
    DAYS.forEach(d => byDay[d.dow].sort((x, y) => x.start.localeCompare(y.start)));
    return byDay;
  }

  function gridHtml(byDay) {
    return `<div class="cohort-grid">${DAYS.map(d => `
      <div class="cohort-col">
        <div class="cohort-dh">${d.lbl}</div>
        ${byDay[d.dow].length ? byDay[d.dow].map(b => `
          <div class="cohort-blk" style="border-left-color:${SM.classTint(b.color).solid}">
            <b>${b.start}–${b.end}</b><br>${SM.esc(b.className)}
            <br><span class="muted" style="font-size:.78rem;">${b.room ? "🏠 " + SM.esc(b.room) + " · " : ""}${SM.esc(b.teacher)}</span>
          </div>`).join("") : `<div class="muted" style="font-size:.8rem;padding:.3rem;text-align:center;">—</div>`}
      </div>`).join("")}</div>`;
  }

  function paintDetail(cohort, classes, scheds) {
    const byDay = buildByDay(classes, scheds);
    box.innerHTML = `
      <div class="toolbar" style="justify-content:space-between;flex-wrap:wrap;gap:.5rem;">
        <button class="btn ghost" data-act="back">← Danh sách khóa</button>
        <div class="row-actions" style="display:flex;gap:.4rem;">
          <button class="btn" data-act="pdf">🖨 Xuất lịch (PDF)</button>
          <button class="btn ghost" data-act="edit">Sửa</button>
        </div>
      </div>
      <h1 style="margin:.1rem 0 .1rem;">${SM.esc(cohort.code)} ${cohort.name ? `<span class="muted" style="font-weight:400;font-size:1rem;">· ${SM.esc(cohort.name)}</span>` : ""}</h1>
      <p class="muted" style="margin:.1rem 0 .8rem;">${cohort.start_date ? SM.dmy(cohort.start_date) : "—"}${cohort.end_date ? " → " + SM.dmy(cohort.end_date) : ""} · ${classes.length} lớp</p>
      <h3 style="margin:.6rem 0 .4rem;">Thời khóa biểu tuần</h3>
      ${classes.length ? gridHtml(byDay) : `<div class="card placeholder"><div class="big">📅</div><p>Khóa chưa có lớp nào. Bấm “➕ Thêm lớp vào khóa”.</p></div>`}
      <div class="toolbar" style="justify-content:space-between;align-items:center;margin-top:1.1rem;">
        <h3 style="margin:.2rem 0;">Lớp trong khóa (${classes.length})</h3>
        <button class="btn" data-act="addcls">➕ Thêm lớp vào khóa</button>
      </div>
      ${classes.length ? `<div class="sm-table-wrap"><table class="sm-table collapsible"><thead><tr>
          <th>Lớp</th><th>Giáo viên</th><th>Phòng</th><th></th></tr></thead><tbody>
          ${classes.map(c => `<tr>
            <td data-th="Lớp">${SM.classDot(c.color)}<b>${SM.esc(c.name)}</b></td>
            <td class="sec" data-th="Giáo viên">${SM.esc(tName(c.teacher_id))}</td>
            <td class="sec" data-th="Phòng">${SM.esc(c.room || "—")}</td>
            <td class="cell-actions"><div class="row-actions"><button class="btn ghost" data-remcls="${c.id}" style="color:var(--danger);border-color:var(--danger)">Gỡ khỏi khóa</button></div></td>
          </tr>`).join("")}
        </tbody></table></div>` : ""}`;
    box.onclick = e => onDetailClick(e, cohort, byDay);
  }

  function onDetailClick(e, cohort, byDay) {
    const b = e.target.closest("[data-act],[data-remcls]"); if (!b) return;
    if (b.dataset.act === "back") return loadList();
    if (b.dataset.act === "edit") return cohortForm(cohort);
    if (b.dataset.act === "addcls") return addClassesModal(cohort.id);
    if (b.dataset.act === "pdf") return exportPdf(cohort, byDay);
    if (b.dataset.remcls) return removeClass(cohort.id, b.dataset.remcls);
  }

  async function removeClass(cohortId, classId) {
    const { error } = await sb.from("classes").update({ cohort_id: null }).eq("id", classId);
    if (error) return SM.toast("Không gỡ được: " + error.message, "err");
    SM.invalidate("classes"); SM.toast("✓ Đã gỡ lớp khỏi khóa", "ok"); loadDetail(cohortId);
  }

  async function addClassesModal(cohortId) {
    const { data: cls } = await sb.from("classes").select("id,name,cohort_id").is("archived_at", null).order("name");
    const list = cls || [];
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:480px;">
      <div class="mh"><h3>Thêm lớp vào khóa</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        ${!list.length ? `<p class="muted">Chưa có lớp nào để thêm.</p>`
          : `<p class="muted" style="font-size:.84rem;margin:.1rem 0 .6rem;">Chọn lớp thuộc khóa này. Lớp đang ở khóa khác sẽ được <b>chuyển</b> sang khóa này.</p>
          <div style="max-height:52vh;overflow:auto;">${list.map(c => `<label style="display:flex;align-items:center;gap:.5rem;padding:.45rem .2rem;border-bottom:1px solid var(--line);">
            <input type="checkbox" data-cls="${c.id}" ${c.cohort_id === cohortId ? "checked" : ""} style="width:auto;">
            <span style="flex:1;"><b>${SM.esc(c.name)}</b>${c.cohort_id && c.cohort_id !== cohortId ? ' <span class="badge warn">đang ở khóa khác</span>' : ""}</span>
          </label>`).join("")}</div>`}
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="ac-save">💾 Lưu</button>
        <span class="msg" id="ac-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#ac-save").onclick = async () => {
      const say = (m, e) => { const el = ov.querySelector("#ac-msg"); el.textContent = m; el.className = "msg" + (e ? " err" : ""); };
      const checks = [...ov.querySelectorAll("[data-cls]")];
      const cohortOf = id => (list.find(c => c.id === id) || {}).cohort_id;
      const toAdd = checks.filter(x => x.checked && cohortOf(x.dataset.cls) !== cohortId).map(x => x.dataset.cls);
      const toRemove = checks.filter(x => !x.checked && cohortOf(x.dataset.cls) === cohortId).map(x => x.dataset.cls);
      ov.querySelector("#ac-save").disabled = true;
      try {
        if (toAdd.length) { const { error } = await sb.from("classes").update({ cohort_id: cohortId }).in("id", toAdd); if (error) throw error; }
        if (toRemove.length) { const { error } = await sb.from("classes").update({ cohort_id: null }).in("id", toRemove); if (error) throw error; }
      } catch (err) { ov.querySelector("#ac-save").disabled = false; return say("Lỗi: " + (err.message || err), true); }
      ov.remove(); SM.invalidate("classes"); SM.toast("✓ Đã cập nhật lớp trong khóa", "ok"); loadDetail(cohortId);
    };
  }

  /* ---------------- PDF export (A4 ngang) ---------------- */
  async function exportPdf(cohort, byDay) {
    const cfg = await SM.refSettings().catch(() => null);
    const center = (cfg && cfg.center_name) || "Trung tâm";
    const E = SM.esc;
    const cell = dow => byDay[dow].length
      ? byDay[dow].map(b => `<div class="pb"><b>${b.start}–${b.end}</b> ${E(b.className)}<br><span class="pm">${b.room ? "🏠 " + E(b.room) + " · " : ""}${E(b.teacher)}</span></div>`).join("")
      : `<div class="pe">—</div>`;
    const instructors = [...new Set([].concat(...DAYS.map(d => byDay[d.dow].map(b => b.teacher))).filter(t => t && t !== "—"))];
    const doc = `<div class="cprint">
      <div class="ph">
        <div class="pcenter">${E(center)}</div>
        <h1>${E(cohort.code)}${cohort.name ? " — " + E(cohort.name) : ""}</h1>
        <div class="psub">Thời khóa biểu tuần${cohort.start_date ? " · " + SM.dmy(cohort.start_date) : ""}${cohort.end_date ? " → " + SM.dmy(cohort.end_date) : ""}</div>
      </div>
      <table class="pt"><thead><tr>${DAYS.map(d => `<th>${d.lbl}</th>`).join("")}</tr></thead>
        <tbody><tr>${DAYS.map(d => `<td>${cell(d.dow)}</td>`).join("")}</tr></tbody></table>
      ${instructors.length ? `<div class="pi"><b>Giáo viên phụ trách:</b> ${instructors.map(E).join(" · ")}</div>` : ""}
      <div class="pf">${E(center)} · In ${SM.dmy(SM.todayISO())}</div>
    </div>`;
    let cont = document.getElementById("cohort-print");
    if (!cont) { cont = document.createElement("div"); cont.id = "cohort-print"; document.body.appendChild(cont); }
    cont.innerHTML = doc;
    document.body.classList.add("printing-cohort");
    const done = () => { document.body.classList.remove("printing-cohort"); cont.innerHTML = ""; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 60);
    setTimeout(done, 60000);
  }

  return {
    async render(el, me) {
      ME = me; box = el; view = "list";
      box.innerHTML = `<div class="card placeholder"><span class="spinner"></span></div>`;
      teachers = await SM.refTeachers();
      await loadList();
    }
  };
})();

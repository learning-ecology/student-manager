/* ============================================================
   Nền tảng đa tenant — Quản lý giáo viên (chỉ CHỦ NỀN TẢNG)
   Tạo/sửa/khóa/xóa workspace giáo viên · đặt lại mật khẩu ·
   đăng nhập hộ (impersonate) · xem thống kê sử dụng.
   Thao tác quản trị gọi Edge Function "admin-tenants".
   ============================================================ */
window.Tenants = (function () {
  let ME = null, box = null;
  let rows = [], busy = false;
  const STATUS = { active: { l: "Hoạt động", c: "ok" }, trial: { l: "Dùng thử", c: "warn" },
                   suspended: { l: "Tạm ngưng", c: "bad" }, expired: { l: "Hết hạn", c: "mute" } };

  async function callFn(bodyObj) {
    const { data, error } = await sb.functions.invoke("admin-tenants", { body: bodyObj });
    if (error) {
      // cố lấy thông điệp lỗi từ Edge Function
      let msg = error.message || "Lỗi gọi máy chủ";
      try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch (_) {}
      return { error: msg };
    }
    if (data && data.error) return { error: data.error };
    return { data };
  }

  async function load() {
    busy = true; paint();
    const { data, error } = await sb.rpc("tenant_overview");
    busy = false;
    rows = error ? [] : (data || []);
    if (error) SM.toast("Lỗi tải danh sách: " + error.message, "err");
    paint();
  }

  function paint() {
    const myTid = ME.profile.tenant_id;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;">
        <h1 style="margin:.2rem 0;">Quản lý giáo viên</h1>
        <button class="btn" data-act="add">➕ Tạo tài khoản giáo viên</button>
      </div>
      <p class="muted" style="margin:.1rem 0 .8rem;font-size:.9rem;">Mỗi giáo viên có một workspace riêng, dữ liệu cách ly hoàn toàn. Bạn có thể tạm ngưng, đặt lại mật khẩu, hoặc đăng nhập hộ để hỗ trợ.</p>
      ${busy ? `<div class="card placeholder"><span class="spinner"></span></div>`
        : !rows.length ? `<div class="card placeholder"><div class="big">🏢</div><p class="muted">Chưa có workspace nào.</p></div>`
        : `<div class="sm-table-wrap"><table class="sm-table"><thead><tr>
            <th>Trung tâm / Giáo viên</th><th>Trạng thái</th><th>Học viên</th><th>Lớp</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>
          ${rows.map(r => {
            const me = r.tenant_id === myTid;
            const stt = STATUS[r.status] || { l: r.status, c: "mute" };
            const suspended = r.status === "suspended";
            return `<tr>
              <td data-th="Trung tâm"><b>${SM.esc(r.name)}</b>${me ? ' <span class="badge mute">của bạn</span>' : ""}<br><span class="muted" style="font-size:.8rem">Tạo ${SM.dmy(r.created_at)}</span></td>
              <td data-th="Trạng thái"><span class="badge ${stt.c}">${stt.l}</span></td>
              <td data-th="Học viên">${r.students}</td>
              <td data-th="Lớp">${r.classes}</td>
              <td data-th="Đăng nhập">${r.last_login ? SM.dmyhm(r.last_login) : "—"}</td>
              <td class="cell-actions"><div class="row-actions">
                ${me ? '<span class="muted" style="font-size:.82rem;align-self:center">workspace của bạn</span>'
                  : `<button class="btn ghost" data-imp="${r.tenant_id}" data-name="${SM.esc(r.name)}">Đăng nhập hộ</button>
                     <button class="btn ghost" data-pw="${r.tenant_id}" data-name="${SM.esc(r.name)}">Đổi mật khẩu</button>
                     <button class="btn ghost" data-status="${r.tenant_id}" data-to="${suspended ? "active" : "suspended"}">${suspended ? "Kích hoạt" : "Tạm ngưng"}</button>
                     <button class="btn ghost" data-del="${r.tenant_id}" data-name="${SM.esc(r.name)}" style="color:var(--danger);border-color:var(--danger)">Xóa</button>`}
              </div></td></tr>`;
          }).join("")}
        </tbody></table></div>`}`;
    box.onclick = onClick;
  }

  function createForm() {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:460px;"><div class="mh"><h3>➕ Tạo tài khoản giáo viên</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb">
        <div class="field"><label>Tên trung tâm / giáo viên *</label><input id="t-name" placeholder="vd: Trung tâm Anh ngữ ABC"></div>
        <div class="grid2">
          <div class="field"><label>Họ tên người quản lý</label><input id="t-full"></div>
          <div class="field"><label>Email đăng nhập *</label><input id="t-email" type="email" placeholder="giaovien@email.com"></div>
        </div>
        <div class="field"><label>Mật khẩu tạm *</label><input id="t-pw" value="${randPw()}"></div>
        <p class="muted" style="font-size:.83rem;">Workspace mới bắt đầu <b>trống hoàn toàn</b>. Gửi email + mật khẩu tạm này cho giáo viên; họ nên đổi mật khẩu sau khi đăng nhập.</p>
      </div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="t-go">Tạo tài khoản</button>
        <span class="msg" id="t-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#t-go").addEventListener("click", async () => {
      const say = (t, e) => { const m = ov.querySelector("#t-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const name = ov.querySelector("#t-name").value.trim();
      const email = ov.querySelector("#t-email").value.trim();
      const pw = ov.querySelector("#t-pw").value;
      if (!name) return say("Nhập tên trung tâm.", true);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Email không hợp lệ.", true);
      if ((pw || "").length < 6) return say("Mật khẩu tối thiểu 6 ký tự.", true);
      ov.querySelector("#t-go").disabled = true; say("Đang tạo…");
      const res = await callFn({ action: "create", email, password: pw, tenantName: name, fullName: ov.querySelector("#t-full").value.trim() });
      if (res.error) { ov.querySelector("#t-go").disabled = false; return say(res.error, true); }
      ov.remove(); SM.toast("✓ Đã tạo tài khoản giáo viên", "ok"); load();
    });
  }

  function pwForm(tenant_id, name) {
    const ov = document.createElement("div"); ov.className = "sm-ov";
    ov.innerHTML = `<div class="sm-modal" style="max-width:420px;"><div class="mh"><h3>Đổi mật khẩu · ${SM.esc(name)}</h3><button class="btn ghost" data-x="close">✕</button></div>
      <div class="mb"><div class="field"><label>Mật khẩu mới *</label><input id="p-pw" value="${randPw()}"></div>
        <p class="muted" style="font-size:.83rem;">Đặt lại mật khẩu cho tài khoản quản lý của workspace này. Nhớ báo lại cho giáo viên.</p></div>
      <div class="mf"><button class="btn ghost" data-x="close">Hủy</button><button class="btn" id="p-go">Đặt lại</button>
        <span class="msg" id="p-msg" style="align-self:center"></span></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.dataset.x === "close") ov.remove(); });
    ov.querySelector("#p-go").addEventListener("click", async () => {
      const say = (t, e) => { const m = ov.querySelector("#p-msg"); m.textContent = t; m.className = "msg" + (e ? " err" : ""); };
      const pw = ov.querySelector("#p-pw").value;
      if ((pw || "").length < 6) return say("Mật khẩu tối thiểu 6 ký tự.", true);
      ov.querySelector("#p-go").disabled = true; say("Đang đổi…");
      const res = await callFn({ action: "reset_password", tenant_id, password: pw });
      if (res.error) { ov.querySelector("#p-go").disabled = false; return say(res.error, true); }
      ov.remove(); SM.toast("✓ Đã đổi mật khẩu (" + pw + ")", "ok");
    });
  }

  async function setStatus(tenant_id, to) {
    const ok = await SM.confirmDialog({ title: to === "suspended" ? "Tạm ngưng workspace?" : "Kích hoạt lại?",
      danger: to === "suspended", okText: to === "suspended" ? "Tạm ngưng" : "Kích hoạt",
      body: to === "suspended" ? "Giáo viên sẽ không đăng nhập được cho đến khi bạn kích hoạt lại. Dữ liệu vẫn được giữ." : "Cho phép giáo viên đăng nhập trở lại." });
    if (!ok) return;
    const res = await callFn({ action: "set_status", tenant_id, status: to });
    if (res.error) return SM.toast(res.error, "err");
    SM.toast(to === "suspended" ? "⏸ Đã tạm ngưng" : "▶ Đã kích hoạt", "ok"); load();
  }

  async function del(tenant_id, name) {
    const ok = await SM.confirmDialog({ title: "Xóa workspace?", danger: true, okText: "Xóa vĩnh viễn",
      body: `Xóa <b>toàn bộ</b> dữ liệu của <b>${SM.esc(name)}</b> (học viên, lớp, hóa đơn, tài khoản đăng nhập…). <b>Không thể hoàn tác.</b>` });
    if (!ok) return;
    const res = await callFn({ action: "delete", tenant_id });
    if (res.error) return SM.toast(res.error, "err");
    SM.toast("🗑 Đã xóa workspace", "ok"); load();
  }

  async function impersonate(tenant_id, name) {
    const ok = await SM.confirmDialog({ title: "Đăng nhập hộ?", okText: "Đăng nhập hộ",
      body: `Bạn sẽ đăng nhập với tư cách <b>${SM.esc(name)}</b> để hỗ trợ. Phiên hiện tại sẽ chuyển sang workspace của họ; để quay lại, hãy đăng xuất rồi đăng nhập lại bằng tài khoản của bạn.` });
    if (!ok) return;
    SM.toast("Đang chuyển…", "ok");
    const redirect = location.origin + location.pathname.replace(/[^/]*$/, "index.html");
    const res = await callFn({ action: "impersonate", tenant_id, redirect_to: redirect });
    if (res.error) return SM.toast(res.error, "err");
    try { sessionStorage.setItem("sm_impersonate", name); } catch (_) {}
    if (res.data.action_link) { location.href = res.data.action_link; return; }
    // dự phòng: dùng token_hash
    if (res.data.token_hash) {
      const { error } = await sb.auth.verifyOtp({ token_hash: res.data.token_hash, type: "magiclink" });
      if (error) { try { sessionStorage.removeItem("sm_impersonate"); } catch (_) {} return SM.toast("Không đăng nhập hộ được: " + error.message, "err"); }
      location.href = "index.html";
    }
  }

  function onClick(e) {
    const b = e.target.closest("[data-act],[data-imp],[data-pw],[data-status],[data-del]");
    if (!b) return;
    if (b.dataset.act === "add") return createForm();
    if (b.dataset.imp) return impersonate(b.dataset.imp, b.dataset.name);
    if (b.dataset.pw) return pwForm(b.dataset.pw, b.dataset.name);
    if (b.dataset.status) return setStatus(b.dataset.status, b.dataset.to);
    if (b.dataset.del) return del(b.dataset.del, b.dataset.name);
  }

  function randPw() { return "Gv" + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10); }

  return {
    async render(el, me) {
      ME = me; box = el;
      if (!me.profile.is_platform_owner) {
        box.innerHTML = `<h1>Quản lý giáo viên</h1><div class="card placeholder"><div class="big">🔒</div><p class="muted">Chỉ <b>chủ nền tảng</b> mới truy cập được mục này.</p></div>`;
        return;
      }
      box.innerHTML = `<h1>Quản lý giáo viên</h1><div class="card placeholder"><span class="spinner"></span></div>`;
      load();
    }
  };
})();

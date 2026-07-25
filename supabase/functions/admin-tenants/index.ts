// ============================================================
//  Edge Function: admin-tenants
//  Quản trị tài khoản giáo viên (tenant) bằng SERVICE ROLE.
//  Chỉ CHỦ NỀN TẢNG (app_users.is_platform_owner) được gọi.
//  Hành động: create · reset_password · set_status · impersonate · delete
//
//  Deploy: Supabase Dashboard → Edge Functions → Deploy a new function
//    tên "admin-tenants", dán toàn bộ file này. (Không cần đặt secret —
//    SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY được Supabase tự cấp.)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // --- xác thực: người gọi phải là chủ nền tảng ---
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!jwt) return json(401, { error: "Thiếu xác thực." });
    const { data: uData, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !uData?.user) return json(401, { error: "Phiên không hợp lệ." });
    const { data: me } = await admin.from("app_users").select("is_platform_owner").eq("id", uData.user.id).maybeSingle();
    if (!me?.is_platform_owner) return json(403, { error: "Chỉ chủ nền tảng được phép." });

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    const tenantOwner = async (tenant_id: string) => {
      const { data } = await admin.from("app_users").select("id").eq("tenant_id", tenant_id).eq("role", "owner").limit(1).maybeSingle();
      return data?.id as string | undefined;
    };
    const isPlatformTenant = async (tenant_id: string) => {
      const { data } = await admin.from("app_users").select("id").eq("tenant_id", tenant_id).eq("is_platform_owner", true).limit(1).maybeSingle();
      return !!data;
    };

    // ---------- TẠO GIÁO VIÊN ----------
    if (action === "create") {
      const { email, password, tenantName, fullName } = body;
      if (!email || !password) return json(400, { error: "Thiếu email hoặc mật khẩu." });
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName || "" },
      });
      if (error) return json(400, { error: error.message });
      const uid = created.user.id;
      const { data: t, error: te } = await admin.from("tenants").insert({ name: tenantName || fullName || email }).select("id").single();
      if (te) { await admin.auth.admin.deleteUser(uid); return json(400, { error: te.message }); }
      await admin.from("app_users").upsert({ id: uid, tenant_id: t.id, role: "owner", full_name: fullName || "", active: true, is_platform_owner: false });
      await admin.from("settings").upsert({ tenant_id: t.id, center_name: tenantName || fullName || "Trung tâm" }, { onConflict: "tenant_id" });
      return json(200, { tenant_id: t.id, user_id: uid });
    }

    // ---------- ĐẶT LẠI MẬT KHẨU ----------
    if (action === "reset_password") {
      const { tenant_id, password } = body;
      if (!password) return json(400, { error: "Thiếu mật khẩu mới." });
      const uid = await tenantOwner(tenant_id);
      if (!uid) return json(404, { error: "Không tìm thấy tài khoản của workspace." });
      const { error } = await admin.auth.admin.updateUserById(uid, { password });
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    // ---------- TẠM NGƯNG / KÍCH HOẠT / HẾT HẠN ----------
    if (action === "set_status") {
      const { tenant_id, status } = body;
      if (await isPlatformTenant(tenant_id)) return json(400, { error: "Không thể đổi trạng thái workspace của chính bạn." });
      await admin.from("tenants").update({ status }).eq("id", tenant_id);
      const active = status === "active" || status === "trial";
      await admin.from("app_users").update({ active }).eq("tenant_id", tenant_id);   // chặn/mở đăng nhập
      return json(200, { ok: true });
    }

    // ---------- ĐĂNG NHẬP HỘ (IMPERSONATE) ----------
    if (action === "impersonate") {
      const { tenant_id, redirect_to } = body;
      const uid = await tenantOwner(tenant_id);
      if (!uid) return json(404, { error: "Không tìm thấy tài khoản." });
      const { data: au } = await admin.auth.admin.getUserById(uid);
      const email = au?.user?.email;
      if (!email) return json(404, { error: "Tài khoản không có email." });
      const { data: link, error } = await admin.auth.admin.generateLink({
        type: "magiclink", email, options: redirect_to ? { redirectTo: redirect_to } : undefined,
      });
      if (error) return json(400, { error: error.message });
      return json(200, { email, action_link: link.properties?.action_link, token_hash: link.properties?.hashed_token });
    }

    // ---------- XÓA WORKSPACE ----------
    if (action === "delete") {
      const { tenant_id } = body;
      if (await isPlatformTenant(tenant_id)) return json(400, { error: "Không thể xóa workspace của chính bạn." });
      const { data: users } = await admin.from("app_users").select("id").eq("tenant_id", tenant_id);
      await admin.from("tenants").delete().eq("id", tenant_id);   // ON DELETE CASCADE xóa toàn bộ dữ liệu + app_users
      for (const u of (users || [])) { try { await admin.auth.admin.deleteUser(u.id); } catch (_) { /* bỏ qua */ } }
      return json(200, { ok: true });
    }

    return json(400, { error: "Hành động không hợp lệ." });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e) });
  }
});

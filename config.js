// ------------------------------------------------------------
//  Cấu hình kết nối tới project Supabase RIÊNG của ứng dụng
//  Quản lý học viên (KHÔNG dùng chung với LMS).
//
//  Lấy 2 giá trị ở: Supabase → Settings → API
//   • Project URL          → dán vào SM_URL
//   • publishable/anon key → dán vào SM_KEY  (AN TOÀN để công khai)
//  TUYỆT ĐỐI không dán khóa service_role vào đây.
// ------------------------------------------------------------
const SM_URL = "https://zrmgunriwvcjppjykngk.supabase.co/rest/v1/";
const SM_KEY = "sb_publishable_bnFLg0D6eTxXjyzotw4hQg_43doAVoU";

const sb = supabase.createClient(SM_URL, SM_KEY);

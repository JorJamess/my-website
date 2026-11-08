-- นับการใส่รหัสผ่านผิดต่อ IP เพื่อล็อกชั่วคราวเมื่อผิดหลายครั้ง
CREATE TABLE IF NOT EXISTS login_attempts (
  ip            TEXT PRIMARY KEY,
  fails         INTEGER NOT NULL DEFAULT 0,
  first_at      INTEGER NOT NULL,          -- ms ของครั้งแรกในรอบนี้
  locked_until  INTEGER NOT NULL DEFAULT 0 -- ms; 0 = ไม่ได้ล็อก
);

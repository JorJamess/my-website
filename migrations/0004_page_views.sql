-- จำนวนคนเปิดหน้า Portfolio ต่อวัน (ไม่ใช้ cookie ไม่เก็บ IP เก็บแค่ประเทศกับเว็บที่ลิงก์มา)
CREATE TABLE IF NOT EXISTS page_views (
  day      TEXT NOT NULL,              -- YYYY-MM-DD เวลาไทย
  path     TEXT NOT NULL,              -- "/" หรือ "/th"
  ref      TEXT NOT NULL DEFAULT '',   -- ชื่อโดเมนที่ลิงก์มา เช่น linkedin.com ว่าง = เปิดตรง
  country  TEXT NOT NULL DEFAULT '',
  views    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, ref, country)
);

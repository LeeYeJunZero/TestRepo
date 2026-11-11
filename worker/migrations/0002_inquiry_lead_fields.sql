-- 첫 방문 팝업 신청서 항목 추가. 운영 DB에 Worker 배포 전 1회 실행:
--   npx wrangler d1 execute firstteacher --remote --file=migrations/0002_inquiry_lead_fields.sql
ALTER TABLE inquiries ADD COLUMN school TEXT;
ALTER TABLE inquiries ADD COLUMN address TEXT;
ALTER TABLE inquiries ADD COLUMN mode TEXT;

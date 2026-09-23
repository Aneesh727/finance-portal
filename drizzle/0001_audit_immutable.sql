-- Audit log is append-only: block UPDATE / DELETE / TRUNCATE for every DB role.
-- (Dropping the trigger requires table-owner privileges, which the app role should not use in prod.)
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not permitted)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
-- Helpful trigram-free search indexes for lists (lower-case prefix/contains searches use seq scan on
-- small tables; large tables get btree on the commonly searched columns via the schema indexes).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS projects_name_trgm ON projects USING gin (lower(name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS expenses_desc_trgm ON expenses USING gin (lower(description) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS costs_name_trgm ON project_costs USING gin (lower(name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clients_name_trgm ON clients USING gin (lower(company_name) gin_trgm_ops);

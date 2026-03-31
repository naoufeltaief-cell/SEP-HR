-- =============================================================================
-- Soins Expert Plus — Phase 1 Migration SQL
-- À exécuter dans Render Shell: psql $DATABASE_URL < migration_phase1.sql
-- =============================================================================

-- 1. Nouvelles colonnes sur schedules (garde / rappel)
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS garde_hours FLOAT DEFAULT 0;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS rappel_hours FLOAT DEFAULT 0;

-- 2. Table schedule_approvals
CREATE TABLE IF NOT EXISTS schedule_approvals (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    client_id INTEGER REFERENCES clients(id),
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, client_id, week_start)
);

-- 3. Table invoice_attachments
CREATE TABLE IF NOT EXISTS invoice_attachments (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR REFERENCES invoices(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(50) NOT NULL,
    file_size INTEGER DEFAULT 0,
    file_data BYTEA NOT NULL,
    category VARCHAR(50) DEFAULT 'autre',
    description TEXT DEFAULT '',
    uploaded_by VARCHAR(255) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice_id ON invoice_attachments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_schedule_approvals_lookup ON schedule_approvals(employee_id, client_id, week_start);

-- Vérification
SELECT 'schedule_approvals' AS table_name, count(*) FROM schedule_approvals
UNION ALL
SELECT 'invoice_attachments', count(*) FROM invoice_attachments;

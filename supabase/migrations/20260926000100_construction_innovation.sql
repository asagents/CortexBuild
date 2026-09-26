-- Construction Innovation Hub shared data
-- Adds tenant-scoped persistence for field ideas, constraints, and productivity snapshots.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS innovation_ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  area VARCHAR(80) NOT NULL DEFAULT 'Productivity',
  impact SMALLINT NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  effort SMALLINT NOT NULL DEFAULT 3 CHECK (effort BETWEEN 1 AND 5),
  status VARCHAR(20) NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'pilot', 'proven')),
  details TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS innovation_constraints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  owner VARCHAR(120) NOT NULL DEFAULT 'Site',
  severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('high', 'medium', 'low')),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS innovation_productivity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  planned_units NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (planned_units >= 0),
  installed_units NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (installed_units >= 0),
  crew_size INTEGER NOT NULL DEFAULT 0 CHECK (crew_size >= 0),
  unit_label VARCHAR(40) NOT NULL DEFAULT 'units',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_innovation_ideas_company_project
  ON innovation_ideas(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_innovation_ideas_status
  ON innovation_ideas(company_id, status);
CREATE INDEX IF NOT EXISTS idx_innovation_constraints_company_project
  ON innovation_constraints(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_innovation_constraints_open
  ON innovation_constraints(company_id, resolved);
CREATE INDEX IF NOT EXISTS idx_innovation_productivity_company_project_date
  ON innovation_productivity(company_id, project_id, work_date DESC);

ALTER TABLE innovation_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE innovation_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE innovation_productivity ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION cortexbuild_current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM users WHERE id = auth.uid() LIMIT 1;
$$;

DROP POLICY IF EXISTS innovation_ideas_tenant_isolation ON innovation_ideas;
CREATE POLICY innovation_ideas_tenant_isolation ON innovation_ideas
  FOR ALL
  USING (company_id = cortexbuild_current_company_id())
  WITH CHECK (company_id = cortexbuild_current_company_id());

DROP POLICY IF EXISTS innovation_constraints_tenant_isolation ON innovation_constraints;
CREATE POLICY innovation_constraints_tenant_isolation ON innovation_constraints
  FOR ALL
  USING (company_id = cortexbuild_current_company_id())
  WITH CHECK (company_id = cortexbuild_current_company_id());

DROP POLICY IF EXISTS innovation_productivity_tenant_isolation ON innovation_productivity;
CREATE POLICY innovation_productivity_tenant_isolation ON innovation_productivity
  FOR ALL
  USING (company_id = cortexbuild_current_company_id())
  WITH CHECK (company_id = cortexbuild_current_company_id());

CREATE OR REPLACE FUNCTION cortexbuild_set_innovation_updated_at()
RETURNS TRIGGER AS $
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_innovation_ideas_updated_at ON innovation_ideas;
CREATE TRIGGER update_innovation_ideas_updated_at
  BEFORE UPDATE ON innovation_ideas
  FOR EACH ROW EXECUTE FUNCTION cortexbuild_set_innovation_updated_at();

DROP TRIGGER IF EXISTS update_innovation_constraints_updated_at ON innovation_constraints;
CREATE TRIGGER update_innovation_constraints_updated_at
  BEFORE UPDATE ON innovation_constraints
  FOR EACH ROW EXECUTE FUNCTION cortexbuild_set_innovation_updated_at();

DROP TRIGGER IF EXISTS update_innovation_productivity_updated_at ON innovation_productivity;
CREATE TRIGGER update_innovation_productivity_updated_at
  BEFORE UPDATE ON innovation_productivity
  FOR EACH ROW EXECUTE FUNCTION cortexbuild_set_innovation_updated_at();

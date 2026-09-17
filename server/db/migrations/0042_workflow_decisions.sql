ALTER TABLE "triggers" ADD COLUMN "decision_condition" jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE TABLE ranked_sessions (
  id TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  deck TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX ranked_sessions_issued_at ON ranked_sessions (issued_at);
--> statement-breakpoint
CREATE TABLE ranked_scores (
  run_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct BETWEEN 0 AND 15),
  elapsed INTEGER NOT NULL CHECK (elapsed >= 0),
  recorded_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX ranked_scores_order ON ranked_scores (correct DESC, elapsed ASC, recorded_at ASC, run_id ASC);

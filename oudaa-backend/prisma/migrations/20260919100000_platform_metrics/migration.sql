-- Phase 5: Platform Performance Monitoring
-- Creates two tables:
--   platform_metric_snapshots  — 5-minute aggregated metric snapshots
--   platform_error_logs        — per-request structured error records
--
-- Both tables are append-only by convention (no UPDATE/DELETE exposed
-- through the API). The application prunes old error logs via a time
-- filter; no DB-level TTL is configured.

-- -----------------------------------------------------------------------
-- platform_metric_snapshots
-- -----------------------------------------------------------------------
CREATE TABLE "platform_metric_snapshots" (
    "id"             TEXT NOT NULL,
    "timestamp"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestCount"   INTEGER NOT NULL,
    "errorCount"     INTEGER NOT NULL,
    "averageLatency" DOUBLE PRECISION NOT NULL,
    "p95Latency"     DOUBLE PRECISION NOT NULL,
    "cpuPercent"     DOUBLE PRECISION,
    "memoryUsedMb"   DOUBLE PRECISION NOT NULL,
    "dbLatencyMs"    DOUBLE PRECISION,
    "activeSessions" INTEGER NOT NULL,
    "collectedBy"    TEXT,

    CONSTRAINT "platform_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- Time-range scans are the primary access pattern for chart queries.
CREATE INDEX "platform_metric_snapshots_timestamp_idx"
    ON "platform_metric_snapshots"("timestamp");

-- -----------------------------------------------------------------------
-- platform_error_logs
-- -----------------------------------------------------------------------
CREATE TABLE "platform_error_logs" (
    "id"              TEXT NOT NULL,
    "timestamp"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId"       TEXT,
    "method"          TEXT NOT NULL,
    "endpoint"        TEXT NOT NULL,
    "statusCode"      INTEGER NOT NULL,
    "errorCategory"   TEXT NOT NULL,
    "errorMessage"    TEXT NOT NULL,
    "communityId"     TEXT,
    "userId"          TEXT,
    "platformAdminId" TEXT,
    "latencyMs"       INTEGER,

    CONSTRAINT "platform_error_logs_pkey" PRIMARY KEY ("id")
);

-- Primary query: recent errors ordered by time.
CREATE INDEX "platform_error_logs_timestamp_idx"
    ON "platform_error_logs"("timestamp");

-- Filtering by status class (4xx vs 5xx).
CREATE INDEX "platform_error_logs_statusCode_idx"
    ON "platform_error_logs"("statusCode");

-- Grouping by endpoint for the "similar errors" view.
CREATE INDEX "platform_error_logs_endpoint_idx"
    ON "platform_error_logs"("endpoint");

-- Community-scoped error drill-down (platform admin reviewing a community's errors).
CREATE INDEX "platform_error_logs_communityId_idx"
    ON "platform_error_logs"("communityId");

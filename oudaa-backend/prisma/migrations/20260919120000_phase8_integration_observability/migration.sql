CREATE TABLE "platform_integration_events" (
    "id" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_integration_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_integration_events_integration_createdAt_idx" ON "platform_integration_events"("integration", "createdAt");
CREATE INDEX "platform_integration_events_integration_success_createdAt_idx" ON "platform_integration_events"("integration", "success", "createdAt");

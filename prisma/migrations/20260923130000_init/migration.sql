-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "hunt_characters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hunt_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hunt_records" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "day" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hunt_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hunt_evidence" (
    "id" TEXT NOT NULL,
    "hunt_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "image" BYTEA NOT NULL,

    CONSTRAINT "hunt_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hunt_characters_name_key" ON "hunt_characters"("name");

-- CreateIndex
CREATE INDEX "hunt_records_character_id_started_at_idx" ON "hunt_records"("character_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "hunt_evidence_hunt_id_kind_captured_at_idx" ON "hunt_evidence"("hunt_id", "kind", "captured_at" DESC);

-- AddForeignKey
ALTER TABLE "hunt_records" ADD CONSTRAINT "hunt_records_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "hunt_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hunt_evidence" ADD CONSTRAINT "hunt_evidence_hunt_id_fkey" FOREIGN KEY ("hunt_id") REFERENCES "hunt_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permanent case numbers (#1, #2, …) so WhatsApp references don't shift when a case closes.
-- Existing cases are numbered in creation order.
CREATE SEQUENCE "Case_number_seq";
ALTER TABLE "Case" ADD COLUMN "number" INTEGER;
UPDATE "Case" c SET "number" = n.rn
FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn FROM "Case") n
WHERE n.id = c.id;
SELECT setval('"Case_number_seq"', COALESCE((SELECT MAX("number") FROM "Case"), 0) + 1, false);
ALTER TABLE "Case" ALTER COLUMN "number" SET DEFAULT nextval('"Case_number_seq"');
ALTER TABLE "Case" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "Case_number_seq" OWNED BY "Case"."number";
CREATE UNIQUE INDEX "Case_number_key" ON "Case"("number");

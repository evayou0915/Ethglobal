-- Re-add the Privy account link for the dual-token (SIWE + Privy) auth path.
ALTER TABLE "User" ADD COLUMN "privyId" VARCHAR(64);
CREATE UNIQUE INDEX "User_privyId_key" ON "User"("privyId");

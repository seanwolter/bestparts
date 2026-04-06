-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "upvoteCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VideoUpvote" (
    "id" TEXT NOT NULL,
    "videoId" INTEGER NOT NULL,
    "voterKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoUpvote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoUpvote_videoId_idx" ON "VideoUpvote"("videoId");

-- CreateIndex
CREATE INDEX "VideoUpvote_videoId_voterKeyHash_createdAt_idx" ON "VideoUpvote"("videoId", "voterKeyHash", "createdAt");

-- CreateIndex
CREATE INDEX "Video_upvoteCount_submittedAt_idx" ON "Video"("upvoteCount", "submittedAt");

-- AddForeignKey
ALTER TABLE "VideoUpvote" ADD CONSTRAINT "VideoUpvote_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

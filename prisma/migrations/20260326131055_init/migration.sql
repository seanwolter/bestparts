-- CreateTable
CREATE TABLE "Video" (
    "id" SERIAL NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "movieTitle" TEXT NOT NULL,
    "sceneTitle" TEXT NOT NULL,
    "description" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

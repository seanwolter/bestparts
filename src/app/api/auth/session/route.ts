import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserFromCookieStore } from "@/lib/auth/current-user";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUserFromCookieStore(request.cookies, db);

  if (!currentUser) {
    return NextResponse.json({
      authenticated: false,
      user: null,
    });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: currentUser.id,
      username: currentUser.username,
      role: currentUser.role,
      status: currentUser.status,
    },
  });
}

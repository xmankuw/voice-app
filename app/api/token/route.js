import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";

// لازم يشتغل على بيئة Node (مو Edge) لأن livekit-server-sdk يحتاجها
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const room = request.nextUrl.searchParams.get("room");
  const username = request.nextUrl.searchParams.get("username");

  if (!room || !username) {
    return NextResponse.json(
      { error: "لازم ترسل اسم الغرفة واسم المستخدم" },
      { status: 400 }
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "السيرفر ناقص الإعدادات: تأكد من المفاتيح في Environment Variables" },
      { status: 500 }
    );
  }

  // ننشئ توكن دخول لهالمستخدم لهالغرفة، مع صلاحية النشر والاستماع
  const at = new AccessToken(apiKey, apiSecret, {
    identity: username,
    name: username,
    ttl: "2h",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token });
}

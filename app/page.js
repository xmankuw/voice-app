"use client";

import { useState } from "react";
import RoomView from "../components/RoomView";

export default function Home() {
  const [joined, setJoined] = useState(false);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  const join = async () => {
    if (!username.trim() || !room.trim()) {
      setError("اكتب اسمك واسم الغرفة");
      return;
    }
    if (!serverUrl) {
      setError("الرابط NEXT_PUBLIC_LIVEKIT_URL غير مضبوط في الإعدادات");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/token?room=${encodeURIComponent(room)}&username=${encodeURIComponent(username)}`
      );
      const data = await res.json();
      if (!res.ok || !data.token) {
        throw new Error(data.error || "تعذّر الاتصال بالسيرفر");
      }
      setToken(data.token);
      setJoined(true);
    } catch (e) {
      setError(e.message || "صار خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  };

  const leave = () => {
    setJoined(false);
    setToken("");
  };

  if (joined && token && serverUrl) {
    return (
      <RoomView
        token={token}
        serverUrl={serverUrl}
        username={username}
        roomName={room}
        onLeave={leave}
      />
    );
  }

  return (
    <div className="join">
      <div className="join-card">
        <div className="join-logo">🎧</div>
        <h1>غرفة صوتية</h1>
        <p>اكتب اسمك واسم الغرفة، وأرسل نفس اسم الغرفة لأصدقائك عشان يدخلون معك.</p>

        <label>اسمك</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="مثال: خالد"
          maxLength={24}
        />

        <label>اسم الغرفة</label>
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="مثال: شباب-الديوانية"
          maxLength={40}
          onKeyDown={(e) => e.key === "Enter" && join()}
        />

        {error && <div className="join-error">{error}</div>}

        <button className="join-btn" onClick={join} disabled={loading}>
          {loading ? "جاري الدخول..." : "دخول الغرفة"}
        </button>

        <div className="join-hint">
          سيطلب المتصفح إذن استخدام المايك — اضغط "سماح".
        </div>
      </div>
    </div>
  );
}

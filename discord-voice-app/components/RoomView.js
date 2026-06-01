"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import DiscordUI from "./DiscordUI";

export default function RoomView({ token, serverUrl, username, roomName, onLeave }) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={false}
      // إعدادات تساعد على جودة أعلى وزمن استجابة أفضل
      options={{
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }}
      onDisconnected={onLeave}
      style={{ height: "100vh" }}
    >
      <DiscordUI username={username} roomName={roomName} onLeave={onLeave} />
      {/* هذا المكوّن يشغّل صوت بقية الأعضاء */}
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  useRoomContext,
  useLocalParticipant,
  useParticipants,
  useTracks,
  useChat,
  VideoTrack,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  PhoneOff, Volume2, Send, Signal,
} from "lucide-react";

const COLORS = ["#5865f2", "#eb459e", "#faa61a", "#23a55a", "#3498db", "#9b59b6", "#e67e22", "#1abc9c"];
function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
function initial(name) {
  const t = String(name || "?").trim();
  return t ? t[0].toUpperCase() : "?";
}

// قراءة زمن الاستجابة (ping) من إحصائيات WebRTC كل ثانية
function usePing() {
  const room = useRoomContext();
  const [ping, setPing] = useState(null);

  useEffect(() => {
    if (!room) return;
    let stopped = false;

    async function sample() {
      try {
        const pubs = [];
        room.localParticipant?.trackPublications?.forEach((p) => pubs.push(p));
        room.remoteParticipants?.forEach((rp) =>
          rp.trackPublications?.forEach((p) => pubs.push(p))
        );

        let rtt = null;
        for (const pub of pubs) {
          const track = pub.track;
          if (!track || typeof track.getRTCStatsReport !== "function") continue;
          const report = await track.getRTCStatsReport();
          if (!report) continue;
          report.forEach((s) => {
            if (s.type === "remote-inbound-rtp" && typeof s.roundTripTime === "number") {
              rtt = s.roundTripTime * 1000;
            } else if (
              s.type === "candidate-pair" &&
              s.nominated &&
              typeof s.currentRoundTripTime === "number" &&
              rtt == null
            ) {
              rtt = s.currentRoundTripTime * 1000;
            }
          });
          if (rtt != null) break;
        }
        if (!stopped && rtt != null) setPing(Math.round(rtt));
      } catch {
        /* تجاهل */
      }
    }

    const id = setInterval(sample, 1000);
    sample();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [room]);

  return ping;
}

export default function DiscordUI({ username, roomName, onLeave }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  const { chatMessages, send } = useChat();
  const ping = usePing();

  const [speaking, setSpeaking] = useState(new Set());
  const [draft, setDraft] = useState("");

  // من يتكلم الآن (للحلقة الخضراء)
  useEffect(() => {
    if (!room) return;
    const handler = (speakers) => setSpeaking(new Set(speakers.map((s) => s.identity)));
    room.on(RoomEvent.ActiveSpeakersChanged, handler);
    return () => room.off(RoomEvent.ActiveSpeakersChanged, handler);
  }, [room]);

  const screenRef = tracks.find(
    (t) => t.source === Track.Source.ScreenShare && t.publication?.track
  );
  const cameraOf = (identity) =>
    tracks.find(
      (t) =>
        t.source === Track.Source.Camera &&
        t.participant?.identity === identity &&
        t.publication?.track &&
        !t.publication?.isMuted
    );

  const pingColor =
    ping == null ? "#949ba4" : ping < 80 ? "#23a55a" : ping < 200 ? "#faa61a" : "#f23f43";
  const pingLabel =
    ping == null ? "قياس…" : ping < 80 ? "ممتاز" : ping < 200 ? "جيد" : "مرتفع";

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    send(t);
    setDraft("");
  };

  const leave = () => {
    room?.disconnect();
    onLeave && onLeave();
  };

  return (
    <div className="app">
      {/* الشريط الجانبي: الأعضاء في القناة الصوتية */}
      <aside className="sidebar">
        <div className="srv-header">🎧 {roomName}</div>

        <div className="chan-scroll">
          <div className="cat">القناة الصوتية — {participants.length}</div>
          <div className="chan active">
            <Volume2 size={18} /> {roomName}
          </div>
          {participants.map((p) => (
            <div className="voice-user" key={p.sid}>
              <div className="av-sm" style={{ background: colorFor(p.identity) }}>
                {initial(p.name || p.identity)}
              </div>
              <span className="vu-name">
                {p.name || p.identity}
                {p.isLocal ? " (أنت)" : ""}
              </span>
              {!p.isMicrophoneEnabled && <MicOff size={14} className="vu-mute" />}
            </div>
          ))}
        </div>

        <div className="user-panel">
          <div className="av-sm" style={{ background: colorFor(username) }}>
            {initial(username)}
          </div>
          <div className="up-info">
            <div className="up-name">{username}</div>
            <div className="up-tag">في الغرفة</div>
          </div>
          <button
            className={"up-btn" + (isMicrophoneEnabled ? "" : " muted")}
            title="كتم/فتح المايك"
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          >
            {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
        </div>
      </aside>

      {/* المنطقة الوسطى: شاشة المكالمة + مؤشر التأخير + الأزرار */}
      <main className="center">
        <div className="topbar">
          <span className="room-name"># {roomName}</span>
          <div className="ping" style={{ color: pingColor }} title="زمن الاستجابة (كل ما قلّ كان أحسن)">
            <Signal size={16} />
            {ping == null ? "—" : `${ping} ms`}
            <span className="ping-label">· {pingLabel}</span>
          </div>
        </div>

        <div className="stage">
          {screenRef && (
            <div className="screen">
              <VideoTrack trackRef={screenRef} className="screen-video" />
              <span className="screen-label">
                🔴 بث شاشة — {screenRef.participant?.name || screenRef.participant?.identity}
              </span>
            </div>
          )}

          <div className="tiles">
            {participants.map((p) => {
              const cam = cameraOf(p.identity);
              const isSp = speaking.has(p.identity);
              return (
                <div className={"tile" + (isSp ? " speaking" : "")} key={p.sid}>
                  {cam ? (
                    <VideoTrack trackRef={cam} className="tile-video" />
                  ) : (
                    <div className="tile-av" style={{ background: colorFor(p.identity) }}>
                      {initial(p.name || p.identity)}
                    </div>
                  )}
                  <div className="tile-name">
                    {!p.isMicrophoneEnabled && <MicOff size={13} />}
                    {p.name || p.identity}
                    {p.isLocal ? " (أنت)" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="controls">
          <button
            className={"cc" + (isMicrophoneEnabled ? "" : " muted")}
            title="المايك"
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          >
            {isMicrophoneEnabled ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
          <button
            className={"cc" + (isCameraEnabled ? " active" : "")}
            title="الكاميرا"
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
          >
            {isCameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
          <button
            className={"cc" + (isScreenShareEnabled ? " active" : "")}
            title="بث الشاشة"
            onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}
          >
            {isScreenShareEnabled ? <MonitorOff size={22} /> : <Monitor size={22} />}
          </button>
          <button className="cc danger" title="مغادرة" onClick={leave}>
            <PhoneOff size={22} />
          </button>
        </div>
      </main>

      {/* الدردشة الكتابية */}
      <aside className="chatp">
        <div className="chatp-head"># دردشة</div>
        <div className="chatp-msgs">
          {chatMessages.length === 0 && (
            <div className="chatp-empty">لا توجد رسائل بعد — اكتب أول رسالة 👋</div>
          )}
          {chatMessages.map((m, i) => {
            const who = m.from?.name || m.from?.identity || "مجهول";
            return (
              <div className="cmsg" key={m.id || i}>
                <span className="cmsg-author" style={{ color: colorFor(who) }}>
                  {who}
                </span>
                <span className="cmsg-text">{m.message}</span>
              </div>
            );
          })}
        </div>
        <div className="chatp-input">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="اكتب رسالة..."
          />
          <button onClick={submit} title="إرسال">
            <Send size={18} />
          </button>
        </div>
      </aside>
    </div>
  );
}

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
  PhoneOff, Volume2, VolumeX, Send, Signal, Settings, X,
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

// ---- قياس زمن الاستجابة (ping) ----
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
            if (s.type === "remote-inbound-rtp" && typeof s.roundTripTime === "number") rtt = s.roundTripTime * 1000;
            else if (s.type === "candidate-pair" && s.nominated && typeof s.currentRoundTripTime === "number" && rtt == null) rtt = s.currentRoundTripTime * 1000;
          });
          if (rtt != null) break;
        }
        if (!stopped && rtt != null) setPing(Math.round(rtt));
      } catch {}
    }
    const id = setInterval(sample, 1000);
    sample();
    return () => { stopped = true; clearInterval(id); };
  }, [room]);
  return ping;
}

// ---- مؤشر مستوى صوت المايك المباشر ----
function useMicLevel(enabled, localParticipant, dep) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled || !localParticipant) { setLevel(0); return; }
    let raf, ctx, cancelled = false;
    async function setup() {
      try {
        const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
        const mst = pub?.track?.mediaStreamTrack;
        if (!mst) { if (!cancelled) raf = requestAnimationFrame(setup); return; }
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume?.();
        const src = ctx.createMediaStreamSource(new MediaStream([mst]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / data.length);
          if (!cancelled) setLevel(Math.min(1, rms * 3));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    }
    setup();
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); try { ctx && ctx.close(); } catch {} };
  }, [enabled, localParticipant, dep]);
  return level;
}

export default function DiscordUI({ username, roomName, onLeave }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);
  const { chatMessages, send } = useChat();
  const ping = usePing();

  const [speaking, setSpeaking] = useState(new Set());
  const [draft, setDraft] = useState("");

  // التحكم بصوت كل صديق
  const [volumes, setVolumes] = useState({});        // { identity: 0..2 }
  const [localMuted, setLocalMuted] = useState(new Set());

  // الأجهزة (مايك/سماعة)
  const [devices, setDevices] = useState({ mic: [], speaker: [] });
  const [activeMic, setActiveMic] = useState("");
  const [activeSpeaker, setActiveSpeaker] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const micLevel = useMicLevel(isMicrophoneEnabled, localParticipant, activeMic);

  // من يتكلم الآن
  useEffect(() => {
    if (!room) return;
    const handler = (sp) => setSpeaking(new Set(sp.map((s) => s.identity)));
    room.on(RoomEvent.ActiveSpeakersChanged, handler);
    return () => room.off(RoomEvent.ActiveSpeakersChanged, handler);
  }, [room]);

  // تطبيق مستوى الصوت/الكتم المحلّي على كل صديق
  useEffect(() => {
    participants.forEach((p) => {
      if (p.isLocal) return;
      try {
        const v = localMuted.has(p.identity) ? 0 : (volumes[p.identity] ?? 1);
        p.setVolume(v);
      } catch {}
    });
  }, [participants, volumes, localMuted]);

  // قراءة قائمة الأجهزة
  useEffect(() => {
    async function load() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices({
          mic: all.filter((d) => d.kind === "audioinput"),
          speaker: all.filter((d) => d.kind === "audiooutput"),
        });
      } catch {}
    }
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, []);

  const setVolumeFor = (identity, v) => {
    setVolumes((prev) => ({ ...prev, [identity]: v }));
    if (v > 0) setLocalMuted((prev) => { const n = new Set(prev); n.delete(identity); return n; });
  };
  const toggleLocalMute = (identity) =>
    setLocalMuted((prev) => { const n = new Set(prev); n.has(identity) ? n.delete(identity) : n.add(identity); return n; });

  const changeMic = async (deviceId) => {
    try { await room.switchActiveDevice("audioinput", deviceId); setActiveMic(deviceId); } catch {}
  };
  const changeSpeaker = async (deviceId) => {
    try { await room.switchActiveDevice("audiooutput", deviceId); setActiveSpeaker(deviceId); } catch {}
  };

  const screenRef = tracks.find((t) => t.source === Track.Source.ScreenShare && t.publication?.track);
  const cameraOf = (identity) =>
    tracks.find((t) => t.source === Track.Source.Camera && t.participant?.identity === identity && t.publication?.track && !t.publication?.isMuted);

  const pingColor = ping == null ? "#949ba4" : ping < 80 ? "#23a55a" : ping < 200 ? "#faa61a" : "#f23f43";
  const pingLabel = ping == null ? "قياس…" : ping < 80 ? "ممتاز" : ping < 200 ? "جيد" : "مرتفع";

  const submit = () => { const t = draft.trim(); if (!t) return; send(t); setDraft(""); };
  const leave = () => { room?.disconnect(); onLeave && onLeave(); };

  return (
    <div className="app">
      {/* الشريط الجانبي */}
      <aside className="sidebar">
        <div className="srv-header">🎧 {roomName}</div>

        <div className="chan-scroll">
          <div className="cat">القناة الصوتية — {participants.length}</div>
          <div className="chan active"><Volume2 size={18} /> {roomName}</div>

          {participants.map((p) => {
            const muted = localMuted.has(p.identity);
            const vol = muted ? 0 : Math.round((volumes[p.identity] ?? 1) * 100);
            return (
              <div key={p.sid}>
                <div className="voice-user">
                  <div className="av-sm" style={{ background: colorFor(p.identity) }}>{initial(p.name || p.identity)}</div>
                  <span className="vu-name">{p.name || p.identity}{p.isLocal ? " (أنت)" : ""}</span>
                  {!p.isMicrophoneEnabled && <MicOff size={14} className="vu-mute" />}
                </div>
                {!p.isLocal && (
                  <div className="pcontrols">
                    <button className={"pc-btn" + (muted ? " on" : "")} title={muted ? "إلغاء الكتم عندي" : "اكتمه عندي فقط"} onClick={() => toggleLocalMute(p.identity)}>
                      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <input className="vol" type="range" min="0" max="200" value={vol}
                      onChange={(e) => setVolumeFor(p.identity, Number(e.target.value) / 100)} />
                    <span className="vol-pct">{vol}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="user-panel">
          <div className="av-sm" style={{ background: colorFor(username) }}>{initial(username)}</div>
          <div className="up-info">
            <div className="up-name">{username}</div>
            <div className="up-tag">في الغرفة</div>
          </div>
          <button className="up-btn" title="إعدادات الصوت" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
          <button className={"up-btn" + (isMicrophoneEnabled ? "" : " muted")} title="كتم/فتح المايك"
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>
            {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
        </div>
      </aside>

      {/* المنطقة الوسطى */}
      <main className="center">
        <div className="topbar">
          <span className="room-name"># {roomName}</span>
          <div className="ping" style={{ color: pingColor }} title="زمن الاستجابة">
            <Signal size={16} />{ping == null ? "—" : `${ping} ms`}<span className="ping-label">· {pingLabel}</span>
          </div>
        </div>

        <div className="stage">
          {screenRef && (
            <div className="screen">
              <VideoTrack trackRef={screenRef} className="screen-video" />
              <span className="screen-label">🔴 بث شاشة — {screenRef.participant?.name || screenRef.participant?.identity}</span>
            </div>
          )}
          <div className="tiles">
            {participants.map((p) => {
              const cam = cameraOf(p.identity);
              const isSp = speaking.has(p.identity) && !localMuted.has(p.identity);
              return (
                <div className={"tile" + (isSp ? " speaking" : "")} key={p.sid}>
                  {cam ? <VideoTrack trackRef={cam} className="tile-video" />
                    : <div className="tile-av" style={{ background: colorFor(p.identity) }}>{initial(p.name || p.identity)}</div>}
                  <div className="tile-name">
                    {localMuted.has(p.identity) ? <VolumeX size={13} /> : (!p.isMicrophoneEnabled && <MicOff size={13} />)}
                    {p.name || p.identity}{p.isLocal ? " (أنت)" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="controls">
          <button className={"cc" + (isMicrophoneEnabled ? "" : " muted")} title="المايك"
            onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>
            {isMicrophoneEnabled ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
          <button className={"cc" + (isCameraEnabled ? " active" : "")} title="الكاميرا"
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}>
            {isCameraEnabled ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
          <button className={"cc" + (isScreenShareEnabled ? " active" : "")} title="بث الشاشة"
            onClick={() => localParticipant.setScreenShareEnabled(!isScreenShareEnabled)}>
            {isScreenShareEnabled ? <MonitorOff size={22} /> : <Monitor size={22} />}
          </button>
          <button className="cc" title="إعدادات الصوت" onClick={() => setSettingsOpen(true)}><Settings size={22} /></button>
          <button className="cc danger" title="مغادرة" onClick={leave}><PhoneOff size={22} /></button>
        </div>
      </main>

      {/* الدردشة */}
      <aside className="chatp">
        <div className="chatp-head"># دردشة</div>
        <div className="chatp-msgs">
          {chatMessages.length === 0 && <div className="chatp-empty">لا توجد رسائل بعد — اكتب أول رسالة 👋</div>}
          {chatMessages.map((m, i) => {
            const who = m.from?.name || m.from?.identity || "مجهول";
            return (
              <div className="cmsg" key={m.id || i}>
                <span className="cmsg-author" style={{ color: colorFor(who) }}>{who}</span>
                <span className="cmsg-text">{m.message}</span>
              </div>
            );
          })}
        </div>
        <div className="chatp-input">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="اكتب رسالة..." />
          <button onClick={submit} title="إرسال"><Send size={18} /></button>
        </div>
      </aside>

      {/* نافذة إعدادات الصوت */}
      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-head">
              <span>إعدادات الصوت</span>
              <button className="modal-close" onClick={() => setSettingsOpen(false)}><X size={20} /></button>
            </div>

            <div className="settings-row">
              <label>المايك (الإدخال)</label>
              <select value={activeMic} onChange={(e) => changeMic(e.target.value)}>
                <option value="">المايك الافتراضي</option>
                {devices.mic.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "مايك"}</option>
                ))}
              </select>
              <div className="meter-label">تكلم وشوف الشريط يتحرك (تأكيد إن المايك شغّال):</div>
              <div className="level-meter"><div className="level-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} /></div>
            </div>

            <div className="settings-row">
              <label>السماعة (الإخراج)</label>
              <select value={activeSpeaker} onChange={(e) => changeSpeaker(e.target.value)}>
                <option value="">السماعة الافتراضية</option>
                {devices.speaker.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "سماعة"}</option>
                ))}
              </select>
              {devices.speaker.length === 0 && <div className="meter-label">اختيار السماعة غير مدعوم في هذا المتصفح.</div>}
            </div>

            <div className="settings-note">💡 للتحكم بصوت كل صديق (رفع/خفض أو كتمه عندك فقط)، استخدم الشريط تحت اسمه في القائمة الجانبية.</div>
          </div>
        </div>
      )}
    </div>
  );
}

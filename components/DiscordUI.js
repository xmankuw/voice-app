"use client";

import { useEffect, useState, useRef } from "react";
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
  PhoneOff, Volume2, VolumeX, Send, Signal, Settings, X, Maximize2, Plus, Minus, Expand,
} from "lucide-react";

const COLORS = ["#5865f2", "#eb459e", "#faa61a", "#23a55a", "#3498db", "#9b59b6", "#e67e22", "#1abc9c"];

const QUALITY = {
  normal: { label: "عادي (720p · 15 فريم)", w: 1280, h: 720, fps: 15 },
  hd: { label: "HD (720p · 30 فريم)", w: 1280, h: 720, fps: 30 },
  fullhd: { label: "Full HD (1080p · 30 فريم)", w: 1920, h: 1080, fps: 30 },
  gaming: { label: "ألعاب (1080p · 60 فريم)", w: 1920, h: 1080, fps: 60 },
};
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
  const [masterVol, setMasterVol] = useState(1);   // مستوى السماعة العام 0..1.5
  const [micGain, setMicGain] = useState(1);        // تكبير صوت المايك 0..2
  const micProc = useRef(null);
  // البث
  const [streamMenuOpen, setStreamMenuOpen] = useState(false);
  const [streamQuality, setStreamQuality] = useState("hd");
  const [streamAudio, setStreamAudio] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const appRef = useRef(null);
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
        const base = localMuted.has(p.identity) ? 0 : (volumes[p.identity] ?? 1);
        p.setVolume(base * masterVol);
      } catch {}
    });
  }, [participants, volumes, localMuted, masterVol]);

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

  // إغلاق العرض لو خرج المستخدم من ملء الشاشة (Esc)
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const setVolumeFor = (identity, v) => {
    setVolumes((prev) => ({ ...prev, [identity]: v }));
    if (v > 0) setLocalMuted((prev) => { const n = new Set(prev); n.delete(identity); return n; });
  };
  const toggleLocalMute = (identity) =>
    setLocalMuted((prev) => { const n = new Set(prev); n.has(identity) ? n.delete(identity) : n.add(identity); return n; });

  const teardownMicProc = async (restore) => {
    if (!micProc.current) return;
    try {
      if (restore) {
        const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
        const lk = pub?.audioTrack || pub?.track;
        if (lk) await lk.restartTrack(activeMic ? { deviceId: { exact: activeMic } } : undefined);
      }
    } catch {}
    try { micProc.current.ctx.close(); } catch {}
    try { micProc.current.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    micProc.current = null;
  };

  // شريط تكبير/تصغير صوت المايك الطالع منك (100% = طبيعي)
  const applyMicGain = async (g) => {
    setMicGain(g);
    try {
      const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
      const lk = pub?.audioTrack || pub?.track;
      if (!lk) return;
      if (g === 1) { await teardownMicProc(true); return; }
      if (!micProc.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: activeMic ? { deviceId: { exact: activeMic } } : true,
        });
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(dest);
        micProc.current = { ctx, source, gain, dest, stream };
        await lk.replaceTrack(dest.stream.getAudioTracks()[0]);
      }
      micProc.current.gain.gain.value = g;
    } catch {}
  };

  const changeMic = async (deviceId) => {
    try {
      await teardownMicProc(false);
      setMicGain(1);
      await room.switchActiveDevice("audioinput", deviceId);
      setActiveMic(deviceId);
    } catch {}
  };
  const changeSpeaker = async (deviceId) => {
    try { await room.switchActiveDevice("audiooutput", deviceId); setActiveSpeaker(deviceId); } catch {}
  };

  // البث: بدء بالجودة المختارة + صوت اختياري
  const startScreen = async () => {
    setStreamMenuOpen(false);
    const q = QUALITY[streamQuality] || QUALITY.hd;
    try {
      await localParticipant.setScreenShareEnabled(true, {
        audio: streamAudio,
        resolution: { width: q.w, height: q.h, frameRate: q.fps },
      });
    } catch {}
  };
  const toggleScreen = () => {
    if (isScreenShareEnabled) localParticipant.setScreenShareEnabled(false);
    else setStreamMenuOpen(true);
  };

  // تكبير/تصغير وتحريك البث
  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomIn = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => { const n = Math.max(1, +(z - 0.25).toFixed(2)); if (n === 1) setPan({ x: 0, y: 0 }); return n; });
  const onWheel = (e) => { if (e.deltaY < 0) zoomIn(); else zoomOut(); };
  const onDown = (e) => { if (zoom <= 1) return; dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; };
  const onMove = (e) => { if (!dragRef.current) return; setPan({ x: dragRef.current.px + (e.clientX - dragRef.current.sx), y: dragRef.current.py + (e.clientY - dragRef.current.sy) }); };
  const onUp = () => { dragRef.current = null; };
  const openFullscreen = () => { resetZoom(); setFullscreen(true); };
  const closeFullscreen = () => {
    setFullscreen(false); resetZoom();
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  };
  const enterRealFullscreen = () => {
    resetZoom(); setFullscreen(true);
    try { appRef.current?.requestFullscreen?.(); } catch {}
  };

  const screenRef = tracks.find((t) => t.source === Track.Source.ScreenShare && t.publication?.track);
  const cameraOf = (identity) =>
    tracks.find((t) => t.source === Track.Source.Camera && t.participant?.identity === identity && t.publication?.track && !t.publication?.isMuted);
  useEffect(() => { if (!screenRef) setFullscreen(false); }, [!!screenRef]);
  const screenName = screenRef ? (screenRef.participant?.name || screenRef.participant?.identity) : "";

  const pingColor = ping == null ? "#949ba4" : ping < 80 ? "#23a55a" : ping < 200 ? "#faa61a" : "#f23f43";
  const pingLabel = ping == null ? "قياس…" : ping < 80 ? "ممتاز" : ping < 200 ? "جيد" : "مرتفع";

  const submit = () => { const t = draft.trim(); if (!t) return; send(t); setDraft(""); };
  const leave = () => { room?.disconnect(); onLeave && onLeave(); };

  return (
    <div className="app" ref={appRef}>
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
              <div className="screen-bar">
                <span className="screen-label">🔴 يبث الآن: {screenName}</span>
                <button className="watch-btn" onClick={openFullscreen}>
                  <Maximize2 size={16} /> شاهد ملء الشاشة
                </button>
              </div>
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
            onClick={toggleScreen}>
            {isScreenShareEnabled ? <MonitorOff size={22} /> : <Monitor size={22} />}
          </button>
          {screenRef && (
            <button className="cc" title="ملء الشاشة" onClick={enterRealFullscreen}>
              <Expand size={22} />
            </button>
          )}
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
              <label>مستوى المايك (التكبير) — {Math.round(micGain * 100)}%</label>
              <input className="srange" type="range" min="0" max="200" value={Math.round(micGain * 100)}
                onChange={(e) => applyMicGain(Number(e.target.value) / 100)} />
              <div className="meter-label">100% = طبيعي. ارفعه لو صوتك ضعيف عندهم. (لو توقّف صوتك فجأة، رجّعه على 100%).</div>
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

            <div className="settings-row">
              <label>مستوى السماعة العام — {Math.round(masterVol * 100)}%</label>
              <input className="srange" type="range" min="0" max="150" value={Math.round(masterVol * 100)}
                onChange={(e) => setMasterVol(Number(e.target.value) / 100)} />
              <div className="meter-label">يتحكم في صوت كل الأصدقاء مرة وحدة.</div>
            </div>

            <div className="settings-note">💡 للتحكم بصوت كل صديق (رفع/خفض أو كتمه عندك فقط)، استخدم الشريط تحت اسمه في القائمة الجانبية.</div>
          </div>
        </div>
      )}

      {/* قائمة بدء البث */}
      {streamMenuOpen && (
        <div className="settings-overlay" onClick={() => setStreamMenuOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-head">
              <span>بدء البث 🎬</span>
              <button className="modal-close" onClick={() => setStreamMenuOpen(false)}><X size={20} /></button>
            </div>
            <div className="settings-row">
              <label>الجودة</label>
              <select value={streamQuality} onChange={(e) => setStreamQuality(e.target.value)}>
                {Object.entries(QUALITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <div className="meter-label">كل ما زادت الجودة زاد استهلاك النت. للألعاب اختر 60 فريم.</div>
            </div>
            <label className="chk">
              <input type="checkbox" checked={streamAudio} onChange={(e) => setStreamAudio(e.target.checked)} />
              بث الصوت مع الشاشة (صوت اللعبة/الفيديو)
            </label>
            <div className="meter-label">مشاركة الصوت تشتغل أفضل عند بث "تبويب متصفح" أو الشاشة كاملة في Chrome.</div>
            <button className="start-stream" onClick={startScreen}><Monitor size={18} /> ابدأ البث الآن</button>
            <div className="settings-note">💡 بعد الضغط، المتصفح بيسألك تختار: الشاشة كاملة، أو نافذة برنامج، أو تبويب.</div>
          </div>
        </div>
      )}

      {/* مشاهدة البث ملء الشاشة مع تكبير/تصغير */}
      {fullscreen && screenRef && (
        <div className="fs-overlay">
          <div className="fs-top">
            <span className="screen-label">🔴 بث: {screenName}</span>
            <div className="fs-zoom">
              <button className="fs-zbtn" onClick={zoomOut} title="تصغير"><Minus size={18} /></button>
              <span className="fs-zval">{Math.round(zoom * 100)}%</span>
              <button className="fs-zbtn" onClick={zoomIn} title="تكبير"><Plus size={18} /></button>
              <button className="fs-zbtn" onClick={resetZoom} title="إرجاع الحجم">إرجاع</button>
            </div>
            <button className="fs-close" onClick={closeFullscreen}><X size={22} /> خروج</button>
          </div>
          <div
            className="fs-stage"
            onWheel={onWheel}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onDoubleClick={resetZoom}
            style={{ cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default" }}
          >
            <div className="fs-zoomwrap" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <VideoTrack trackRef={screenRef} className="fs-video" />
            </div>
          </div>
          <div className="fs-hint">عجلة الماوس أو + / − للتكبير · اسحب للتحريك · دبل-كليك للإرجاع</div>
        </div>
      )}
    </div>
  );
}

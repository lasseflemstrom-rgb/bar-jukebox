import { useState, useEffect, useRef } from "react";

const ADMIN_PIN = "1234";

async function adminGet(type) {
  const res = await fetch(`/api/admin?type=${type}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function adminPost(body) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

const msToMin = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function Admin() {
  const [pin, setPin] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [pinError, setPinError] = useState(false);

  const [queue, setQueue] = useState([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [log, setLog] = useState([]);

  const lastSongId = useRef(null);

  const addLog = (msg) => {
    setLog(prev => [`${new Date().toLocaleTimeString()} — ${msg}`, ...prev].slice(0, 20));
  };

  useEffect(() => {
    if (!loggedIn) return;

    const poll = async () => {
      try {
        const { playing, queue: spotifyQueue, queueOpen: isOpen } = await adminGet("status");
        if (playing?.item) {
          setNowPlaying(playing.item);
          setIsPlaying(playing.is_playing);
          setProgressMs(playing.progress_ms || 0);
          if (playing.item.id !== lastSongId.current) {
            lastSongId.current = playing.item.id;
            addLog(`Spelar nu: ${playing.item.name}`);
          }
        }
        setQueue(spotifyQueue);
        setQueueOpen(isOpen);
      } catch {}
    };

    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [loggedIn]);

  useEffect(() => {
    if (!nowPlaying) return;
    const id = setInterval(() => {
      setProgressMs(p => Math.min(p + 1000, nowPlaying.duration_ms));
    }, 1000);
    return () => clearInterval(id);
  }, [nowPlaying?.id]);

  const handleLogin = () => {
    if (pin === ADMIN_PIN) {
      setLoggedIn(true);
    } else {
      setPinError(true);
      setTimeout(() => setPinError(false), 2000);
    }
  };

  const handlePlay = () => adminPost({ action: "play" }).then(() => setIsPlaying(true));
  const handlePause = () => adminPost({ action: "pause" }).then(() => setIsPlaying(false));
  const handleSkip = () => {
    adminPost({ action: "skip" });
    addLog("⏭ Hoppade över låt");
  };
  const handleOpenQueue = () => {
    adminPost({ action: "openQueue" });
    setQueueOpen(true);
    addLog("🟢 Kön öppnad");
  };
  const handleCloseQueue = () => {
    if (confirm("Stäng kön? Gäster kan inte längre köpa låtar.")) {
      adminPost({ action: "closeQueue" });
      setQueueOpen(false);
      addLog("🔒 Kön stängd");
    }
  };

  const progressPct = nowPlaying ? (progressMs / nowPlaying.duration_ms) * 100 : 0;
  const remaining = nowPlaying ? Math.max(0, nowPlaying.duration_ms - progressMs) : 0;

  if (!loggedIn) {
    return (
      <div style={s.loginWrap}>
        <div style={s.loginBox}>
          <div style={s.loginTitle}>🎵 ADMIN</div>
          <div style={s.loginSub}>Musikmaskinen</div>
          <input
            style={{ ...s.pinInput, borderColor: pinError ? "#ef4444" : "#e8d5a3" }}
            type="password"
            placeholder="PIN-kod"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
          {pinError && <div style={{ color: "#ef4444", fontSize: 13 }}>Fel PIN</div>}
          <button style={s.loginBtn} onClick={handleLogin}>Logga in</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.app}>
      <header style={s.header}>
        <div style={s.headerTitle}>🎵 MUSIKMASKINEN — ADMIN</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {queueOpen ? (
            <button style={s.btnStop} onClick={handleCloseQueue}>🔒 Stäng kön</button>
          ) : (
            <button style={s.btnStart} onClick={handleOpenQueue}>🟢 Öppna kön</button>
          )}
          <div style={{ color: queueOpen ? "#86efac" : "#fca5a5", fontSize: 13, fontWeight: 700 }}>
            {queueOpen ? "🟢 KÖN ÖPPEN" : "🔒 KÖN STÄNGD"}
          </div>
        </div>
      </header>

      <div style={s.grid}>

        {/* Spelar nu */}
        <div style={s.card}>
          <div style={s.cardTitle}>SPELAR NU</div>
          {nowPlaying ? (
            <>
              <div style={s.nowPlayingRow}>
                <img src={nowPlaying.album?.images?.[1]?.url} style={s.albumArt} alt="" />
                <div>
                  <div style={s.trackName}>{nowPlaying.name}</div>
                  <div style={s.artistName}>{nowPlaying.artists?.map(a => a.name).join(", ")}</div>
                  <div style={s.timeInfo}>
                    {msToMin(progressMs)} / {msToMin(nowPlaying.duration_ms)}
                    <span style={{ marginLeft: 12, color: remaining < 15000 ? "#ef4444" : "#888" }}>
                      ({msToMin(remaining)} kvar)
                    </span>
                  </div>
                </div>
              </div>
              <div style={s.progressBar}>
                <div style={{ ...s.progressFill, width: progressPct + "%" }} />
              </div>
              <div style={s.controls}>
                {isPlaying ? (
                  <button style={s.btnControl} onClick={handlePause}>⏸ Pausa</button>
                ) : (
                  <button style={s.btnControl} onClick={handlePlay}>▶ Spela</button>
                )}
                <button style={s.btnControl} onClick={handleSkip}>⏭ Hoppa över</button>
              </div>
            </>
          ) : (
            <div style={s.empty}>Inget spelas just nu</div>
          )}
        </div>

        {/* Spotifys kö */}
        <div style={s.card}>
          <div style={s.cardTitle}>KÖ ({queue.length} låtar)</div>
          {queue.length === 0 ? (
            <div style={s.empty}>Kön är tom</div>
          ) : (
            queue.map((track, i) => (
              <div key={track.id} style={s.queueRow}>
                <div style={s.queueNum}>{i + 1}</div>
                <img src={track.album?.images?.[2]?.url} style={s.queueArt} alt="" />
                <div style={s.queueInfo}>
                  <div style={s.queueName}>{track.name}</div>
                  <div style={s.queueArtist}>{track.artists?.map(a => a.name).join(", ")}</div>
                </div>
                <div style={s.queueDuration}>{msToMin(track.duration_ms)}</div>
              </div>
            ))
          )}
        </div>

        {/* Logg */}
        <div style={s.card}>
          <div style={s.cardTitle}>AKTIVITETSLOGG</div>
          {log.length === 0 ? (
            <div style={s.empty}>Ingen aktivitet än</div>
          ) : (
            log.map((entry, i) => (
              <div key={i} style={s.logEntry}>{entry}</div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}

const cream = "#f5e6c8";
const red = "#c41e1e";
const darkRed = "#7a0000";
const chrome = "#e8d5a3";

const s = {
  loginWrap: { minHeight: "100vh", background: darkRed, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Lato', sans-serif" },
  loginBox: { background: cream, borderRadius: 12, padding: "40px 32px", textAlign: "center", width: 300, display: "flex", flexDirection: "column", gap: 12, border: `3px solid ${chrome}` },
  loginTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: red, letterSpacing: 4 },
  loginSub: { fontSize: 13, color: "#888", marginBottom: 8 },
  pinInput: { padding: "10px 16px", border: "2px solid", borderRadius: 8, fontSize: 18, textAlign: "center", fontFamily: "'Lato', sans-serif", outline: "none", letterSpacing: 8 },
  loginBtn: { background: red, color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 15, fontWeight: 700, fontFamily: "'Lato', sans-serif", cursor: "pointer" },
  app: { minHeight: "100vh", background: "#1a1a1a", color: "#f0f0f0", fontFamily: "'Lato', sans-serif", paddingBottom: 60 },
  header: { background: darkRed, borderBottom: `3px solid ${chrome}`, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: cream, letterSpacing: 3 },
  btnStart: { background: "#22c55e", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Lato', sans-serif" },
  btnStop: { background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Lato', sans-serif" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 16, maxWidth: 900, margin: "0 auto" },
  card: { background: "#2a2a2a", borderRadius: 12, padding: 20, border: "1px solid #444" },
  cardTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: chrome, letterSpacing: 3, marginBottom: 16 },
  empty: { color: "#666", fontStyle: "italic", fontSize: 14 },
  nowPlayingRow: { display: "flex", gap: 12, marginBottom: 12, alignItems: "center" },
  albumArt: { width: 64, height: 64, borderRadius: 6, flexShrink: 0 },
  trackName: { fontSize: 16, fontWeight: 700, color: "#fff" },
  artistName: { fontSize: 13, color: "#aaa", marginTop: 2 },
  timeInfo: { fontSize: 12, color: "#888", marginTop: 4 },
  progressBar: { height: 4, background: "#444", borderRadius: 2, overflow: "hidden", marginBottom: 12 },
  progressFill: { height: "100%", background: "#ff6b35", borderRadius: 2, transition: "width 1s linear" },
  controls: { display: "flex", gap: 8 },
  btnControl: { background: "#444", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Lato', sans-serif" },
  queueRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #333" },
  queueNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: red, width: 24, textAlign: "center" },
  queueArt: { width: 36, height: 36, borderRadius: 4, flexShrink: 0 },
  queueInfo: { flex: 1, minWidth: 0 },
  queueName: { fontSize: 14, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  queueArtist: { fontSize: 12, color: "#aaa" },
  queueDuration: { fontSize: 12, color: "#666", flexShrink: 0 },
  logEntry: { fontSize: 12, color: "#888", padding: "4px 0", borderBottom: "1px solid #333" },
};
import { useState, useEffect, useRef } from "react";

const ADMIN_PIN = "1234";

async function adminGet(type, params = "") {
  const res = await fetch(`/api/admin?type=${type}${params}`);
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
  const [activeTab, setActiveTab] = useState("live"); // "live" | "playlist"

  // Live-fliken
  const [queue, setQueue] = useState([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [log, setLog] = useState([]);
  const lastSongId = useRef(null);

  // Spellistfliken
  const [playlist, setPlaylist] = useState([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [playlistMsg, setPlaylistMsg] = useState(null);

  const addLog = (msg) => {
    setLog(prev => [`${new Date().toLocaleTimeString()} — ${msg}`, ...prev].slice(0, 20));
  };

  const showMsg = (msg, type = "success") => {
    setPlaylistMsg({ msg, type });
    setTimeout(() => setPlaylistMsg(null), 3000);
  };

  // Poll live-data
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
        setQueue(spotifyQueue.slice(0, 5));
        setQueueOpen(isOpen);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [loggedIn]);

  // Smooth progress
  useEffect(() => {
    if (!nowPlaying) return;
    const id = setInterval(() => {
      setProgressMs(p => Math.min(p + 1000, nowPlaying.duration_ms));
    }, 1000);
    return () => clearInterval(id);
  }, [nowPlaying?.id]);

  // Ladda spellista när fliken öppnas
  useEffect(() => {
    if (activeTab !== "playlist" || playlist.length > 0) return;
    setPlaylistLoading(true);
    adminGet("playlist")
      .then(data => { setPlaylist(data); setPlaylistLoading(false); })
      .catch(() => setPlaylistLoading(false));
  }, [activeTab]);

  // Sök med debounce
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await adminGet("search", `&q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(results);
      } catch {}
      setSearchLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
  const handleSkip = () => { adminPost({ action: "skip" }); addLog("⏭ Hoppade över låt"); };
  const handleOpenQueue = () => { adminPost({ action: "openQueue" }); setQueueOpen(true); addLog("🟢 Kön öppnad"); };
  const handleCloseQueue = () => {
    if (confirm("Stäng kön? Gäster kan inte längre köpa låtar.")) {
      adminPost({ action: "closeQueue" }); setQueueOpen(false); addLog("🔒 Kön stängd");
    }
  };

  const handleRemoveFromPlaylist = async (track) => {
    if (!confirm(`Ta bort "${track.name}" från spellistan?`)) return;
    try {
      await adminPost({ action: "removeFromPlaylist", uri: track.uri });
      setPlaylist(prev => prev.filter(t => t.id !== track.id));
      showMsg(`"${track.name}" borttagen`);
      addLog(`🗑 Tog bort från spellistan: ${track.name}`);
    } catch {
      showMsg("Kunde inte ta bort låten", "error");
    }
  };

  const handleAddToPlaylist = async (track) => {
    if (playlist.some(t => t.id === track.id)) {
      showMsg("Låten finns redan i spellistan", "error");
      return;
    }
    try {
      await adminPost({ action: "addToPlaylist", uri: track.uri });
      setPlaylist(prev => [...prev, track].sort((a, b) => a.name.localeCompare(b.name, "sv")));
      showMsg(`"${track.name}" tillagd i spellistan`);
      addLog(`➕ Lade till i spellistan: ${track.name}`);
      setSearchQuery("");
      setSearchResults([]);
    } catch {
      showMsg("Kunde inte lägga till låten", "error");
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

      {/* Flikar */}
      <div style={s.tabs}>
        <button style={{ ...s.tab, ...(activeTab === "live" ? s.tabActive : {}) }} onClick={() => setActiveTab("live")}>
          🎵 Live
        </button>
        <button style={{ ...s.tab, ...(activeTab === "playlist" ? s.tabActive : {}) }} onClick={() => setActiveTab("playlist")}>
          📋 Hantera spellista
        </button>
      </div>

      {/* LIVE-FLIKEN */}
      {activeTab === "live" && (
        <div style={s.grid}>
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
      )}

      {/* SPELLISTFLIKEN */}
      {activeTab === "playlist" && (
        <div style={s.playlistWrap}>
          {playlistMsg && (
            <div style={{ ...s.msg, background: playlistMsg.type === "error" ? "#7f1d1d" : "#14532d" }}>
              {playlistMsg.msg}
            </div>
          )}

          {/* Sök och lägg till */}
          <div style={s.card}>
            <div style={s.cardTitle}>LÄGG TILL LÅT</div>
            <input
              style={s.searchInput}
              placeholder="Sök artist eller låt..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchLoading && <div style={s.empty}>Söker...</div>}
            {searchResults.map(track => (
              <div key={track.id} style={s.resultRow}>
                <img src={track.album?.images?.[2]?.url} style={s.queueArt} alt="" />
                <div style={s.queueInfo}>
                  <div style={s.queueName}>{track.name}</div>
                  <div style={s.queueArtist}>{track.artists?.map(a => a.name).join(", ")}</div>
                </div>
                <div style={s.queueDuration}>{msToMin(track.duration_ms)}</div>
                <button
                  style={playlist.some(t => t.id === track.id) ? s.btnAdded : s.btnAdd}
                  onClick={() => handleAddToPlaylist(track)}
                  disabled={playlist.some(t => t.id === track.id)}
                >
                  {playlist.some(t => t.id === track.id) ? "✓" : "➕"}
                </button>
              </div>
            ))}
          </div>

          {/* Nuvarande spellista */}
          <div style={s.card}>
            <div style={s.cardTitle}>SPELLISTA ({playlist.length} låtar)</div>
            {playlistLoading ? (
              <div style={s.empty}>Laddar...</div>
            ) : playlist.length === 0 ? (
              <div style={s.empty}>Inga låtar i spellistan</div>
            ) : (
              playlist.map(track => (
                <div key={track.id} style={s.resultRow}>
                  <img src={track.album?.images?.[2]?.url} style={s.queueArt} alt="" />
                  <div style={s.queueInfo}>
                    <div style={s.queueName}>{track.name}</div>
                    <div style={s.queueArtist}>{track.artists?.map(a => a.name).join(", ")}</div>
                  </div>
                  <div style={s.queueDuration}>{msToMin(track.duration_ms)}</div>
                  <button style={s.btnRemove} onClick={() => handleRemoveFromPlaylist(track)}>🗑</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
  tabs: { display: "flex", borderBottom: "2px solid #333", background: "#222" },
  tab: { padding: "12px 24px", background: "none", border: "none", color: "#888", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Lato', sans-serif", letterSpacing: 1 },
  tabActive: { color: cream, borderBottom: `3px solid ${red}` },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 16, maxWidth: 900, margin: "0 auto" },
  playlistWrap: { display: "flex", flexDirection: "column", gap: 16, padding: 16, maxWidth: 700, margin: "0 auto" },
  card: { background: "#2a2a2a", borderRadius: 12, padding: 20, border: "1px solid #444" },
  cardTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: chrome, letterSpacing: 3, marginBottom: 16 },
  empty: { color: "#666", fontStyle: "italic", fontSize: 14 },
  msg: { padding: "12px 16px", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700 },
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
  resultRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #333" },
  searchInput: { width: "100%", padding: "10px 14px", background: "#333", border: "1px solid #555", borderRadius: 8, color: "#fff", fontSize: 14, fontFamily: "'Lato', sans-serif", outline: "none", marginBottom: 12, boxSizing: "border-box" },
  btnAdd: { background: "#22c55e30", color: "#22c55e", border: "1px solid #22c55e60", borderRadius: 6, padding: "4px 10px", fontSize: 14, cursor: "pointer", flexShrink: 0 },
  btnAdded: { background: "#33333360", color: "#666", border: "1px solid #444", borderRadius: 6, padding: "4px 10px", fontSize: 14, cursor: "default", flexShrink: 0 },
  btnRemove: { background: "#ef444430", color: "#ef4444", border: "1px solid #ef444460", borderRadius: 6, padding: "4px 8px", fontSize: 14, cursor: "pointer", flexShrink: 0 },
  logEntry: { fontSize: 12, color: "#888", padding: "4px 0", borderBottom: "1px solid #333" },
};
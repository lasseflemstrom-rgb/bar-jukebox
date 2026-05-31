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

const LOGO_SRC = "/Neon_Needle_logo.png";

export default function Admin() {
  const [pin, setPin] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [activeTab, setActiveTab] = useState("live");

  const [spotifyQueue, setSpotifyQueue] = useState([]);
  const [guestQueue, setGuestQueue] = useState([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [log, setLog] = useState([]);
  const lastSongId = useRef(null);

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

  useEffect(() => {
    if (!loggedIn) return;
    const poll = async () => {
      try {
        const { playing, queue: sq, queueOpen: isOpen, guestQueue: gq } = await adminGet("status");
        if (playing?.item) {
          setNowPlaying(playing.item);
          setIsPlaying(playing.is_playing);
          setProgressMs(playing.progress_ms || 0);
          if (playing.item.id !== lastSongId.current) {
            lastSongId.current = playing.item.id;
            addLog(`Spelar nu: ${playing.item.name}`);
          }
        }
        setSpotifyQueue((sq || []).slice(0, 5));
        setGuestQueue(gq || []);
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

  useEffect(() => {
    if (activeTab !== "playlist" || playlist.length > 0) return;
    setPlaylistLoading(true);
    adminGet("playlist")
      .then(data => { setPlaylist(data); setPlaylistLoading(false); })
      .catch(() => setPlaylistLoading(false));
  }, [activeTab]);

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
      addLog(`🗑 Tog bort: ${track.name}`);
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
      showMsg(`"${track.name}" tillagd`);
      addLog(`➕ Lade till: ${track.name}`);
      setSearchQuery("");
      setSearchResults([]);
    } catch {
      showMsg("Kunde inte lägga till låten", "error");
    }
  };

  const progressPct = nowPlaying ? (progressMs / nowPlaying.duration_ms) * 100 : 0;
  const remaining = nowPlaying ? Math.max(0, nowPlaying.duration_ms - progressMs) : 0;

  // LOGIN
  if (!loggedIn) {
    return (
      <>
        <style>{globalStyles}</style>
        <div style={s.loginWrap}>
          <div style={s.loginBox}>
            <img src={LOGO_SRC} alt="Musikmaskinen" style={s.loginLogo} onError={e => e.target.style.display = "none"} />
            <div style={s.loginTitle}>ADMIN</div>
            <input
              style={{ ...s.pinInput, borderColor: pinError ? "#e81a1a" : `${chrome}40` }}
              type="password"
              placeholder="PIN-kod"
              value={pin}
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              autoFocus
            />
            {pinError && <div style={{ color: "#e81a1a", fontSize: 13 }}>Fel PIN-kod</div>}
            <button style={s.loginBtn} onClick={handleLogin}>Logga in</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{globalStyles}</style>
      <div style={s.app}>

        {/* HEADER */}
        <header style={s.header}>
          <div style={s.headerLeft}>
            <img src={LOGO_SRC} alt="Musikmaskinen" style={s.headerLogo} onError={e => e.target.style.display = "none"} />
            <div style={s.headerTitle}>ADMIN</div>
          </div>
          <div style={s.headerRight}>
            <div style={{ ...s.queueStatus, color: queueOpen ? "#4ade80" : "#f87171" }}>
              {queueOpen ? "🟢 KÖN ÖPPEN" : "🔒 KÖN STÄNGD"}
            </div>
            {queueOpen ? (
              <button style={s.btnDanger} onClick={handleCloseQueue}>Stäng kön</button>
            ) : (
              <button style={s.btnSuccess} onClick={handleOpenQueue}>Öppna kön</button>
            )}
          </div>
        </header>

        {/* FLIKAR */}
        <div style={s.tabs}>
          {["live", "playlist"].map(tab => (
            <button
              key={tab}
              style={{ ...s.tab, ...(activeTab === tab ? s.tabActive : {}) }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "live" ? "🎵 Live" : "📋 Spellista"}
            </button>
          ))}
        </div>

        {/* LIVE-FLIKEN */}
        {activeTab === "live" && (
          <div style={s.grid}>

            {/* SPELAR NU */}
            <div style={s.card}>
              <div style={s.cardTitle}>SPELAR NU</div>
              {nowPlaying ? (
                <>
                  <div style={s.nowPlayingRow}>
                    <img src={nowPlaying.album?.images?.[1]?.url} style={s.albumArt} alt="" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={s.nowTrackName}>{nowPlaying.name}</div>
                      <div style={s.nowArtistName}>{nowPlaying.artists?.map(a => a.name).join(", ")}</div>
                      <div style={s.timeInfo}>
                        {msToMin(progressMs)} / {msToMin(nowPlaying.duration_ms)}
                        <span style={{ marginLeft: 10, color: remaining < 15000 ? "#f87171" : chrome }}>
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

            {/* GÄSTBESTÄLLNINGAR */}
            <div style={s.card}>
              <div style={s.cardTitle}>GÄSTBESTÄLLNINGAR ({guestQueue.length})</div>
              {guestQueue.length === 0 ? (
                <div style={s.empty}>Inga beställningar</div>
              ) : (
                guestQueue.map((track, i) => (
                  <div key={track.id} style={s.queueRow}>
                    <div style={s.queueNum}>{i + 1}</div>
                    <div style={s.queueInfo}>
                      <div style={s.queueName}>{track.track_name}</div>
                      <div style={s.queueArtist}>{track.artist_name}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* SPELAS HÄRNÄST */}
            <div style={s.card}>
              <div style={s.cardTitle}>SPELAS HÄRNÄST ({spotifyQueue.length})</div>
              {spotifyQueue.length === 0 ? (
                <div style={s.empty}>Kön är tom</div>
              ) : (
                spotifyQueue.map((track, i) => (
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

            {/* LOGG */}
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
              <div style={{ ...s.msg, background: playlistMsg.type === "error" ? "#3d0000" : "#003d1a", borderColor: playlistMsg.type === "error" ? "#e81a1a" : "#4ade80" }}>
                {playlistMsg.msg}
              </div>
            )}

            {/* SÖK */}
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

            {/* SPELLISTA */}
            <div style={s.card}>
              <div style={s.cardTitle}>SPELLISTA ({playlist.length} låtar)</div>
              {playlistLoading ? (
                <div style={s.empty}>Laddar...</div>
              ) : playlist.length === 0 ? (
                <div style={s.empty}>Inga låtar</div>
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
    </>
  );
}

const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lato:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #0a0a0a; font-family: 'Lato', sans-serif; }
  input::placeholder { color: #555; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #111; }
  ::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
  @media (max-width: 600px) {
    .admin-grid { grid-template-columns: 1fr !important; }
  }
`;

const chrome = "#c8b470";
const amber = "#d4920a";
const cream = "#f0e8cc";
const darkBg = "#0f0d08";
const cardBg = "#161208";

const s = {
  // LOGIN
  loginWrap: {
    minHeight: "100vh",
    background: "#0a0a0a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Lato', sans-serif",
  },
  loginBox: {
    background: darkBg,
    borderRadius: 12,
    padding: "40px 32px",
    textAlign: "center",
    width: 320,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    border: `2px solid ${chrome}40`,
    boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
  },
  loginLogo: {
    height: 80,
    width: "auto",
    margin: "0 auto",
    display: "block",
  },
  loginTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 28,
    color: chrome,
    letterSpacing: 8,
  },
  pinInput: {
    padding: "12px 16px",
    border: "1px solid",
    borderRadius: 6,
    fontSize: 20,
    textAlign: "center",
    fontFamily: "'Lato', sans-serif",
    outline: "none",
    letterSpacing: 8,
    background: "#111",
    color: cream,
  },
  loginBtn: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 16,
    letterSpacing: 4,
    background: "#e81a1a",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "14px",
    cursor: "pointer",
  },

  // APP
  app: {
    minHeight: "100vh",
    background: "#0a0a0a",
    fontFamily: "'Lato', sans-serif",
    paddingBottom: 40,
  },

  // HEADER
  header: {
    background: darkBg,
    borderBottom: `2px solid ${chrome}30`,
    padding: "10px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    position: "sticky",
    top: 0,
    zIndex: 10,
    boxShadow: "0 2px 20px rgba(0,0,0,0.6)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerLogo: {
    height: 44,
    width: "auto",
    display: "block",
  },
  headerTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 24,
    color: chrome,
    letterSpacing: 6,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  queueStatus: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: 700,
  },

  // FLIKAR
  tabs: {
    display: "flex",
    borderBottom: `1px solid ${chrome}20`,
    background: "#0d0b07",
  },
  tab: {
    padding: "12px 24px",
    background: "none",
    border: "none",
    color: "#666",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Lato', sans-serif",
    letterSpacing: 0.5,
    borderBottom: "3px solid transparent",
    transition: "all 0.15s ease",
  },
  tabActive: {
    color: cream,
    borderBottom: `3px solid #e81a1a`,
  },

  // GRID
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    padding: 16,
    maxWidth: 960,
    margin: "0 auto",
    className: "admin-grid",
  },
  playlistWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: 16,
    maxWidth: 700,
    margin: "0 auto",
  },

  // KORT
  card: {
    background: cardBg,
    borderRadius: 10,
    padding: 18,
    border: `1px solid ${chrome}20`,
    boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
  },
  cardTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 14,
    color: chrome,
    letterSpacing: 3,
    marginBottom: 14,
    borderBottom: `1px solid ${chrome}15`,
    paddingBottom: 8,
  },
  empty: {
    color: "#444",
    fontStyle: "italic",
    fontSize: 13,
    padding: "8px 0",
  },
  msg: {
    padding: "12px 16px",
    borderRadius: 6,
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    border: "1px solid",
  },

  // SPELAR NU
  nowPlayingRow: {
    display: "flex",
    gap: 12,
    marginBottom: 12,
    alignItems: "center",
  },
  albumArt: {
    width: 56,
    height: 56,
    borderRadius: 4,
    flexShrink: 0,
    border: `1px solid ${chrome}20`,
  },
  nowTrackName: {
    fontSize: 15,
    fontWeight: 700,
    color: cream,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nowArtistName: {
    fontSize: 12,
    color: chrome,
    opacity: 0.7,
    marginTop: 2,
  },
  timeInfo: {
    fontSize: 11,
    color: "#666",
    marginTop: 4,
  },
  progressBar: {
    height: 3,
    background: "#222",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressFill: {
    height: "100%",
    background: "#e81a1a",
    borderRadius: 2,
    transition: "width 1s linear",
  },
  controls: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  btnControl: {
    background: "#222",
    color: cream,
    border: `1px solid ${chrome}20`,
    borderRadius: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Lato', sans-serif",
    transition: "background 0.15s",
  },

  // KÖ-RADER
  queueRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderBottom: `1px solid ${chrome}10`,
  },
  queueNum: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 20,
    color: amber,
    width: 22,
    textAlign: "center",
    flexShrink: 0,
  },
  queueArt: {
    width: 34,
    height: 34,
    borderRadius: 3,
    flexShrink: 0,
    border: `1px solid ${chrome}15`,
  },
  queueInfo: {
    flex: 1,
    minWidth: 0,
  },
  queueName: {
    fontSize: 13,
    fontWeight: 700,
    color: cream,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  queueArtist: {
    fontSize: 11,
    color: chrome,
    opacity: 0.6,
  },
  queueDuration: {
    fontSize: 11,
    color: "#555",
    flexShrink: 0,
    fontFamily: "'Bebas Neue', sans-serif",
    letterSpacing: 1,
  },

  // LOGG
  logEntry: {
    fontSize: 12,
    color: "#555",
    padding: "4px 0",
    borderBottom: `1px solid ${chrome}08`,
    fontFamily: "'Lato', sans-serif",
  },

  // SPELLISTA
  searchInput: {
    width: "100%",
    padding: "10px 14px",
    background: "#111",
    border: `1px solid ${chrome}25`,
    borderRadius: 6,
    color: cream,
    fontSize: 14,
    fontFamily: "'Lato', sans-serif",
    outline: "none",
    marginBottom: 12,
  },
  resultRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderBottom: `1px solid ${chrome}10`,
  },

  // KNAPPAR
  btnSuccess: {
    background: "#15803d",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Lato', sans-serif",
  },
  btnDanger: {
    background: "#991b1b",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Lato', sans-serif",
  },
  btnAdd: {
    background: "#15803d30",
    color: "#4ade80",
    border: "1px solid #4ade8050",
    borderRadius: 5,
    padding: "4px 10px",
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  btnAdded: {
    background: "#22222260",
    color: "#555",
    border: "1px solid #333",
    borderRadius: 5,
    padding: "4px 10px",
    fontSize: 13,
    cursor: "default",
    flexShrink: 0,
  },
  btnRemove: {
    background: "#e81a1a20",
    color: "#f87171",
    border: "1px solid #e81a1a40",
    borderRadius: 5,
    padding: "4px 8px",
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
};
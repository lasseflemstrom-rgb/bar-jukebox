

  


  
  import { useState, useEffect, useRef } from "react";

// ============================================================
// KONFIGURATION
// ============================================================
const CONFIG = {
  SPOTIFY_CLIENT_ID: "f10e6f681ca84e65a0d462981d57f269",
  SPOTIFY_REDIRECT_URI: "https://bar-jukebox.vercel.app",
  SPOTIFY_PLAYLIST_ID: "0tAMlHVXPcQGzQxeq5o8a3", // The curated bar playlist
  SWISH_NUMBER: "0731514203", // Bar's Swish number
  PRICE_PER_SONG: 10,
  TEST_MODE: true,
  MAX_QUEUE_SIZE: 5,
};

const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

async function generateCodeChallenge() {
  const codeVerifier = Array.from(crypto.getRandomValues(new Uint8Array(64)))
    .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"[b % 66])
    .join("");
  sessionStorage.setItem("pkce_verifier", codeVerifier);
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getSpotifyAuthUrl() {
  const codeChallenge = await generateCodeChallenge();
  const params = new URLSearchParams({
    client_id: CONFIG.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: CONFIG.SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CONFIG.SPOTIFY_REDIRECT_URI,
      client_id: CONFIG.SPOTIFY_CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function spotifyFetch(endpoint, token, options = {}) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function generateSwishUrl(amount, message) {
  return `swish://payment?data={"version":1,"payee":{"value":"${CONFIG.SWISH_NUMBER}","editable":false},"amount":{"value":${amount},"editable":false},"message":{"value":"${encodeURIComponent(message)}","editable":false}}`;
}

const msToMin = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

const formatWait = (ms) => {
  if (ms <= 0) return null;
  if (ms < 60000) return `~${Math.ceil(ms / 1000)}s`;
  return `~${Math.ceil(ms / 60000)} min`;
};

// Logotypen som base64 data URL — ersätt src nedan med din faktiska fil i produktion
const LOGO_SRC = "/Neon_Needle_logo.png";

// ============================================================
// HUVUDAPP
// ============================================================
export default function Jukebox() {
  const [token, setToken] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState("");
  const [nowPlaying, setNowPlaying] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [spotifyQueue, setSpotifyQueue] = useState([]);
  const [ourTrackIds, setOurTrackIds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [paymentStep, setPaymentStep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [testMode, setTestMode] = useState(CONFIG.TEST_MODE);
  const lastSongId = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      window.history.replaceState({}, "", window.location.pathname);
      exchangeCodeForToken(code).then((t) => { if (t) setToken(t); });
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const fetchAll = async () => {
      let all = [];
      let url = `/playlists/${CONFIG.SPOTIFY_PLAYLIST_ID}/items?limit=50`;
      while (url) {
        const data = await spotifyFetch(url, token);
        all = [...all, ...data.items.filter((i) => i.item).map((i) => i.item)];
        url = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
      }
      all.sort((a, b) => a.name.localeCompare(b.name, "sv"));
      setTracks(all);
      setFiltered(all);
      setLoading(false);
    };
    fetchAll().catch(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const poll = async () => {
      try {
        const playback = await spotifyFetch("/me/player/currently-playing", token);
        if (playback?.item) {
          const newSongId = playback.item.id;
          if (newSongId !== lastSongId.current) {
            lastSongId.current = newSongId;
            setProgressMs(playback.progress_ms || 0);
            setOurTrackIds((ids) => ids.filter((id) => id !== newSongId));
          } else {
            setProgressMs((prev) => {
              const drift = Math.abs(prev - (playback.progress_ms || 0));
              return drift > 3000 ? playback.progress_ms : prev;
            });
          }
          setNowPlaying(playback.item);
        }
        const queueData = await spotifyFetch("/me/player/queue", token);
        const fullQueue = queueData?.queue || [];
        setSpotifyQueue(fullQueue);
        setOurTrackIds((ourIds) => {
          const queueIds = fullQueue.map((t) => t.id);
          return ourIds.filter((id) => queueIds.includes(id));
        });
      } catch {}
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, [token]);

  useEffect(() => {
    if (!nowPlaying) return;
    const id = setInterval(() => {
      setProgressMs((p) => Math.min(p + 1000, nowPlaying.duration_ms));
    }, 1000);
    return () => clearInterval(id);
  }, [nowPlaying?.id]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(tracks); return; }
    const q = search.toLowerCase();
    setFiltered(tracks.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.artists.some((a) => a.name.toLowerCase().includes(q))
    ));
  }, [search, tracks]);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const ourQueueCount = ourTrackIds.length;
  const queueFull = ourQueueCount >= CONFIG.MAX_QUEUE_SIZE;

  const calcWaitMs = () => {
    if (ourQueueCount === 0) return 0;
    let wait = nowPlaying ? Math.max(0, nowPlaying.duration_ms - progressMs) : 0;
    ourTrackIds.forEach((id) => {
      const t = spotifyQueue.find((q) => q.id === id);
      if (t) wait += t.duration_ms;
    });
    return wait;
  };

  const addToQueue = async (track) => {
    try {
      await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(track.uri)}`, token, { method: "POST" });
      setOurTrackIds((ids) => [...ids, track.id]);
      notify(`"${track.name}" är tillagd i jukebox!`);
      setPaymentStep("done");
    } catch {
      notify("Kunde inte lägga till låten. Är Spotify igång?", "error");
    }
  };

  const handleSelectSong = (track) => {
    if (queueFull) { notify(`Kön är full! Max ${CONFIG.MAX_QUEUE_SIZE} låtar.`, "error"); return; }
    setSelected(track);
    if (testMode) { addToQueue(track); } else { setPaymentStep("confirm"); }
  };

  const handleClose = () => { setSelected(null); setPaymentStep(null); };
  const waitMs = calcWaitMs();
  const waitStr = formatWait(waitMs);

  // ============================================================
  // STARTSIDA
  // ============================================================
  if (!token) {
    return (
      <>
        <style>{globalStyles}</style>
        <div style={s.splash}>
          <div style={s.splashBubbles} />
          <div style={s.splashInner}>
            <div style={s.splashChrome}>
              {/* Logotyp */}
              <div style={s.splashLogoWrap}>
                <img
                  src={LOGO_SRC}
                  alt="Neon Needle Jukebox"
                  style={s.splashLogo}
                  onError={(e) => { e.target.style.display = "none"; }}
                />
                {/* Fallback-text om bilden inte hittas */}
                <div style={s.splashLogoFallback}>
                  <div style={s.fallbackNeon}>NEON NEEDLE</div>
                  <div style={s.fallbackSub}>✦ JUKEBOX ✦</div>
                </div>
              </div>

              <div style={s.splashDivider}>✦ VÄLJ DIN LÅT ✦</div>
              <p style={s.splashTagline}>
                {CONFIG.TEST_MODE
                  ? "🧪 Testläge — ingen betalning krävs"
                  : `Lägg till en låt för ${CONFIG.PRICE_PER_SONG} kr`}
              </p>
              <button style={s.splashBtn} onClick={async () => window.location.href = await getSpotifyAuthUrl()}>
                <SpotifyLogoWhite />
                <span>Fortsätt med Spotify</span>
              </button>
              <p style={s.splashPowered}>
                Drivs av <SpotifyWordmarkWhite />
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ============================================================
  // HUVUD-JUKEBOX
  // ============================================================
  return (
    <>
      <style>{globalStyles}</style>
      <div style={s.app}>

        <div style={s.bubbleLeft} />
        <div style={s.bubbleRight} />

        {/* Testläge-banner */}
        {testMode && (
          <div style={s.testRibbon}>
            🧪 TESTLÄGE — INGEN BETALNING
            <button style={s.testBtn} onClick={() => setTestMode(false)}>Aktivera Swish</button>
          </div>
        )}

        {/* Header med logotyp */}
        <header style={s.header}>
          <div style={s.headerInner}>

            {/* Logotyp */}
            <div style={s.headerLogoWrap}>
              <img
                src={LOGO_SRC}
                alt="Neon Needle Jukebox"
                style={s.headerLogo}
                onError={(e) => {
                  e.target.style.display = "none";
                  e.target.nextSibling.style.display = "block";
                }}
              />
              <div style={{ display: "none" }}>
                <div style={s.fallbackNeonSmall}>NEON NEEDLE</div>
                <div style={s.fallbackSubSmall}>JUKEBOX</div>
              </div>
            </div>

            {/* Spelar nu */}
            {nowPlaying ? (
              <div style={s.nowPlaying}>
                <img
                  src={nowPlaying.album?.images?.[1]?.url}
                  style={s.nowPlayingArt}
                  alt=""
                />
                <div style={s.nowPlayingText}>
                  <div style={s.nowPlayingLabel}>♪ SPELAR NU</div>
                  <div style={s.nowPlayingTitle}>{nowPlaying.name}</div>
                  <div style={s.nowPlayingArtist}>{nowPlaying.artists?.map(a => a.name).join(", ")}</div>
                  <div style={s.progressBar}>
                    <div style={{ ...s.progressFill, width: `${(progressMs / nowPlaying.duration_ms) * 100}%` }} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={s.noPlayback}>Starta Spotify för att börja</div>
            )}
          </div>
        </header>

        {/* Köstatus */}
        <div style={s.queueStrip}>
          <div style={s.queueStripInner}>
            {queueFull ? (
              <span style={{ color: "#fca5a5" }}>⛔ Kön är full — prova igen snart!</span>
            ) : ourQueueCount > 0 ? (
              <span>🎵 {ourQueueCount}/{CONFIG.MAX_QUEUE_SIZE} i kön{waitStr ? ` · Väntetid ${waitStr}` : ""}</span>
            ) : (
              <span>🎶 Kön är tom — var den första att välja!</span>
            )}
            {!testMode && <span style={s.queuePrice}>{CONFIG.PRICE_PER_SONG} kr / låt</span>}
          </div>
        </div>

        {/* Notis */}
        {notification && (
          <div style={{
            ...s.toast,
            background: notification.type === "error" ? "#7f1d1d" : "#14532d",
            borderColor: notification.type === "error" ? "#ef4444" : "#22c55e"
          }}>
            {notification.msg}
          </div>
        )}

        {/* Sökruta */}
        <div style={s.searchSection}>
          <div style={s.searchBox}>
            <span style={s.searchNote}>🎵</span>
            <input
              style={s.searchInput}
              placeholder="Sök låt eller artist..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <button style={s.clearBtn} onClick={() => setSearch("")}>✕</button>}
          </div>
        </div>

        {/* Låtlista */}
        <div style={s.trackList}>
          {loading && <div style={s.emptyMsg}>Laddar spellista...</div>}
          {!loading && filtered.length === 0 && <div style={s.emptyMsg}>Inga låtar hittades.</div>}
          {filtered.map((track, i) => (
            <div
              key={track.id}
              style={{
                ...s.trackRow,
                opacity: queueFull ? 0.5 : 1,
                cursor: queueFull ? "not-allowed" : "pointer",
                animationDelay: `${i * 0.03}s`,
              }}
              className="track-row"
              onClick={() => !queueFull && handleSelectSong(track)}
            >
              <div style={s.trackNumber}>{String(i + 1).padStart(2, "0")}</div>
              <img src={track.album?.images?.[2]?.url || track.album?.images?.[0]?.url} style={s.trackArt} alt="" />
              <div style={s.trackInfo}>
                <div style={s.trackName}>{track.name}</div>
                <div style={s.trackArtist}>{track.artists.map(a => a.name).join(", ")}</div>
              </div>
              <div style={s.trackRight}>
                <div style={s.trackDuration}>{msToMin(track.duration_ms)}</div>
                <div style={s.trackCoin}>{testMode ? "GRATIS" : `${CONFIG.PRICE_PER_SONG}kr`}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Sidfot med Spotify-logotyp */}
        <footer style={s.footer}>
          <div style={s.footerInner}>
            <span style={s.footerText}>Musik via</span>
            <SpotifyLogoWhiteSmall />
          </div>
        </footer>

        {/* ── MODALER ── */}

        {selected && paymentStep === "confirm" && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <div style={s.modalHeader}>DIN LÅTVÄLJNING</div>
              <img src={selected.album?.images?.[0]?.url} style={s.modalArt} alt="" />
              <div style={s.modalTitle}>{selected.name}</div>
              <div style={s.modalArtist}>{selected.artists.map(a => a.name).join(", ")}</div>
              <div style={s.modalDivider}>✦ ✦ ✦</div>
              <div style={s.modalPrice}>{CONFIG.PRICE_PER_SONG} kr</div>
              <div style={s.modalWait}>
                {ourQueueCount === 0 ? "⚡ Spelas härnäst!" : `⏱ Spelas om ${formatWait(calcWaitMs())}`}
              </div>
              <button style={s.modalPrimary} onClick={() => setPaymentStep("pay")}>
                Betala med Swish
              </button>
              <button style={s.modalGhost} onClick={handleClose}>Avbryt</button>
            </div>
          </div>
        )}

        {selected && paymentStep === "pay" && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <div style={s.modalHeader}>BETALA MED SWISH</div>
              <div style={s.swishBox}>
                <div style={s.swishNum}>📱 {CONFIG.SWISH_NUMBER}</div>
                <div style={s.swishAmt}>{CONFIG.PRICE_PER_SONG} kr</div>
                <div style={s.swishMsg}>{selected.name.slice(0, 30)}</div>
              </div>
              <a href={generateSwishUrl(CONFIG.PRICE_PER_SONG, selected.name)} style={s.swishBtn}>
                Öppna Swish-appen →
              </a>
              <p style={s.swishHint}>Genomför betalningen i Swish och tryck sedan nedan.</p>
              <button style={s.modalPrimary} onClick={() => addToQueue(selected)}>
                ✓ Jag har betalat — lägg till min låt
              </button>
              <button style={s.modalGhost} onClick={handleClose}>Avbryt</button>
            </div>
          </div>
        )}

        {paymentStep === "done" && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <div style={s.successIcon}>🎉</div>
              <div style={s.modalHeader}>LÅT TILLAGD!</div>
              <div style={s.modalTitle}>{selected?.name}</div>
              <div style={s.modalArtist}>{selected?.artists.map(a => a.name).join(", ")}</div>
              <div style={s.modalWait}>
                {ourQueueCount <= 1 ? "⚡ Spelas härnäst!" : waitStr ? `⏱ Spelas om ${waitStr}` : "Snart din tur!"}
              </div>
              <p style={{ color: "#92400e", fontSize: 14, margin: 0 }}>Njut av musiken!</p>
              <button style={s.modalPrimary} onClick={handleClose}>Stäng</button>
            </div>
          </div>
        )}

      </div>
    </>
  );
}

// ============================================================
// SPOTIFY SVG-KOMPONENTER (vita, enligt riktlinjer)
// ============================================================
function SpotifyLogoWhite() {
  return (
    <svg height="22" viewBox="0 0 102 31" fill="white" style={{ display: "block" }}>
      <path d="M15.5 0C6.9 0 0 6.9 0 15.5S6.9 31 15.5 31 31 24.1 31 15.5 24.1 0 15.5 0zm7.1 22.3c-.3.4-.8.6-1.3.3-3.5-2.1-7.9-2.6-13.1-1.4-.5.1-1-.2-1.1-.7-.1-.5.2-1 .7-1.1 5.7-1.3 10.5-.7 14.5 1.6.4.3.5.8.3 1.3zm1.9-4.2c-.4.5-1.1.7-1.6.3-4-2.4-10.1-3.1-14.8-1.7-.6.2-1.3-.2-1.4-.8-.2-.6.2-1.3.8-1.4 5.4-1.6 12.1-.8 16.7 1.9.5.4.7 1.1.3 1.7zm.2-4.4C20.5 11 13 10.7 8.5 12c-.7.2-1.5-.2-1.7-.9-.2-.7.2-1.5.9-1.7C13 7.9 21.2 8.2 26.4 11.2c.6.4.8 1.2.5 1.8-.4.7-1.2.9-1.8.7z"/>
      <path d="M42.6 8.5h-3.2v14h3.2V8.5zm15.5 0v8.5L50.4 8.5h-3v14h3.2v-8.7l8 8.7h2.8V8.5h-3.3zm12.5 11.3c-2.3 0-4-1.8-4-4.3s1.7-4.3 4-4.3c1.4 0 2.6.7 3.3 1.7l2.4-1.7c-1.2-1.7-3.2-2.8-5.7-2.8-4 0-7.2 3.2-7.2 7.1s3.2 7.1 7.2 7.1c2.5 0 4.5-1.1 5.7-2.8l-2.4-1.7c-.7 1-1.9 1.7-3.3 1.7zm18.2-11.3h-10v14h10v-2.8h-6.8v-3h6.4v-2.7h-6.4v-2.7h6.8V8.5zm7.5 5.7c-2-.5-2.7-.7-2.7-1.5 0-.7.6-1.1 1.7-1.1 1.1 0 2.1.5 3.1 1.4l1.9-2.1c-1.2-1.2-2.8-2-5-2-3 0-5 1.6-5 4 0 2.7 1.8 3.4 4.4 4.1 2 .5 2.7.8 2.7 1.6 0 .8-.7 1.2-1.9 1.2-1.4 0-2.7-.6-3.7-1.7l-2 2.1c1.3 1.5 3.2 2.3 5.6 2.3 3.2 0 5.2-1.6 5.2-4.1.1-2.7-1.6-3.5-4.3-4.2z"/>
    </svg>
  );
}

function SpotifyWordmarkWhite() {
  return (
    <svg height="14" viewBox="0 0 102 31" fill="white" style={{ display: "inline-block", verticalAlign: "middle", marginLeft: 4 }}>
      <path d="M15.5 0C6.9 0 0 6.9 0 15.5S6.9 31 15.5 31 31 24.1 31 15.5 24.1 0 15.5 0zm7.1 22.3c-.3.4-.8.6-1.3.3-3.5-2.1-7.9-2.6-13.1-1.4-.5.1-1-.2-1.1-.7-.1-.5.2-1 .7-1.1 5.7-1.3 10.5-.7 14.5 1.6.4.3.5.8.3 1.3zm1.9-4.2c-.4.5-1.1.7-1.6.3-4-2.4-10.1-3.1-14.8-1.7-.6.2-1.3-.2-1.4-.8-.2-.6.2-1.3.8-1.4 5.4-1.6 12.1-.8 16.7 1.9.5.4.7 1.1.3 1.7zm.2-4.4C20.5 11 13 10.7 8.5 12c-.7.2-1.5-.2-1.7-.9-.2-.7.2-1.5.9-1.7C13 7.9 21.2 8.2 26.4 11.2c.6.4.8 1.2.5 1.8-.4.7-1.2.9-1.8.7z"/>
      <path d="M42.6 8.5h-3.2v14h3.2V8.5zm15.5 0v8.5L50.4 8.5h-3v14h3.2v-8.7l8 8.7h2.8V8.5h-3.3zm12.5 11.3c-2.3 0-4-1.8-4-4.3s1.7-4.3 4-4.3c1.4 0 2.6.7 3.3 1.7l2.4-1.7c-1.2-1.7-3.2-2.8-5.7-2.8-4 0-7.2 3.2-7.2 7.1s3.2 7.1 7.2 7.1c2.5 0 4.5-1.1 5.7-2.8l-2.4-1.7c-.7 1-1.9 1.7-3.3 1.7zm18.2-11.3h-10v14h10v-2.8h-6.8v-3h6.4v-2.7h-6.4v-2.7h6.8V8.5zm7.5 5.7c-2-.5-2.7-.7-2.7-1.5 0-.7.6-1.1 1.7-1.1 1.1 0 2.1.5 3.1 1.4l1.9-2.1c-1.2-1.2-2.8-2-5-2-3 0-5 1.6-5 4 0 2.7 1.8 3.4 4.4 4.1 2 .5 2.7.8 2.7 1.6 0 .8-.7 1.2-1.9 1.2-1.4 0-2.7-.6-3.7-1.7l-2 2.1c1.3 1.5 3.2 2.3 5.6 2.3 3.2 0 5.2-1.6 5.2-4.1.1-2.7-1.6-3.5-4.3-4.2z"/>
    </svg>
  );
}

function SpotifyLogoWhiteSmall() {
  return (
    <svg height="16" viewBox="0 0 102 31" fill="white" style={{ display: "inline-block", verticalAlign: "middle", marginLeft: 6 }}>
      <path d="M15.5 0C6.9 0 0 6.9 0 15.5S6.9 31 15.5 31 31 24.1 31 15.5 24.1 0 15.5 0zm7.1 22.3c-.3.4-.8.6-1.3.3-3.5-2.1-7.9-2.6-13.1-1.4-.5.1-1-.2-1.1-.7-.1-.5.2-1 .7-1.1 5.7-1.3 10.5-.7 14.5 1.6.4.3.5.8.3 1.3zm1.9-4.2c-.4.5-1.1.7-1.6.3-4-2.4-10.1-3.1-14.8-1.7-.6.2-1.3-.2-1.4-.8-.2-.6.2-1.3.8-1.4 5.4-1.6 12.1-.8 16.7 1.9.5.4.7 1.1.3 1.7zm.2-4.4C20.5 11 13 10.7 8.5 12c-.7.2-1.5-.2-1.7-.9-.2-.7.2-1.5.9-1.7C13 7.9 21.2 8.2 26.4 11.2c.6.4.8 1.2.5 1.8-.4.7-1.2.9-1.8.7z"/>
      <path d="M42.6 8.5h-3.2v14h3.2V8.5zm15.5 0v8.5L50.4 8.5h-3v14h3.2v-8.7l8 8.7h2.8V8.5h-3.3zm12.5 11.3c-2.3 0-4-1.8-4-4.3s1.7-4.3 4-4.3c1.4 0 2.6.7 3.3 1.7l2.4-1.7c-1.2-1.7-3.2-2.8-5.7-2.8-4 0-7.2 3.2-7.2 7.1s3.2 7.1 7.2 7.1c2.5 0 4.5-1.1 5.7-2.8l-2.4-1.7c-.7 1-1.9 1.7-3.3 1.7zm18.2-11.3h-10v14h10v-2.8h-6.8v-3h6.4v-2.7h-6.4v-2.7h6.8V8.5zm7.5 5.7c-2-.5-2.7-.7-2.7-1.5 0-.7.6-1.1 1.7-1.1 1.1 0 2.1.5 3.1 1.4l1.9-2.1c-1.2-1.2-2.8-2-5-2-3 0-5 1.6-5 4 0 2.7 1.8 3.4 4.4 4.1 2 .5 2.7.8 2.7 1.6 0 .8-.7 1.2-1.9 1.2-1.4 0-2.7-.6-3.7-1.7l-2 2.1c1.3 1.5 3.2 2.3 5.6 2.3 3.2 0 5.2-1.6 5.2-4.1.1-2.7-1.6-3.5-4.3-4.2z"/>
    </svg>
  );
}

// ============================================================
// GLOBALA STILAR
// ============================================================
const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Bebas+Neue&family=Lato:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #7a0000; font-family: 'Lato', sans-serif; }
  .track-row:hover {
    background: #fef9f0 !important;
    transform: translateX(3px);
    box-shadow: -4px 0 0 #c41e1e;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes bubbleFloat {
    0%, 100% { transform: translateY(0px) scale(1); }
    50% { transform: translateY(-20px) scale(1.02); }
  }
  @keyframes neonPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.85; }
  }
`;

// ============================================================
// STILAR — Wurlitzer 1015 / 50-talsstil
// ============================================================
const cream = "#f5e6c8";
const red = "#c41e1e";
const darkRed = "#7a0000";
const chrome = "#e8d5a3";
const warmBlack = "#1a0a00";
const amber = "#ff6b35";

const s = {
  // STARTSIDA
  splash: {
    minHeight: "100vh",
    background: `radial-gradient(ellipse at top, ${darkRed} 0%, #3d0000 100%)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Lato', sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  splashBubbles: {
    position: "absolute", inset: 0,
    background: `radial-gradient(circle at 20% 50%, rgba(255,107,53,0.15) 0%, transparent 50%),
                 radial-gradient(circle at 80% 20%, rgba(196,30,30,0.2) 0%, transparent 40%)`,
    pointerEvents: "none",
  },
  splashInner: { position: "relative", zIndex: 1, padding: "0 20px", width: "100%", maxWidth: 420 },
  splashChrome: {
    background: `linear-gradient(135deg, ${darkRed} 0%, #5a0000 50%, ${darkRed} 100%)`,
    border: `3px solid ${chrome}`,
    borderRadius: 16,
    padding: "32px 32px 40px",
    textAlign: "center",
    boxShadow: `0 0 0 6px ${darkRed}, 0 0 0 8px ${chrome}40, 0 30px 80px rgba(0,0,0,0.6)`,
    animation: "fadeIn 0.6s ease",
  },
  splashLogoWrap: { marginBottom: 20, position: "relative" },
  splashLogo: {
    width: "100%",
    maxWidth: 320,
    height: "auto",
    display: "block",
    margin: "0 auto",
    filter: "drop-shadow(0 0 20px rgba(255,107,53,0.4))",
    animation: "neonPulse 3s ease-in-out infinite",
    mixBlendMode: "hard-light",
  },
  splashLogoFallback: { display: "none" },
  fallbackNeon: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 48,
    color: "#ff3b3b",
    letterSpacing: 6,
    textShadow: "0 0 20px #ff3b3b, 0 0 40px #ff3b3b80",
  },
  fallbackSub: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 16,
    color: chrome,
    letterSpacing: 10,
    opacity: 0.8,
  },
  splashDivider: { color: chrome, fontSize: 12, letterSpacing: 4, marginBottom: 12, opacity: 0.6 },
  splashTagline: { color: cream, fontSize: 14, opacity: 0.75, marginBottom: 28, lineHeight: 1.5 },
  splashBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    width: "100%", padding: "14px 24px",
    background: "#000", color: "#fff", border: "none", borderRadius: 50,
    fontSize: 15, fontFamily: "'Lato', sans-serif", fontWeight: 700,
    cursor: "pointer", letterSpacing: 0.5,
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)", marginBottom: 20,
  },
  splashPowered: {
    color: cream, fontSize: 11, opacity: 0.5,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
  },

  // APP
  app: {
    minHeight: "100vh", background: cream,
    fontFamily: "'Lato', sans-serif",
    position: "relative", overflowX: "hidden", paddingBottom: 60,
  },
  bubbleLeft: {
    position: "fixed", left: -60, top: "20%", width: 120, height: 300,
    background: `linear-gradient(180deg, ${red}30, ${amber}20, ${red}30)`,
    borderRadius: "0 60px 60px 0", pointerEvents: "none",
    animation: "bubbleFloat 4s ease-in-out infinite", zIndex: 0,
  },
  bubbleRight: {
    position: "fixed", right: -60, top: "40%", width: 120, height: 250,
    background: `linear-gradient(180deg, ${amber}20, ${red}30, ${amber}20)`,
    borderRadius: "60px 0 0 60px", pointerEvents: "none",
    animation: "bubbleFloat 5s ease-in-out infinite reverse", zIndex: 0,
  },
  testRibbon: {
    background: "#78350f", color: "#fef3c7", fontSize: 11, fontWeight: 700,
    letterSpacing: 2, padding: "5px 16px",
    display: "flex", justifyContent: "center", alignItems: "center", gap: 12,
    position: "relative", zIndex: 10,
  },
  testBtn: {
    background: "#fef3c7", color: "#78350f", border: "none",
    borderRadius: 10, padding: "2px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer",
  },

  // HEADER
  header: {
    background: `linear-gradient(180deg, ${darkRed} 0%, ${red} 100%)`,
    borderBottom: `4px solid ${chrome}`,
    position: "sticky", top: 0, zIndex: 10,
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  },
  headerInner: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 16px", gap: 12,
  },
  headerLogoWrap: { flexShrink: 0 },
  headerLogo: {
    height: 80, width: "auto", display: "block",
    filter: "drop-shadow(0 0 8px rgba(255,107,53,0.5))",
    animation: "neonPulse 3s ease-in-out infinite",
    mixBlendMode: "lighten",
  },
  fallbackNeonSmall: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff3b3b", letterSpacing: 3,
    textShadow: "0 0 10px #ff3b3b",
  },
  fallbackSubSmall: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 9, color: chrome, letterSpacing: 5, opacity: 0.7,
  },
  nowPlaying: {
    display: "flex", alignItems: "center", gap: 10,
    background: "rgba(0,0,0,0.25)", border: `1px solid ${chrome}40`,
    borderRadius: 8, padding: "8px 12px", maxWidth: 220, flex: 1,
  },
  nowPlayingArt: { width: 40, height: 40, borderRadius: 4, flexShrink: 0, border: `1px solid ${chrome}40` },
  nowPlayingText: { minWidth: 0, flex: 1 },
  nowPlayingLabel: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 9, color: amber, letterSpacing: 2 },
  nowPlayingTitle: { fontSize: 12, fontWeight: 700, color: cream, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  nowPlayingArtist: { fontSize: 10, color: chrome, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  progressBar: { height: 2, background: "rgba(255,255,255,0.2)", borderRadius: 1, marginTop: 4, overflow: "hidden" },
  progressFill: { height: "100%", background: amber, borderRadius: 1, transition: "width 1s linear" },
  noPlayback: { fontSize: 12, color: cream, opacity: 0.5, fontStyle: "italic" },

  queueStrip: { background: warmBlack, borderBottom: `2px solid ${chrome}30`, position: "relative", zIndex: 5 },
  queueStripInner: {
    padding: "8px 16px", fontSize: 15, color: cream, opacity: 0.85,
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  queuePrice: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: amber, letterSpacing: 1 },

  toast: {
    position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)",
    zIndex: 100, padding: "12px 20px", borderRadius: 8, border: "1px solid",
    color: "#fff", fontSize: 13, fontWeight: 700,
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)", whiteSpace: "nowrap",
    animation: "fadeIn 0.3s ease",
  },

  searchSection: { padding: "16px 16px 8px", position: "relative", zIndex: 1 },
  searchBox: {
    display: "flex", alignItems: "center",
    background: "#fff", border: `2px solid ${chrome}`,
    borderRadius: 50, padding: "0 16px",
    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)",
  },
  searchNote: { fontSize: 16, marginRight: 8, opacity: 0.5 },
  searchInput: {
    flex: 1, border: "none", outline: "none", padding: "12px 0",
    fontSize: 15, fontFamily: "'Lato', sans-serif", color: warmBlack, background: "transparent",
  },
  clearBtn: { background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14, padding: "4px" },

  trackList: { padding: "8px 16px", display: "flex", flexDirection: "column", gap: 6, position: "relative", zIndex: 1 },
  emptyMsg: { textAlign: "center", color: "#999", padding: 40, fontStyle: "italic" },
  trackRow: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "10px 14px", background: "#fff",
    border: `1px solid ${chrome}80`, borderRadius: 8,
    transition: "all 0.15s ease",
    animation: "fadeIn 0.4s ease both",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  trackNumber: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: red,
    width: 24, flexShrink: 0, textAlign: "center", opacity: 0.6,
  },
  trackArt: { width: 44, height: 44, borderRadius: 4, flexShrink: 0, background: "#eee", border: `1px solid ${chrome}` },
  trackInfo: { flex: 1, minWidth: 0 },
  trackName: { fontSize: 14, fontWeight: 700, color: warmBlack, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  trackArtist: { fontSize: 12, color: "#666", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  trackRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 },
  trackDuration: { fontSize: 11, color: "#999" },
  trackCoin: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: "#fff",
    background: red, padding: "2px 8px", borderRadius: 50, letterSpacing: 0.5,
  },

  footer: {
    position: "fixed", bottom: 0, left: 0, right: 0,
    background: warmBlack, borderTop: `2px solid ${chrome}30`, padding: "8px 16px", zIndex: 10,
  },
  footerInner: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4 },
  footerText: { fontSize: 11, color: cream, opacity: 0.5 },

  // MODALER
  overlay: {
    position: "fixed", inset: 0, background: "rgba(26,10,0,0.85)",
    zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  modal: {
    background: cream, borderRadius: "16px 16px 0 0",
    border: `3px solid ${chrome}`, borderBottom: "none",
    padding: "32px 24px 40px", width: "100%", maxWidth: 480,
    textAlign: "center", display: "flex", flexDirection: "column", gap: 12,
    animation: "fadeIn 0.3s ease",
  },
  modalHeader: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: red, letterSpacing: 4 },
  modalArt: { width: 120, height: 120, borderRadius: 8, margin: "0 auto", border: `3px solid ${chrome}`, boxShadow: "0 8px 30px rgba(0,0,0,0.2)" },
  modalTitle: { fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: warmBlack, lineHeight: 1.2 },
  modalArtist: { fontSize: 14, color: "#666" },
  modalDivider: { color: red, fontSize: 12, letterSpacing: 8, opacity: 0.5 },
  modalPrice: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: red, letterSpacing: 2, lineHeight: 1 },
  modalWait: {
    fontSize: 13, color: "#666", background: "#fff",
    border: `1px solid ${chrome}`, borderRadius: 50, padding: "4px 16px",
    display: "inline-block", alignSelf: "center",
  },
  modalPrimary: {
    background: red, color: "#fff", border: "none", borderRadius: 50,
    padding: "14px 32px", fontSize: 15, fontWeight: 700,
    fontFamily: "'Lato', sans-serif", cursor: "pointer",
    letterSpacing: 0.5, boxShadow: `0 4px 20px ${red}60`,
  },
  modalGhost: {
    background: "transparent", color: "#999", border: `1px solid ${chrome}`,
    borderRadius: 50, padding: "10px 24px", fontSize: 13,
    fontFamily: "'Lato', sans-serif", cursor: "pointer",
  },
  swishBox: {
    background: "#fff", border: `2px solid ${chrome}`, borderRadius: 12,
    padding: 20, display: "flex", flexDirection: "column", gap: 4,
  },
  swishNum: { fontSize: 20, fontWeight: 700, color: warmBlack, letterSpacing: 2 },
  swishAmt: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 40, color: red, lineHeight: 1 },
  swishMsg: { fontSize: 12, color: "#999" },
  swishBtn: {
    display: "block", background: "#2fa84f", color: "#fff",
    borderRadius: 50, padding: "12px 20px", textDecoration: "none",
    fontWeight: 700, fontSize: 15,
  },
  swishHint: { fontSize: 12, color: "#999" },
  successIcon: { fontSize: 56 },
};
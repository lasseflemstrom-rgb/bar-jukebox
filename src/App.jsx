
  
import { useState, useEffect, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const CONFIG = {
  STRIPE_PUBLISHABLE_KEY: "Ypk_test_51TazxlAiBeFbGSJSUmWzOombCWLtTwS1jf19caS6IgohzkL2DAzZpt9baz4U18bGt8mftZECI7Kg7xrccjnzPqtE00Gi7ZproV", // pk_test_...
  PRICE_PER_SONG: 15,
  MAX_QUEUE_SIZE: 3,
  TEST_MODE: true,
};

const stripePromise = loadStripe(CONFIG.STRIPE_PUBLISHABLE_KEY);

async function apiGet(type) {
  const res = await fetch(`/api/queue?type=${type}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function checkTrack(trackId) {
  const res = await fetch("/api/check-track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId }),
  });
  if (!res.ok) return { blocked: false };
  return res.json();
}

async function createPaymentIntent(amount, trackName, trackUri) {
  const res = await fetch("/api/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, trackName, trackUri }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiAddToQueue(uri, trackId, trackName, artistName, durationMs) {
  const res = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uri, trackId, trackName, artistName, durationMs }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "API error");
  }
  return res.json();
}

const msToMin = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

const LOGO_SRC = "/Neon_Needle_logo.png";

function CheckoutForm({ track, onSuccess, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (stripeError) {
      setError(stripeError.message);
      setLoading(false);
    } else {
      await apiAddToQueue(track.uri, track.id, track.name, track.artists.map(a => a.name).join(", "), track.duration_ms);
      onSuccess();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={s.modalHeader}>BETALA & LÄGG TILL LÅT</div>
      <img src={track.album?.images?.[0]?.url} style={s.modalArt} alt="" />
      <div style={s.modalTitle}>{track.name}</div>
      <div style={s.modalArtist}>{track.artists.map(a => a.name).join(", ")}</div>
      <div style={s.modalPrice}>{CONFIG.PRICE_PER_SONG} kr</div>
      <div style={{ background: "#fff", padding: 16, borderRadius: 8, border: `1px solid ${chrome}` }}>
        <PaymentElement />
      </div>
      {error && <div style={{ color: red, fontSize: 13 }}>{error}</div>}
      <button style={{ ...s.modalPrimary, opacity: loading ? 0.7 : 1 }} onClick={handleSubmit} disabled={loading}>
        {loading ? "Behandlar..." : `Betala ${CONFIG.PRICE_PER_SONG} kr`}
      </button>
      <button style={s.modalGhost} onClick={onCancel}>Avbryt</button>
    </div>
  );
}

export default function Jukebox() {
  const [tracks, setTracks] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState("");
  const [nowPlaying, setNowPlaying] = useState(null);
  const [progressMs, setProgressMs] = useState(0);
  const [queueOpen, setQueueOpen] = useState(true);
  const [selected, setSelected] = useState(null);
  const [paymentStep, setPaymentStep] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);
  const [testMode, setTestMode] = useState(CONFIG.TEST_MODE);
  const [backendError, setBackendError] = useState(null);
  const [guestQueue, setGuestQueue] = useState([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const lastSongId = useRef(null);

  const guestQueueCount = guestQueue.length;
  const queueFull = guestQueueCount >= CONFIG.MAX_QUEUE_SIZE;

  useEffect(() => {
    apiGet("playlist")
      .then((data) => { setTracks(data); setFiltered(data); setLoading(false); })
      .catch((err) => { setBackendError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const { playing, recentlyPlayed: rp, queueOpen: isOpen, guestQueue: gq } = await apiGet("status");
        if (playing?.item) {
          const newSongId = playing.item.id;
          if (newSongId !== lastSongId.current) {
            lastSongId.current = newSongId;
            setProgressMs(playing.progress_ms || 0);
          } else {
            setProgressMs((prev) => {
              const drift = Math.abs(prev - (playing.progress_ms || 0));
              return drift > 3000 ? playing.progress_ms : prev;
            });
          }
          setNowPlaying(playing.item);
        }
        setQueueOpen(isOpen);
        setRecentlyPlayed(rp || []);
        setGuestQueue(gq || []);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

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

  const handleSelectSong = async (track) => {
    if (!queueOpen) { notify("Kön är stängd för ikväll.", "error"); return; }
    if (queueFull) { setSelected(track); setPaymentStep("full"); return; }

    const artistName = track.artists.map(a => a.name).join(", ");

    if (recentlyPlayed.includes(track.id)) {
      setSelected(track);
      setPaymentStep("recentlyPlayed");
      return;
    }

    if (guestQueue.some(t => t.track_id === track.id)) {
      setSelected(track);
      setPaymentStep("recentlyPlayed");
      return;
    }

    setSelected(track);
    if (testMode) {
      try {
        await apiAddToQueue(track.uri, track.id, track.name, artistName, track.duration_ms);
        setGuestQueue(q => [...q, { track_id: track.id, track_name: track.name, artist_name: artistName }]);
        notify(`"${track.name}" är tillagd i jukebox!`);
        setPaymentStep("done");
      } catch (err) {
        if (err.message === "Kön är full") {
          setPaymentStep("full");
        } else {
          notify("Kunde inte lägga till låten. Är Spotify igång?", "error");
        }
      }
    } else {
      try {
        const { clientSecret: secret } = await createPaymentIntent(CONFIG.PRICE_PER_SONG, track.name, track.uri);
        setClientSecret(secret);
        setPaymentStep("pay");
      } catch {
        notify("Betalning kunde inte startas. Försök igen.", "error");
      }
    }
  };

  const handlePaymentSuccess = () => {
    notify(`"${selected.name}" är tillagd i jukebox!`);
    setPaymentStep("done");
    setClientSecret(null);
  };

  const handleClose = () => { setSelected(null); setPaymentStep(null); setClientSecret(null); };

  return (
    <>
      <style>{globalStyles}</style>
      <div style={s.app}>
        <div style={s.bubbleLeft} />
        <div style={s.bubbleRight} />

        {testMode && (
          <div style={s.testRibbon}>
            🧪 TESTLÄGE — INGEN BETALNING
            <button style={s.testBtn} onClick={() => setTestMode(false)}>Aktivera Betalning</button>
          </div>
        )}

        <header style={s.header}>
          <div style={s.headerInner}>
            <div style={s.headerLogoWrap}>
              <img
                src={LOGO_SRC}
                alt="Musikmaskinen Jukebox"
                style={s.headerLogo}
                onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "block"; }}
              />
              <div style={{ display: "none" }}>
                <div style={s.fallbackNeonSmall}>MUSIKMASKINEN</div>
                <div style={s.fallbackSubSmall}>JUKEBOX</div>
              </div>
            </div>
            {nowPlaying ? (
              <div style={s.nowPlaying}>
                <img src={nowPlaying.album?.images?.[1]?.url} style={s.nowPlayingArt} alt="" />
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

        {guestQueueCount > 0 && (
          <div style={s.guestQueueStrip}>
            <div style={s.guestQueueTitle}>🎶 I KÖN</div>
            {guestQueue.map((t, i) => (
              <div key={t.track_id} style={s.guestQueueRow}>
                <span style={s.guestQueueNum}>{i + 1}</span>
                <span style={s.guestQueueName}>{t.track_name}</span>
                <span style={s.guestQueueArtist}>{t.artist_name}</span>
              </div>
            ))}
          </div>
        )}

        {notification && (
          <div style={{ ...s.toast, background: notification.type === "error" ? "#7f1d1d" : "#14532d", borderColor: notification.type === "error" ? "#ef4444" : "#22c55e" }}>
            {notification.msg}
          </div>
        )}

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

        <div style={s.trackList}>
          {loading && <div style={s.emptyMsg}>Laddar spellista...</div>}
          {backendError && (
            <div style={{ ...s.emptyMsg, color: red }}>
              ⚠️ Kunde inte ladda spellistan.<br />
              <small>Ägaren behöver logga in på <a href="/api/auth">/api/auth</a></small>
            </div>
          )}
          {!loading && !backendError && filtered.length === 0 && <div style={s.emptyMsg}>Inga låtar hittades.</div>}
          {filtered.map((track, i) => (
            <div
              key={track.id}
              style={{ ...s.trackRow, opacity: queueFull ? 0.5 : 1, cursor: "pointer", animationDelay: `${i * 0.03}s` }}
              className="track-row"
              onClick={() => handleSelectSong(track)}
            >
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

        <footer style={s.footer}>
          <div style={s.footerInner}>
            <span style={s.footerText}>Musik via</span>
            <SpotifyLogoWhiteSmall />
          </div>
        </footer>

        {/* Välkomstmodal */}
        {showWelcome && (
          <div style={s.overlay}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <img
                src={LOGO_SRC}
                alt="Musikmaskinen"
                style={{ height: 80, width: "auto", margin: "0 auto", display: "block" }}
                onError={(e) => e.target.style.display = "none"}
              />
              <div style={s.modalHeader}>VÄLKOMMEN!</div>
              {!queueOpen ? (
                <p style={{ color: "#666", fontSize: 15, margin: 0, lineHeight: 1.6 }}>
                  🔒 Kön är stängd för ikväll.
                </p>
              ) : (
                <p style={{ color: "#666", fontSize: 15, margin: 0, lineHeight: 1.6 }}>
                  Välj en låt från listan och lägg till den i jukebox!
                  {!testMode && <><br /><strong style={{ color: red }}>Kostar {CONFIG.PRICE_PER_SONG} kr per låt.</strong></>}
                </p>
              )}
              <button style={s.modalPrimary} onClick={() => setShowWelcome(false)}>
                {queueOpen ? "Välj låt! 🎵" : "Se spellistan"}
              </button>
            </div>
          </div>
        )}

        {selected && paymentStep === "pay" && clientSecret && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
                <CheckoutForm track={selected} onSuccess={handlePaymentSuccess} onCancel={handleClose} />
              </Elements>
            </div>
          </div>
        )}

        {paymentStep === "recentlyPlayed" && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 56 }}>🔁</div>
              <div style={s.modalHeader}>SPELADES NYLIGEN</div>
              <div style={s.modalTitle}>{selected?.name}</div>
              <p style={{ color: "#666", fontSize: 15, margin: 0, lineHeight: 1.5 }}>
                Den här låten spelades nyss eller står redan i kön. Välj en annan låt!
              </p>
              <button style={s.modalPrimary} onClick={handleClose}>Välj annan låt</button>
            </div>
          </div>
        )}

        {paymentStep === "full" && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 56 }}>🚫</div>
              <div style={s.modalHeader}>KÖN ÄR FULL</div>
              <p style={{ color: "#666", fontSize: 15, margin: 0, lineHeight: 1.5 }}>
                Just nu är det {CONFIG.MAX_QUEUE_SIZE} låtar i kön. Vänta lite och försök igen!
              </p>
              <button style={s.modalPrimary} onClick={handleClose}>Stäng</button>
            </div>
          </div>
        )}

        {paymentStep === "done" && (
          <div style={s.overlay} onClick={handleClose}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <div style={s.modalHeader}>Din låt är tillagd!</div>
              <div style={s.modalTitle}>{selected?.name}</div>
              <div style={s.modalArtist}>{selected?.artists.map(a => a.name).join(", ")}</div>
              <p style={{ color: "#666", fontSize: 15, margin: 0, lineHeight: 1.6 }}>Den kommer att spelas strax!</p>
              <p style={{ color: "#92400e", fontSize: 14, margin: 0 }}>Njut av musiken!</p>
              <button style={s.modalPrimary} onClick={handleClose}>Stäng</button>
            </div>
          </div>
        )}
      </div>
    </>
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

const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Bebas+Neue&family=Lato:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #7a0000; font-family: 'Lato', sans-serif; overflow-x: hidden; touch-action: pan-y; }
  .track-row:hover { background: #fef9f0 !important; box-shadow: -4px 0 0 #c41e1e; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes bubbleFloat { 0%, 100% { transform: translateY(0px) scale(1); } 50% { transform: translateY(-20px) scale(1.02); } }
  @keyframes neonPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.85; } }
`;

const cream = "#f5e6c8";
const red = "#c41e1e";
const darkRed = "#7a0000";
const chrome = "#e8d5a3";
const warmBlack = "#1a0a00";
const amber = "#ff6b35";

const s = {
  app: { minHeight: "100vh", background: cream, fontFamily: "'Lato', sans-serif", position: "relative", overflowX: "hidden", paddingBottom: 60 },
  bubbleLeft: { position: "fixed", left: -90, top: "20%", width: 120, height: 300, background: `linear-gradient(180deg, ${red}30, ${amber}20, ${red}30)`, borderRadius: "0 60px 60px 0", pointerEvents: "none", animation: "bubbleFloat 4s ease-in-out infinite", zIndex: 0 },
  bubbleRight: { position: "fixed", right: -90, top: "40%", width: 120, height: 250, background: `linear-gradient(180deg, ${amber}20, ${red}30, ${amber}20)`, borderRadius: "60px 0 0 60px", pointerEvents: "none", animation: "bubbleFloat 5s ease-in-out infinite reverse", zIndex: 0 },
  testRibbon: { background: "#78350f", color: "#fef3c7", fontSize: 11, fontWeight: 700, letterSpacing: 2, padding: "5px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 12, position: "relative", zIndex: 10, overflow: "hidden", width: "100%" },
  testBtn: { background: "#fef3c7", color: "#78350f", border: "none", borderRadius: 10, padding: "2px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer" },
  header: { background: `linear-gradient(180deg, ${darkRed} 0%, ${red} 100%)`, borderBottom: `4px solid ${chrome}`, position: "sticky", top: 0, zIndex: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", overflow: "hidden", maxWidth: "100vw" },
  headerInner: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", gap: 12, overflow: "hidden" },
  headerLogoWrap: { flexShrink: 0 },
  headerLogo: { height: 72, width: "auto", display: "block", filter: "drop-shadow(0 0 8px rgba(255,107,53,0.5))", animation: "neonPulse 3s ease-in-out infinite", mixBlendMode: "lighten" },
  fallbackNeonSmall: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff3b3b", letterSpacing: 3, textShadow: "0 0 10px #ff3b3b" },
  fallbackSubSmall: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 9, color: chrome, letterSpacing: 5, opacity: 0.7 },
  nowPlaying: { display: "flex", alignItems: "center", gap: 10, background: "rgba(0,0,0,0.25)", border: `1px solid ${chrome}40`, borderRadius: 8, padding: "8px 12px", maxWidth: 220, flex: 1, overflow: "hidden" },
  nowPlayingArt: { width: 40, height: 40, borderRadius: 4, flexShrink: 0, border: `1px solid ${chrome}40` },
  nowPlayingText: { minWidth: 0, flex: 1 },
  nowPlayingLabel: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 9, color: amber, letterSpacing: 2 },
  nowPlayingTitle: { fontSize: 12, fontWeight: 700, color: cream, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  nowPlayingArtist: { fontSize: 10, color: chrome, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  progressBar: { height: 2, background: "rgba(255,255,255,0.2)", borderRadius: 1, marginTop: 4, overflow: "hidden" },
  progressFill: { height: "100%", background: amber, borderRadius: 1, transition: "width 1s linear" },
  noPlayback: { fontSize: 12, color: cream, opacity: 0.5, fontStyle: "italic" },
  guestQueueStrip: { background: "#2a0a00", borderBottom: `1px solid ${chrome}20`, padding: "10px 16px", zIndex: 4 },
  guestQueueTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, color: amber, letterSpacing: 3, marginBottom: 6 },
  guestQueueRow: { display: "flex", alignItems: "center", gap: 8, padding: "3px 0" },
  guestQueueNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: red, width: 16 },
  guestQueueName: { fontSize: 13, fontWeight: 700, color: cream, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  guestQueueArtist: { fontSize: 11, color: chrome, opacity: 0.7, whiteSpace: "nowrap" },
  toast: { position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", zIndex: 100, padding: "12px 20px", borderRadius: 8, border: "1px solid", color: "#fff", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", whiteSpace: "nowrap", animation: "fadeIn 0.3s ease" },
  searchSection: { padding: "16px 16px 8px", position: "relative", zIndex: 1 },
  searchBox: { display: "flex", alignItems: "center", background: "#fff", border: `2px solid ${chrome}`, borderRadius: 50, padding: "0 16px", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)" },
  searchNote: { fontSize: 16, marginRight: 8, opacity: 0.5 },
  searchInput: { flex: 1, border: "none", outline: "none", padding: "12px 0", fontSize: 15, fontFamily: "'Lato', sans-serif", color: warmBlack, background: "transparent" },
  clearBtn: { background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14, padding: "4px" },
  trackList: { padding: "8px 16px", display: "flex", flexDirection: "column", gap: 6, position: "relative", zIndex: 1, maxWidth: "100%", boxSizing: "border-box" },
  emptyMsg: { textAlign: "center", color: "#999", padding: 40, fontStyle: "italic" },
  trackRow: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: `1px solid ${chrome}80`, borderRadius: 8, transition: "all 0.15s ease", animation: "fadeIn 0.4s ease both", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden", maxWidth: "100%" },
  trackArt: { width: 44, height: 44, borderRadius: 4, flexShrink: 0, background: "#eee", border: `1px solid ${chrome}` },
  trackInfo: { flex: 1, minWidth: 0 },
  trackName: { fontSize: 14, fontWeight: 700, color: warmBlack, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  trackArtist: { fontSize: 12, color: "#666", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  trackRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 },
  trackDuration: { fontSize: 11, color: "#999" },
  trackCoin: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, color: "#fff", background: red, padding: "2px 8px", borderRadius: 50, letterSpacing: 0.5 },
  footer: { position: "fixed", bottom: 0, left: 0, right: 0, background: warmBlack, borderTop: `2px solid ${chrome}30`, padding: "8px 16px", zIndex: 10 },
  footerInner: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4 },
  footerText: { fontSize: 11, color: cream, opacity: 0.5 },
  overlay: { position: "fixed", inset: 0, background: "rgba(26,10,0,0.85)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" },
  modal: { background: cream, borderRadius: "16px 16px 0 0", border: `3px solid ${chrome}`, borderBottom: "none", padding: "32px 24px 40px", width: "100%", maxWidth: 480, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, animation: "fadeIn 0.3s ease" },
  modalHeader: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: red, letterSpacing: 4 },
  modalArt: { width: 120, height: 120, borderRadius: 8, margin: "0 auto", border: `3px solid ${chrome}`, boxShadow: "0 8px 30px rgba(0,0,0,0.2)" },
  modalTitle: { fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: warmBlack, lineHeight: 1.2 },
  modalArtist: { fontSize: 14, color: "#666" },
  modalPrice: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: red, letterSpacing: 2, lineHeight: 1 },
  modalPrimary: { background: red, color: "#fff", border: "none", borderRadius: 50, padding: "14px 32px", fontSize: 15, fontWeight: 700, fontFamily: "'Lato', sans-serif", cursor: "pointer", letterSpacing: 0.5, boxShadow: `0 4px 20px ${red}60` },
  modalGhost: { background: "transparent", color: "#999", border: `1px solid ${chrome}`, borderRadius: 50, padding: "10px 24px", fontSize: 13, fontFamily: "'Lato', sans-serif", cursor: "pointer" },
};
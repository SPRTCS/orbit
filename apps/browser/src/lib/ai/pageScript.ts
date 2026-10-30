export const PAGE_TEXT_LIMIT = 48_000;
export const TRANSCRIPT_LIMIT = 40_000;

export type PageContext = {
  title: string;
  url: string;
  description: string;
  text: string;
  transcript: string | null;
  truncated: boolean;
};

export const READ_PAGE_SCRIPT = `(async () => {
  const TEXT_LIMIT = ${PAGE_TEXT_LIMIT};
  const TRANSCRIPT_LIMIT = ${TRANSCRIPT_LIMIT};
  const clean = (s) => String(s || "").replace(/\\u00a0/g, " ").replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").replace(/[ \\t]{2,}/g, " ").trim();
  const meta = (name) => {
    const el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return el ? clean(el.getAttribute("content")).slice(0, 1000) : "";
  };
  const readable = () => {
    const candidates = [document.querySelector("article"), document.querySelector("main"), document.querySelector("[role=main]")].filter(Boolean);
    const root = candidates.find((el) => (el.innerText || "").length > 400) || document.body;
    if (!root) return "";
    let text = root.innerText || "";
    const noise = root.querySelectorAll("nav, footer, aside, [role=navigation], [role=contentinfo], [role=complementary], [aria-hidden=true], dialog:not([open])");
    let n = 0;
    for (const el of noise) {
      if (++n > 200) break;
      const t = el.innerText;
      if (t && t.length > 20 && t.length < text.length / 2) text = text.replace(t, "");
    }
    return clean(text);
  };
  const timestamp = (ms) => {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + sec : m + ":" + sec;
  };
  const youtube = async () => {
    if (!/(^|\\.)youtube\\.com$/.test(location.hostname) || location.pathname !== "/watch") return null;
    const id = new URLSearchParams(location.search).get("v");
    let response = null;
    try {
      const player = document.getElementById("movie_player");
      response = player && player.getPlayerResponse ? player.getPlayerResponse() : null;
    } catch (e) {}
    if (!response || (response.videoDetails && response.videoDetails.videoId !== id)) response = window.ytInitialPlayerResponse || null;
    if (response && response.videoDetails && response.videoDetails.videoId !== id) response = null;
    const details = (response && response.videoDetails) || {};
    const out = { description: clean(details.shortDescription || "").slice(0, 4000), author: details.author || "", transcript: null };
    const fromPanel = () => {
      const rows = [...document.querySelectorAll("ytd-transcript-segment-renderer")];
      if (!rows.length) return null;
      return rows.map((r) => {
        const t = r.querySelector(".segment-timestamp");
        const x = r.querySelector(".segment-text");
        return (t ? clean(t.textContent) + " " : "") + clean(x ? x.textContent : r.textContent);
      }).join("\\n");
    };
    const tracks = (response && response.captions && response.captions.playerCaptionsTracklistRenderer && response.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    const lang = (document.documentElement.lang || navigator.language || "en").slice(0, 2);
    const pick = tracks.find((t) => t.kind !== "asr" && (t.languageCode || "").startsWith(lang)) || tracks.find((t) => t.kind !== "asr" && (t.languageCode || "").startsWith("en")) || tracks.find((t) => t.kind !== "asr") || tracks.find((t) => (t.languageCode || "").startsWith(lang)) || tracks[0];
    if (pick && pick.baseUrl) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(pick.baseUrl + (pick.baseUrl.includes("fmt=") ? "" : "&fmt=json3"), { credentials: "include", signal: controller.signal });
        clearTimeout(timer);
        const body = res.ok ? await res.text() : "";
        if (body) {
          let lines = [];
          let last = -30000;
          let line = "";
          const json = JSON.parse(body);
          for (const ev of json.events || []) {
            if (!ev.segs) continue;
            const words = ev.segs.map((s) => s.utf8 || "").join("").replace(/\\n/g, " ").trim();
            if (!words) continue;
            if (ev.tStartMs - last >= 30000) {
              if (line) lines.push(line);
              line = "[" + timestamp(ev.tStartMs) + "] " + words;
              last = ev.tStartMs;
            } else line += " " + words;
          }
          if (line) lines.push(line);
          out.transcript = lines.join("\\n") || null;
        }
      } catch (e) {}
    }
    if (!out.transcript) out.transcript = fromPanel();
    return out;
  };
  const yt = await youtube().catch(() => null);
  let text = yt && yt.transcript ? "" : readable();
  const truncated = text.length > TEXT_LIMIT || !!(yt && yt.transcript && yt.transcript.length > TRANSCRIPT_LIMIT);
  text = text.slice(0, TEXT_LIMIT);
  const description = yt ? [yt.author ? "Channel: " + yt.author : "", yt.description].filter(Boolean).join("\\n\\n") : meta("description") || meta("og:description");
  post("result", JSON.stringify({
    title: document.title || "",
    url: location.href,
    description,
    text,
    transcript: yt && yt.transcript ? yt.transcript.slice(0, TRANSCRIPT_LIMIT) : null,
    truncated,
  }));
})().catch((e) => post("result", JSON.stringify({ error: String(e && e.message || e) })))`;

export function readPageContext(raw: unknown, fallback: { title: string; url: string }): PageContext | null {
  if (!raw || typeof raw !== "object" || "error" in raw) return null;
  const r = raw as Partial<Record<keyof PageContext, unknown>>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    title: s(r.title, 500) || fallback.title,
    url: s(r.url, 4000) || fallback.url,
    description: s(r.description, 5000),
    text: s(r.text, PAGE_TEXT_LIMIT),
    transcript: typeof r.transcript === "string" && r.transcript ? r.transcript.slice(0, TRANSCRIPT_LIMIT) : null,
    truncated: r.truncated === true,
  };
}

"use client";

/**
 * YouTube IFrame Player API controller (singleton).
 * One persistent player instance lives in a hidden "harbor" element so audio
 * keeps playing app-wide (background/audio mode). When the full-screen player
 * is open in video mode, the same iframe is moved into the visible slot —
 * preserving playback position exactly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YtCallbacks {
  onEnded?: () => void;
  onError?: (code: number) => void;
  onState?: (playing: boolean) => void;
}

const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

let apiPromise: Promise<any> | null = null;

export function loadYouTubeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      apiPromise = null;
      reject(new Error("Failed to load YouTube player API"));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}

class YtController {
  private player: any = null;
  private harbor: HTMLDivElement | null = null;
  private mountPoint: HTMLDivElement | null = null;
  private visibleHost: HTMLElement | null = null;
  private attached = false;
  private cbs: YtCallbacks = {};
  private pendingVideo: { id: string; start: number; req: number } | null = null;
  /**
   * Every play request carries this id. `pause()` / a newer click bumps it, so a request
   * that is still waiting for the player to boot can never fire after being superseded
   * (that used to mean the iframe started playing underneath the native deck).
   */
  private reqId = 0;
  private wantVolume: number | null = null;
  private wantRate: number | null = null;
  private wantSeek: number | null = null;
  /** True once the IFrame API fires `onReady` — until then every command is silently dropped. */
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  currentVideoId: string | null = null;

  /**
   * The YouTube player object exists the moment `new YT.Player()` returns, but calling
   * `loadVideoById` / `playVideo` before `onReady` is a **no-op** — that is exactly why
   * the very first track in a session refused to start while every later one worked.
   * Everything therefore funnels through this gate (with a timeout so a stalled iframe can
   * never hang playback; the request stays queued and fires whenever `onReady` lands).
   */
  private whenReady(timeoutMs = 12_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve) => {
        this.readyResolve = resolve;
        setTimeout(resolve, timeoutMs);
      });
    }
    return this.readyPromise;
  }

  private markReady() {
    this.ready = true;
    // Anything the UI asked for while the player was still booting is applied now,
    // so volume / speed / seek from the first song are never silently lost.
    if (this.wantVolume !== null) this.applyVolume(this.wantVolume);
    if (this.wantRate !== null) this.applyRate(this.wantRate);
    if (this.wantSeek !== null) this.applySeek(this.wantSeek);
    const resolve = this.readyResolve;
    this.readyResolve = null;
    resolve?.();
    this.flushPending();
  }

  private flushPending() {
    const v = this.pendingVideo;
    if (!v) return;
    if (v.req !== this.reqId) {
      this.pendingVideo = null; // superseded while we were booting
      return;
    }
    this.pendingVideo = null;
    this.start(v.id, v.start, v.req);
  }

  private start(videoId: string, startSeconds: number, req = this.reqId) {
    if (!this.ready || !this.player) {
      if (req === this.reqId) this.pendingVideo = { id: videoId, start: startSeconds, req };
      return;
    }
    if (req !== this.reqId) return;
    try {
      if (this.currentVideoId === videoId) {
        if (startSeconds > 0) this.player.seekTo(startSeconds, true);
        this.player.playVideo();
      } else {
        this.player.loadVideoById({ videoId, startSeconds });
        this.currentVideoId = videoId;
      }
    } catch {
      /* surfaced through onError / the caller's timeout */
    }
  }

  private ensureHarbor() {
    if (this.harbor?.isConnected) return;
    const h = document.createElement("div");
    h.id = "sdf-yt-harbor";
    h.setAttribute("aria-hidden", "true");
    h.style.cssText =
      "position:fixed;left:-9999px;bottom:0;width:480px;height:270px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden;";
    const mp = document.createElement("div");
    mp.id = "sdf-yt-mount";
    h.appendChild(mp);
    document.body.appendChild(h);
    this.harbor = h;
    this.mountPoint = mp;
  }

  /** Builds the singleton player inside the hidden harbor and wires its events. */
  private buildPlayer(YT: any, videoId?: string) {
    if (this.player && this.player.getIframe?.()?.isConnected) return;
    this.ensureHarbor();
    this.ready = false;
    this.player = new YT.Player(this.mountPoint, {
      ...(videoId ? { videoId } : {}),
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        playsinline: 1,
        modestbranding: 1,
        iv_load_policy: 3,
        disablekb: 1,
        enablejsapi: 1,
        origin: typeof window !== "undefined" ? window.location.origin : undefined,
      },
      events: {
        onReady: () => {
          const iframe: HTMLIFrameElement | undefined = this.player?.getIframe?.();
          if (iframe) {
            iframe.style.cssText = "width:100%;height:100%;border:0;border-radius:18px;display:block;";
            iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
            iframe.title = "Sidify YouTube player";
          }
          if (this.attached && this.visibleHost) this.moveIframe(this.visibleHost);
          this.markReady();
        },
        onStateChange: (e: any) => {
          const st = e?.data;
          if (st === 0) this.cbs.onEnded?.(); // ENDED
          else if (st === 1) this.cbs.onState?.(true); // PLAYING
          else if (st === 2) this.cbs.onState?.(false); // PAUSED
        },
        onError: (e: any) => this.cbs.onError?.(Number(e?.data ?? 0)),
      },
    });
  }

  async ensure(videoId: string, startSeconds = 0, req = this.reqId): Promise<boolean> {
    const YT = await loadYouTubeApi();
    if (req !== this.reqId) return false;
    if (!this.player || !this.player.getIframe?.()?.isConnected) {
      if (!YT?.Player) throw new Error("YouTube player API unavailable");
      this.pendingVideo = { id: videoId, start: startSeconds, req };
      this.buildPlayer(YT, videoId);
    }
    // Blocks until the player can accept commands (bounded wait). Anything still
    // queued is flushed by markReady(), so playback is delayed - never dropped.
    await this.whenReady();
    return true;
  }

  /**
   * Boot the API script + player ahead of the first play, so the first click in a
   * session doesn't also pay for YouTube's player start-up.
   */
  warm(videoId?: string) {
    if (typeof window === "undefined" || this.player) return;
    loadYouTubeApi()
      .then((YT) => {
        if (YT?.Player) this.buildPlayer(YT, videoId);
      })
      .catch(() => {
        /* no YouTube here - the native deck path takes over */
      });
  }

  async playVideo(videoId: string, startSeconds = 0) {
    const req = ++this.reqId;
    await this.ensure(videoId, startSeconds, req);
    if (!this.player || req !== this.reqId) return;
    this.start(videoId, startSeconds, req);
  }

  /** Drop anything queued/unstarted — used when another engine takes over. */
  cancel() {
    this.reqId++;
    this.pendingVideo = null;
  }

  /** True once the player has booted and can accept commands. */
  isReady(): boolean {
    return this.ready;
  }

  pause() {
    // Native deck taking over / user paused before boot: drop anything still queued.
    this.cancel();
    try {
      this.player?.pauseVideo?.();
    } catch {}
  }

  resume() {
    if (!this.ready) {
      const v = this.currentVideoId;
      if (v) {
        const req = ++this.reqId;
        void this.whenReady().then(() => this.start(v, 0, req));
      }
      return;
    }
    try {
      this.player?.playVideo?.();
    } catch {}
  }

  seekTo(seconds: number) {
    const sec = Math.max(0, seconds);
    this.wantSeek = sec;
    if (!this.ready) {
      void this.whenReady().then(() => {
        if (this.wantSeek === sec) this.applySeek(sec);
      });
      return;
    }
    this.applySeek(sec);
  }

  private applySeek(seconds: number) {
    this.wantSeek = null;
    try {
      this.player?.seekTo?.(seconds, true);
    } catch {}
  }

  getTime(): number {
    try {
      return Number(this.player?.getCurrentTime?.() ?? 0);
    } catch {
      return 0;
    }
  }

  getDuration(): number {
    try {
      return Number(this.player?.getDuration?.() ?? 0);
    } catch {
      return 0;
    }
  }

  isPlaying(): boolean {
    try {
      return this.player?.getPlayerState?.() === 1;
    } catch {
      return false;
    }
  }

  /** -1 unstarted · 0 ended · 1 playing · 2 paused · 3 buffering · 5 video start */
  getPlayerState(): number {
    try {
      return Number(this.player?.getPlayerState?.() ?? -1);
    } catch {
      return -1;
    }
  }

  setVolume(v01: number) {
    this.wantVolume = Math.min(1, Math.max(0, v01));
    if (!this.ready) return;
    this.applyVolume(this.wantVolume);
  }

  private applyVolume(v01: number) {
    this.wantVolume = v01;
    try {
      this.player?.setVolume?.(Math.round(v01 * 100));
      if (v01 === 0) this.player?.mute?.();
      else this.player?.unMute?.();
    } catch {}
  }

  setRate(rate: number) {
    const nearest = YT_RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a), 1);
    this.wantRate = nearest;
    if (!this.ready) return;
    this.applyRate(nearest);
  }

  private applyRate(rate: number) {
    this.wantRate = rate;
    try {
      this.player?.setPlaybackRate?.(rate);
    } catch {}
  }

  setCallbacks(cbs: YtCallbacks) {
    this.cbs = cbs;
  }

  private moveIframe(host: HTMLElement) {
    const iframe: HTMLIFrameElement | undefined = this.player?.getIframe?.();
    if (iframe && iframe.parentElement !== host) {
      host.appendChild(iframe);
    }
  }

  /** Move the iframe into a visible host (video mode). */
  attachTo(host: HTMLElement | null) {
    this.visibleHost = host;
    this.attached = true;
    if (host) {
      this.ensureHarbor();
      if (this.player?.getIframe?.()) this.moveIframe(host);
    }
  }

  /** Return iframe to hidden harbor (audio / background mode). */
  detachToHarbor() {
    this.attached = false;
    if (this.harbor && this.player?.getIframe?.()) this.moveIframe(this.harbor);
  }
}

export const ytController = new YtController();

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
  private pendingVideo: { id: string; start: number } | null = null;
  currentVideoId: string | null = null;

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

  async ensure(videoId: string, startSeconds = 0): Promise<boolean> {
    this.ensureHarbor();
    const YT = await loadYouTubeApi();
    if (this.player && this.player.getIframe?.()?.isConnected) {
      return true;
    }
    this.pendingVideo = { id: videoId, start: startSeconds };
    this.player = new YT.Player(this.mountPoint, {
      videoId,
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
    return true;
  }

  async playVideo(videoId: string, startSeconds = 0) {
    await this.ensure(videoId, startSeconds);
    if (!this.player) return;
    try {
      if (this.currentVideoId === videoId) {
        if (startSeconds > 0) this.player.seekTo(startSeconds, true);
        this.player.playVideo();
      } else {
        this.player.loadVideoById({ videoId, startSeconds });
        this.currentVideoId = videoId;
      }
    } catch {
      /* handled by onError */
    }
  }

  pause() {
    try {
      this.player?.pauseVideo?.();
    } catch {}
  }
  resume() {
    try {
      this.player?.playVideo?.();
    } catch {}
  }

  seekTo(seconds: number) {
    try {
      this.player?.seekTo?.(Math.max(0, seconds), true);
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

  setVolume(v01: number) {
    try {
      this.player?.setVolume?.(Math.round(Math.min(1, Math.max(0, v01)) * 100));
      if (v01 === 0) this.player?.mute?.();
      else this.player?.unMute?.();
    } catch {}
  }

  setRate(rate: number) {
    try {
      const nearest = YT_RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a), 1);
      this.player?.setPlaybackRate?.(nearest);
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

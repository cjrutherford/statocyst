import { Injectable } from '@angular/core';
import type { EngineCommand, EngineEvent, EngineLoadRequest } from '@statocyst/contracts';
import { bridge } from './bridge';

/**
 * Renderer-side transport. It owns exactly one active media element: `<audio>`
 * for audio episodes and `<video>` for video episodes. The main process remains
 * authoritative for the queue and controls; this service only follows load and
 * command messages. Video is a presentation surface, never a second player.
 */
@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  private readonly audio = new Audio();
  private readonly video = document.createElement('video');
  private active: HTMLMediaElement = this.audio;
  private mediaForm: 'audio' | 'video' = 'audio';
  private videoHost: HTMLElement | null = null;
  private token = 0;
  private started = false;
  private loading = false;
  private autoplayWanted = false;
  private pendingSeekMs: number | null = null;
  private lastTimeReport = 0;
  private lastHealthReport = 0;
  private endedReported = false;
  private lastErrorCode: number | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.audio.preload = 'auto';
    this.audio.volume = 0.85;
    this.video.preload = 'auto';
    this.video.volume = 0.85;
    this.video.playsInline = true;
    this.video.controls = false;
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'block';
    this.video.style.width = '100%';
    this.video.style.height = '100%';
    this.video.style.objectFit = 'contain';
    this.video.style.background = '#020813';
    this.bindElement(this.audio);
    this.bindElement(this.video);

    bridge().engine.onLoad((request) => this.load(request));
    bridge().engine.onCommand((command) => this.command(command));
  }

  /** The element the video surface should host; null when audio is active. */
  get videoElement(): HTMLVideoElement | null {
    return this.mediaForm === 'video' ? this.video : null;
  }

  /**
   * Attach the video element to a DOM host. The element is moved, never
   * cloned, so playback continues while the stage is shown or hidden.
   */
  attachVideoHost(host: HTMLElement): void {
    if (this.videoHost === host) return;
    this.detachVideoHost();
    this.videoHost = host;
    if (this.mediaForm === 'video') host.appendChild(this.video);
  }

  detachVideoHost(host?: HTMLElement): void {
    if (host && this.videoHost !== host) return;
    if (this.video.parentElement) this.video.parentElement.removeChild(this.video);
    this.videoHost = null;
  }

  private bindElement(element: HTMLMediaElement): void {
    element.addEventListener('loadedmetadata', () => {
      if (element === this.active) this.onLoadedMetadata();
    });
    element.addEventListener('durationchange', () => {
      if (element === this.active && element.duration > 0) this.reportReady();
    });
    element.addEventListener('timeupdate', () => {
      if (element === this.active) this.onTimeUpdate();
    });
    element.addEventListener('play', () => {
      if (element === this.active && !this.loading && !this.endedReported) {
        this.reportState('playing');
      }
    });
    element.addEventListener('playing', () => {
      if (element === this.active && !this.endedReported) this.reportState('playing');
    });
    element.addEventListener('pause', () => {
      if (element !== this.active || this.loading || this.endedReported || element.ended) return;
      this.reportTime(true);
      this.reportState('paused');
    });
    element.addEventListener('waiting', () => {
      if (element === this.active && !this.endedReported) this.reportState('buffering');
    });
    element.addEventListener('ended', () => {
      if (element === this.active) this.onEnded();
    });
    element.addEventListener('error', () => {
      if (element === this.active) this.onError();
    });
  }

  private load(request: EngineLoadRequest): void {
    if (request.token < this.token) return;
    this.token = request.token;
    this.loading = true;
    this.autoplayWanted = request.autoplay;
    this.endedReported = false;
    this.lastErrorCode = null;
    this.pendingSeekMs = request.startPositionMs > 0 ? request.startPositionMs : null;

    this.audio.pause();
    this.video.pause();
    this.mediaForm = request.mediaForm ?? 'audio';
    this.active = this.mediaForm === 'video' ? this.video : this.audio;

    if (this.mediaForm === 'video') {
      this.video.poster = request.posterUrl ?? '';
      if (this.videoHost) {
        if (this.video.parentElement !== this.videoHost) this.videoHost.appendChild(this.video);
      } else if (this.video.parentElement) {
        this.video.parentElement.removeChild(this.video);
      }
    } else if (this.video.parentElement) {
      this.video.parentElement.removeChild(this.video);
    }

    this.active.volume = Math.min(1, Math.max(0, request.volume));
    this.active.muted = request.muted;
    this.active.playbackRate = Math.min(3, Math.max(0.5, request.playbackRate || 1));
    this.active.src = request.url;
    this.active.load();
    if (request.autoplay) this.tryPlay();
  }

  private command(command: EngineCommand): void {
    if (command.token !== this.token) return;
    switch (command.action) {
      case 'play':
        this.autoplayWanted = true;
        this.tryPlay();
        break;
      case 'pause':
        this.autoplayWanted = false;
        this.active.pause();
        break;
      case 'seek': {
        const maximum = Number.isFinite(this.active.duration) ? this.active.duration : Infinity;
        const seconds = Math.max(0, Math.min(command.positionMs / 1000, maximum));
        if (this.active.readyState >= 1) {
          try {
            this.active.currentTime = seconds;
          } catch {
            this.pendingSeekMs = command.positionMs;
          }
        } else {
          this.pendingSeekMs = command.positionMs;
        }
        this.reportTime(true);
        break;
      }
      case 'volume':
        this.active.volume = Math.min(1, Math.max(0, command.volume));
        this.active.muted = command.muted;
        break;
      case 'rate':
        this.active.playbackRate = Math.min(3, Math.max(0.5, command.rate));
        break;
    }
  }

  private tryPlay(): void {
    const token = this.token;
    this.active
      .play()
      .then(() => {
        if (token !== this.token) return;
        this.reportState('playing');
      })
      .catch((error: DOMException) => {
        if (token !== this.token || error?.name === 'AbortError') return;
        this.autoplayWanted = false;
        this.report({
          type: 'error',
          token,
          code: error?.name === 'NotSupportedError' ? 'UNSUPPORTED_MEDIA' : 'MEDIA_UNAVAILABLE',
          message:
            error?.name === 'NotAllowedError'
              ? 'Playback was blocked by the operating system audio policy'
              : `The media engine could not start this episode (${error?.message ?? 'unknown error'})`,
        });
      });
  }

  private onLoadedMetadata(): void {
    const hadPendingSeek = this.pendingSeekMs;
    if (hadPendingSeek !== null) {
      this.pendingSeekMs = null;
      try {
        this.active.currentTime = hadPendingSeek / 1000;
      } catch {
        // A later durationchange will retry via the same pending value.
        this.pendingSeekMs = hadPendingSeek;
      }
    }
    this.loading = false;
    this.reportReady();
    this.reportTime(true);
    if (this.autoplayWanted && this.active.paused) this.tryPlay();
  }

  private onTimeUpdate(): void {
    if (this.loading || this.endedReported) return;
    const now = Date.now();
    if (now - this.lastTimeReport < 220) return;
    this.reportTime(false);
    this.reportHealth(now);
  }

  /**
   * Reports how many seconds of audio are buffered ahead of the play head.
   * The main process uses this with the measured throughput to decide whether
   * the next track should stream direct or be transcoded (ADR-013).
   */
  private reportHealth(now: number): void {
    if (now - this.lastHealthReport < 2000) return;
    const buffered = this.active.buffered;
    if (!buffered || buffered.length === 0) return;
    const position = Number.isFinite(this.active.currentTime) ? this.active.currentTime : 0;
    let ahead = 0;
    for (let index = 0; index < buffered.length; index += 1) {
      if (buffered.start(index) <= position && buffered.end(index) >= position) {
        ahead = Math.max(0, buffered.end(index) - position);
        break;
      }
    }
    this.lastHealthReport = now;
    this.report({ type: 'health', token: this.token, bufferSeconds: ahead });
  }

  private onEnded(): void {
    this.endedReported = true;
    this.reportTime(true);
    this.report({ type: 'ended', token: this.token });
  }

  private onError(): void {
    const mediaError = this.active.error;
    if (!mediaError) return;
    if (this.lastErrorCode === mediaError.code) return;
    this.lastErrorCode = mediaError.code;
    const unsupported =
      mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
      mediaError.code === MediaError.MEDIA_ERR_DECODE;
    this.loading = false;
    this.report({
      type: 'error',
      token: this.token,
      code: unsupported ? 'UNSUPPORTED_MEDIA' : 'MEDIA_UNAVAILABLE',
      message: unsupported
        ? 'This media cannot be decoded by the desktop engine'
        : 'The media is unavailable or unreadable',
    });
  }

  private reportReady(): void {
    const durationMs = Number.isFinite(this.active.duration)
      ? Math.max(0, Math.round(this.active.duration * 1000))
      : 0;
    this.report({ type: 'ready', token: this.token, durationMs });
  }

  private reportState(state: 'playing' | 'paused' | 'buffering'): void {
    this.report({ type: 'state', token: this.token, state });
  }

  private reportTime(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastTimeReport < 220) return;
    this.lastTimeReport = now;
    const positionSeconds = Number.isFinite(this.active.currentTime) ? this.active.currentTime : 0;
    const durationSeconds = Number.isFinite(this.active.duration) ? this.active.duration : 0;
    this.report({
      type: 'time',
      token: this.token,
      positionMs: Math.max(0, Math.round(positionSeconds * 1000)),
      durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
    });
  }

  private report(event: EngineEvent): void {
    bridge().engine.report(event);
  }
}

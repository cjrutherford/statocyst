import { Injectable } from '@angular/core';
import type { EngineCommand, EngineEvent, EngineLoadRequest } from '@statocyst/contracts';
import { bridge } from './bridge';

/**
 * Renderer-side transport. It owns exactly one `<audio>` element and follows
 * load/command messages from the authoritative main-process playback service.
 * All observable state is reported back as typed engine events.
 */
@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  private readonly audio = new Audio();
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

    bridge().engine.onLoad((request) => this.load(request));
    bridge().engine.onCommand((command) => this.command(command));

    this.audio.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.audio.addEventListener('durationchange', () => {
      if (this.audio.duration > 0) this.reportReady();
    });
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('play', () => {
      if (!this.loading && !this.endedReported) this.reportState('playing');
    });
    this.audio.addEventListener('playing', () => {
      if (!this.endedReported) this.reportState('playing');
    });
    this.audio.addEventListener('pause', () => {
      if (this.loading || this.endedReported || this.audio.ended) return;
      this.reportTime(true);
      this.reportState('paused');
    });
    this.audio.addEventListener('waiting', () => {
      if (!this.endedReported) this.reportState('buffering');
    });
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('error', () => this.onError());
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
    this.audio.volume = Math.min(1, Math.max(0, request.volume));
    this.audio.muted = request.muted;
    this.audio.src = request.url;
    this.audio.load();
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
        this.audio.pause();
        break;
      case 'seek': {
        const maximum = Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity;
        const seconds = Math.max(0, Math.min(command.positionMs / 1000, maximum));
        if (this.audio.readyState >= 1) {
          try {
            this.audio.currentTime = seconds;
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
        this.audio.volume = Math.min(1, Math.max(0, command.volume));
        this.audio.muted = command.muted;
        break;
    }
  }

  private tryPlay(): void {
    const token = this.token;
    this.audio
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
              : `The audio engine could not start this track (${error?.message ?? 'unknown error'})`,
        });
      });
  }

  private onLoadedMetadata(): void {
    const hadPendingSeek = this.pendingSeekMs;
    if (hadPendingSeek !== null) {
      this.pendingSeekMs = null;
      try {
        this.audio.currentTime = hadPendingSeek / 1000;
      } catch {
        // A later durationchange will retry via the same pending value.
        this.pendingSeekMs = hadPendingSeek;
      }
    }
    this.loading = false;
    this.reportReady();
    this.reportTime(true);
    if (this.autoplayWanted && this.audio.paused) this.tryPlay();
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
    const buffered = this.audio.buffered;
    if (!buffered || buffered.length === 0) return;
    const position = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
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
    const mediaError = this.audio.error;
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
        ? 'This file cannot be decoded by the desktop audio engine'
        : 'The audio file is unavailable or unreadable',
    });
  }

  private reportReady(): void {
    const durationMs = Number.isFinite(this.audio.duration)
      ? Math.max(0, Math.round(this.audio.duration * 1000))
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
    const positionSeconds = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    const durationSeconds = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
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

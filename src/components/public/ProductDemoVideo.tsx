'use client';

import { useEffect, useRef, useState } from 'react';
import { Captions, RotateCcw, Volume2 } from 'lucide-react';
import Link from 'next/link';

import styles from './product-demo-video.module.css';

const source = '/media/quoteplate-product-film';

export function ProductDemoVideo() {
  const [failed, setFailed] = useState(false);
  const [silent, setSilent] = useState(true);
  const [inViewport, setInViewport] = useState(false);
  const [subtitles, setSubtitles] = useState(false);
  const [ended, setEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const endPanelRef = useRef<HTMLElement>(null);
  const revealEndPanel = useRef(false);

  useEffect(() => {
    if (ended && revealEndPanel.current) {
      revealEndPanel.current = false;
      endPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }, [ended]);

  useEffect(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    const syncSubtitles = () => setSubtitles(Array.from(tracks).some((track) => track.mode === 'showing'));
    tracks.addEventListener('change', syncSubtitles);
    return () => tracks.removeEventListener('change', syncSubtitles);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !('IntersectionObserver' in window)) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;
    let pausedByUser = false;
    let automaticPauseEvents = 0;

    function pauseAutomatically() {
      if (video && !video.paused) {
        automaticPauseEvents += 1;
        video.pause();
      }
    }
    function syncPlayback() {
      if (!video) return;
      if (!inView || document.hidden) {
        pauseAutomatically();
      } else if (!reducedMotion.matches && !pausedByUser && !video.ended) {
        // Some browsers still decline autoplay. Keep the native play control usable.
        void video.play().catch(() => {});
      }
    }
    function onMotionChange() {
      if (reducedMotion.matches) pauseAutomatically();
      else syncPlayback();
    }
    function onPause() {
      if (automaticPauseEvents > 0) automaticPauseEvents -= 1;
      else if (!video?.ended) pausedByUser = true;
    }
    function onPlay() {
      pausedByUser = false;
      setEnded(false);
      // Also handles a pending play() completing after the user scrolls away.
      // Read current geometry: replay may just have scrolled the video into view,
      // before IntersectionObserver delivers its next entry.
      const rect = video!.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const visible = rect.width * rect.height > 0 && visibleWidth * visibleHeight / (rect.width * rect.height) >= 0.5;
      if (!visible || document.hidden) pauseAutomatically();
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      setInViewport(inView);
      syncPlayback();
    }, { threshold: [0, 0.5] });
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    document.addEventListener('visibilitychange', syncPlayback);
    reducedMotion.addEventListener('change', onMotionChange);
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
      document.removeEventListener('visibilitychange', syncPlayback);
      reducedMotion.removeEventListener('change', onMotionChange);
      video.pause();
    };
  }, []);

  return (
    <section id="watch-demo" className={`${styles.section} public-container`} aria-labelledby="demo-title">
      <header className={styles.header}>
        <div>
          <p className="public-eyebrow">The buying journey · 2:44</p>
          <h2 id="demo-title">Your first purchase, step by step.</h2>
        </div>
        <p>Follow an approved pilot owner setting up Monsoon Table, our fictional restaurant. Add restaurant details and continue with Google. Add a menu using a phone photo, an upload, typed or pasted text, or a permitted website link. Then add suppliers, request prices, compare replies, choose a supplier and check delivery.</p>
      </header>
      <div className={styles.player}>
        <video ref={videoRef} controls playsInline muted preload="none" width={3840} height={2400}
          poster={`${source}.jpg`} aria-label="QuotePlate product demonstration"
          onVolumeChange={(event) => setSilent(event.currentTarget.muted || event.currentTarget.volume === 0)}
          onEnded={(event) => {
            if (event.currentTarget.ended) {
              revealEndPanel.current = inViewport && !document.hidden;
              setEnded(true);
            }
          }}
          onSeeking={() => setEnded(false)}
          onError={() => setFailed(true)}>
          <source src={`${source}.mp4`} type="video/mp4" onError={() => setFailed(true)} />
          <track src={`${source}.vtt`} kind="captions" srcLang="en" label="English" />
          Your browser cannot play this video. <a href={`${source}.mp4`}>Download the demonstration.</a>
        </video>
        {inViewport && silent && !failed && !ended && <button className={styles.unmute} type="button" onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          video.muted = false;
          if (video.volume === 0) video.volume = 1;
          setSilent(false);
          void video.play().catch(() => {});
        }}><Volume2 aria-hidden="true" />Unmute video</button>}
      </div>
      <div className={styles.options}>
        <button type="button" className={styles.subtitles} aria-pressed={subtitles} onClick={() => {
          const tracks = videoRef.current?.textTracks;
          if (!tracks) return;
          const enabled = !subtitles;
          for (const track of Array.from(tracks)) track.mode = enabled ? 'showing' : 'disabled';
          setSubtitles(enabled);
        }}><Captions aria-hidden="true" />Subtitles {subtitles ? 'on' : 'off'}</button>
      </div>
      {ended && !failed && <section ref={endPanelRef} className={styles.endPanel} aria-labelledby="video-next-step-title">
        <div>
          <h3 id="video-next-step-title">Ready for your first purchase?</h3>
          <p>For approved pilot owners. Sign in with Google to begin.</p>
        </div>
        <div className={styles.endActions}>
          <Link className={styles.start} href="/start">Start your first purchase</Link>
          <button className={styles.replay} type="button" onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            setEnded(false);
            video.currentTime = 0;
            video.scrollIntoView({ block: 'center', behavior: 'instant' });
            video.focus({ preventScroll: true });
            void video.play().catch(() => {});
          }}><RotateCcw aria-hidden="true" />Replay video</button>
        </div>
      </section>}
      {failed && <p className={styles.error} role="alert">The video could not load. <a href={`${source}.mp4`}>Open the video directly</a> or try again later.</p>}
    </section>
  );
}

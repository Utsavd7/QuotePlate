'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';

import styles from './product-demo-video.module.css';

const source = '/media/quoteplate-product-film';

export function ProductDemoVideo() {
  const [failed, setFailed] = useState(false);
  const [silent, setSilent] = useState(true);
  const [inViewport, setInViewport] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
      if (!inView || document.hidden || reducedMotion.matches) {
        pauseAutomatically();
      } else if (!pausedByUser && !video.ended) {
        // Some browsers still decline autoplay. Keep the native play control usable.
        void video.play().catch(() => {});
      }
    }
    function onPause() {
      if (automaticPauseEvents > 0) automaticPauseEvents -= 1;
      else if (!video?.ended) pausedByUser = true;
    }
    function onPlay() {
      pausedByUser = false;
      // Also handles a pending play() completing after the user scrolls away.
      if (!inView || document.hidden) pauseAutomatically();
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      setInViewport(inView);
      syncPlayback();
    }, { threshold: [0, 0.5] });
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    document.addEventListener('visibilitychange', syncPlayback);
    reducedMotion.addEventListener('change', syncPlayback);
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
      document.removeEventListener('visibilitychange', syncPlayback);
      reducedMotion.removeEventListener('change', syncPlayback);
      video.pause();
    };
  }, []);

  return (
    <section id="watch-demo" className={`${styles.section} public-container`} aria-labelledby="demo-title">
      <header className={styles.header}>
        <div>
          <p className="public-eyebrow">The buying journey · 2:29</p>
          <h2 id="demo-title">From your kitchen to a clearer purchase.</h2>
        </div>
        <p>Follow Monsoon Table, our fictional restaurant in Pune, through menu intake, nearby supplier discovery, quotes and delivery checks. See private supplier responses and selected demand sharing, with real public map listings captured for the demo. Supplier stock and prices still need confirmation.</p>
      </header>
      <div className={styles.player}>
        <video ref={videoRef} controls playsInline muted preload="none" width={1920} height={1080}
          poster={`${source}.jpg`} aria-label="QuotePlate product demonstration"
          onVolumeChange={(event) => setSilent(event.currentTarget.muted || event.currentTarget.volume === 0)}
          onError={() => setFailed(true)}>
          <source src={`${source}.mp4`} type="video/mp4" onError={() => setFailed(true)} />
          <track src={`${source}.vtt`} kind="captions" srcLang="en" label="English" default />
          Your browser cannot play this video. <a href={`${source}.mp4`}>Download the demonstration.</a>
        </video>
        {inViewport && silent && !failed && <button className={styles.unmute} type="button" onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          video.muted = false;
          if (video.volume === 0) video.volume = 1;
          setSilent(false);
          void video.play().catch(() => {});
        }}><Volume2 aria-hidden="true" />Unmute video</button>}
      </div>
      {failed && <p className={styles.error} role="alert">The video could not load. <a href={`${source}.mp4`}>Open the video directly</a> or try again later.</p>}
    </section>
  );
}

'use client';

import { useState } from 'react';

import styles from './product-demo-video.module.css';

const source = '/media/quoteplate-product-film';

export function ProductDemoVideo() {
  const [failed, setFailed] = useState(false);

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
        <video controls playsInline preload="none" width={1920} height={1080}
          poster={`${source}.jpg`} aria-label="QuotePlate product demonstration"
          onError={() => setFailed(true)}>
          <source src={`${source}.mp4`} type="video/mp4" onError={() => setFailed(true)} />
          <track src={`${source}.vtt`} kind="captions" srcLang="en" label="English" />
          Your browser cannot play this video. <a href={`${source}.mp4`}>Download the demonstration.</a>
        </video>
      </div>
      {failed && <p className={styles.error} role="alert">The video could not load. <a href={`${source}.mp4`}>Open the video directly</a> or try again later.</p>}
    </section>
  );
}

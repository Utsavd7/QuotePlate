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
          <p className="public-eyebrow">The buying journey</p>
          <h2 id="demo-title">From your kitchen to a clearer purchase.</h2>
        </div>
        <p>Follow Monsoon Table, our fictional restaurant in Pune, from a menu photo to supplier prices, a purchasing decision and a checked delivery. This film covers the core buying flow; explore service planning, item-level receiving and credit tracking below.</p>
      </header>
      <div className={styles.player}>
        <video controls playsInline preload="none" width={2560} height={1440}
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

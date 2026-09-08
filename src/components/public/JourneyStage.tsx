'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './journey-stage.module.css';

const steps = ['Ingredients', 'Suppliers', 'Request', 'Compare prices', 'Choose supplier', 'Check delivery'];

export function JourneyStage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = root.current!;
    const panels = element.querySelectorAll<HTMLElement>('.story-scene');
    // Without JavaScript every stage remains readable in its original order.
    element.dataset.enhanced = 'true';
    panels.forEach((panel, index) => {
      panel.inert = index !== active;
      if (index !== active) panel.setAttribute('aria-hidden', 'true');
      else panel.removeAttribute('aria-hidden');
    });
    return () => {
      delete element.dataset.enhanced;
      panels.forEach((panel) => {
        panel.inert = false;
        panel.removeAttribute('aria-hidden');
      });
    };
  }, [active]);

  function choose(index: number, keyboard = false) {
    setActive(index);
    if (keyboard) root.current!.querySelectorAll<HTMLButtonElement>('nav button')[index]?.focus({ preventScroll: true });
  }

  return (
    <div ref={root} className={styles.root}>
      <div className={styles.toolbar}>
        <nav className={styles.steps} aria-label="Buying journey steps">
          {steps.map((step, index) => (
            <button key={step} type="button" aria-current={active === index ? 'step' : undefined}
              aria-controls={`journey-step-${index + 1}`} onClick={() => choose(index)}
              onKeyDown={(event) => {
                const target = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1
                  : event.key === 'ArrowRight' ? (index + 1) % steps.length
                    : event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : null;
                if (target !== null) { event.preventDefault(); choose(target, true); }
              }}>
              {step}
            </button>
          ))}
        </nav>
        <span className={styles.counter} aria-live="polite">Step {active + 1} of {steps.length}</span>
      </div>
      {children}
    </div>
  );
}

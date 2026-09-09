'use client';

import {
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import type {
  TutorialAction,
  TutorialStateDto,
} from '@/lib/tutorial/tutorial-state';

import styles from './tutorial-guide.module.css';
import { useTourAnchor } from './use-tour-anchor';
import { useTutorialProgress } from './use-tutorial-progress';

export const TUTORIAL_STEPS = [
  {
    title: 'Start with Today',
    instruction:
      'Open Today to see which purchases and deliveries need attention.',
    action: 'Open Today',
    href: '/dashboard',
  },
  {
    title: 'Check your menu',
    instruction:
      'Open Menu. Add a menu, then check the dishes and ingredients.',
    action: 'Open Menu',
    href: '/menus',
  },
  {
    title: 'Add your suppliers',
    instruction:
      'Open Suppliers. Add who you buy from and what they supply.',
    action: 'Open Suppliers',
    href: '/suppliers',
  },
  {
    title: 'Ask suppliers for prices',
    instruction:
      'Select New purchase. Choose ingredients, a delivery date and suppliers, then share the request links.',
    action: 'New purchase',
    href: '/procurement/new',
  },
  {
    title: 'Compare supplier prices',
    instruction:
      'Open Purchases. Choose a request, compare prices and delivery dates, then choose a supplier.',
    action: 'Open Purchases',
    href: '/procurement',
  },
  {
    title: 'Review your reports',
    instruction:
      'Open Reports to compare prices and review your order totals.',
    action: 'Open Reports',
    href: '/insights',
  },
] as const;

export function TutorialGuide({
  initialTutorial,
}: {
  initialTutorial?: TutorialStateDto;
}) {
  const progress = useTutorialProgress(initialTutorial);
  const { tutorial, pending, error: message } = progress;
  const [expandedOverride, setExpanded] = useState<boolean | null>(null);
  const expanded = expandedOverride ?? Boolean(tutorial && !tutorial.skippedAt && !tutorial.completedAt);
  const [keyboard, setKeyboard] = useState(true);
  const focusFrame = useRef(0);
  const interaction = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const guideId = useId();
  const descriptionId = `${guideId}-instruction`;
  const stepIndex = Math.min(tutorial?.step ?? 0, TUTORIAL_STEPS.length - 1);
  const step = TUTORIAL_STEPS[stepIndex];
  const { anchor, suspended } = useTourAnchor(step.href, expanded, panel, descriptionId);

  useEffect(() => {
    if (!expanded || !anchor || anchor.opensNavigation) return;
    const target = anchor.target;
    const followDestination = (event: MouseEvent) => {
      if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        interaction.current++;
        setExpanded(false);
      }
    };
    target.addEventListener('click', followDestination);
    return () => target.removeEventListener('click', followDestination);
  }, [expanded, anchor]);

  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  function focusAfterToggle(open: boolean) {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const target = open ? panel.current
        : anchor?.host.closest('[role="dialog"]') ? anchor.target : resumeButton.current;
      target?.focus({ preventScroll: true });
    });
  }

  function collapse() {
    interaction.current++;
    setExpanded(false);
    focusAfterToggle(false);
  }

  function apply(action: TutorialAction) {
    if (!progress.dispatch(action)) return;
    interaction.current++;
    const open = action !== 'SKIP' && action !== 'COMPLETE';
    setExpanded(open);
    if (open !== expanded) focusAfterToggle(open);
  }

  async function reconcile() {
    const revision = interaction.current;
    const saved = await progress.useSavedProgress();
    if (saved && revision === interaction.current) {
      setExpanded(null);
      focusAfterToggle(!saved.skippedAt && !saved.completedAt);
    }
  }

  if (!tutorial || suspended) return null;

  const finished = Boolean(tutorial.completedAt);
  const syncStatus = message ? 'unsaved' : pending ? 'saving' : 'saved';
  const notice = message ? (
    <div className={styles.message}>
      <p role="status">{message}</p>
      <button type="button" onClick={progress.needsReconciliation ? () => void reconcile() : progress.retry}>
        {progress.needsReconciliation ? 'Use saved progress' : 'Retry save'}
      </button>
    </div>
  ) : pending ? <p className={styles.saving} role="status">Saving progress…</p> : null;

  if (!expanded) {
    return (
      <aside className={styles.resume} aria-label="Setup guide" data-tutorial-ui data-progress-sync={syncStatus} data-motion={keyboard ? 'instant' : 'pointer'} onPointerDownCapture={() => setKeyboard(false)} onKeyDownCapture={() => setKeyboard(true)}>
        <span className={finished ? styles.resumeIconDone : styles.resumeIcon}>
          {finished ? <Check aria-hidden="true" /> : <BookOpenCheck aria-hidden="true" />}
        </span>
        <span className={styles.resumeCopy}>
          <strong>{finished ? (pending ? 'Not saved yet' : 'Setup complete') : `Step ${stepIndex + 1} of ${TUTORIAL_STEPS.length}`}</strong>
          <small>{finished ? 'Review the guide any time' : 'Continue when you are ready'}</small>
        </span>
        <button
          ref={resumeButton}
          aria-expanded={false}
          onClick={() => void apply(finished ? 'RESTART' : 'RESUME')}
          type="button"
        >
          {finished ? <RotateCcw aria-hidden="true" /> : null}
          {finished ? 'Show setup guide' : 'Continue setup'}
        </button>
        {notice}
      </aside>
    );
  }

  const placement = anchor?.placement;
  const guide = (
    <aside
      ref={panel}
      id={guideId}
      className={`${styles.guide} ${placement ? styles.anchored : ''} ${anchor?.inline ? styles.drawerFallback : ''}`}
      style={placement ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight, '--tour-arrow': `${placement.arrow}px` } as CSSProperties : undefined}
      data-side={placement?.side}
      data-tour-fallback={anchor?.inline || undefined}
      data-tutorial-ui
      data-tour-step={stepIndex + 1}
      data-progress-sync={syncStatus}
      data-motion={keyboard ? 'instant' : 'pointer'}
      onPointerDownCapture={() => setKeyboard(false)}
      onKeyDownCapture={() => setKeyboard(true)}
      aria-label="Setup guide"
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          collapse();
        }
      }}
    >
      <div className={styles.heading}>
        <span className={styles.guideIcon}><BookOpenCheck aria-hidden="true" /></span>
        <span>
          <strong>Setup guide</strong>
          <small className={styles.counter}>Step {stepIndex + 1} of {TUTORIAL_STEPS.length}</small>
        </span>
        <button className={styles.collapse} aria-label="Collapse setup guide" onClick={collapse} type="button"><X aria-hidden="true" /></button>
      </div>

      <div className={styles.progress} aria-hidden="true">
        {TUTORIAL_STEPS.map((item, index) => (
          <span
            className={index <= stepIndex ? styles.progressDone : styles.progressRest}
            key={item.href}
          />
        ))}
      </div>

      <div className={styles.body}>
        <div key={stepIndex} className={styles.instruction}>
        <h2>{step.title}</h2>
        <p id={descriptionId}>{anchor?.opensNavigation
          ? `Open navigation, then choose ${step.action.replace(/^Open /, '')}.`
          : step.instruction}</p>
        </div>
        {anchor?.opensNavigation ? (
          <button className={styles.destination} type="button" onClick={() => anchor.target.click()}>
            Show navigation <ChevronRight aria-hidden="true" />
          </button>
        ) : (
          <Link className={styles.destination} href={step.href} onClick={() => setExpanded(false)}>
            {step.action}
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
      </div>

      {notice}

      <div className={styles.actions}>
        <button
          className={styles.back}
          disabled={stepIndex === 0}
          onClick={() => void apply('BACK')}
          type="button"
        >
          <ChevronLeft aria-hidden="true" /> Back
        </button>
        <button
          className={styles.skip}
          onClick={() => void apply('SKIP')}
          type="button"
        >
          Skip for now
        </button>
        <button
          className={styles.next}
          onClick={() => void apply(stepIndex === tutorial.lastStep ? 'COMPLETE' : 'NEXT')}
          type="button"
        >
          {stepIndex === tutorial.lastStep ? 'Finish' : 'Next'}
          {stepIndex === tutorial.lastStep ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );

  if (!anchor) return guide;
  if (!placement) return createPortal(guide, anchor.host);
  return createPortal(<>
    <div className={styles.targetRing} data-tutorial-ui data-tour-highlight aria-hidden="true" style={{ left: anchor.rect.left - 5, top: anchor.rect.top - 5, width: anchor.rect.width + 10, height: anchor.rect.height + 10 }} />
    {guide}
  </>, anchor.host);
}

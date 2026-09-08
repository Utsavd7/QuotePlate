'use client';

import { useEffect, useState, type RefObject } from 'react';

import { placeTour, type TourPlacement, type TourRect } from './tour-position';

type Anchor = {
  target: HTMLElement;
  rect: TourRect;
  placement: TourPlacement | null;
  host: HTMLElement;
  opensNavigation: boolean;
  inline: boolean;
};

function visible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert], [hidden]');
}

export function findTourTarget(href: string): { target: HTMLElement; opensNavigation: boolean } | null {
  const selector = href === '/procurement/new'
    ? 'a[href="/procurement/new"]'
    : `nav[aria-label="Workspace navigation"] a[href="${href}"]`;
  const target = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .find((element) => !element.closest('[data-tutorial-ui]') && visible(element));
  if (target) return { target, opensNavigation: false };
  const opener = document.querySelector<HTMLElement>('button[aria-label="Open navigation"]');
  return opener && visible(opener) ? { target: opener, opensNavigation: true } : null;
}

export function useTourAnchor(href: string, expanded: boolean, panel: RefObject<HTMLElement | null>, descriptionId: string) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    let frame = 0;
    let target: HTMLElement | null = null;
    let previousDescription: string | null = null;
    let disposed = false;
    let observedPanel = panel.current;
    let fallbackViewport = '';
    let revealFallback = false;
    const resize = new ResizeObserver(schedule);
    if (observedPanel) resize.observe(observedPanel);
    resize.observe(document.documentElement);

    function releaseTarget() {
      if (!target) return;
      resize.unobserve(target);
      const descriptions = target.getAttribute('aria-describedby')?.split(/\s+/).filter((id) => id !== descriptionId) ?? [];
      if (descriptions.length) target.setAttribute('aria-describedby', descriptions.join(' '));
      else if (previousDescription === '') target.setAttribute('aria-describedby', '');
      else target.removeAttribute('aria-describedby');
    }

    function measure() {
      frame = 0;
      if (disposed) return;
      if (observedPanel !== panel.current) {
        if (observedPanel) resize.unobserve(observedPanel);
        observedPanel = panel.current;
        if (observedPanel) resize.observe(observedPanel);
      }
      const modalOpen = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]'))
        .some((element) => element.getAttribute('aria-label') !== 'Workspace navigation' && visible(element));
      setSuspended((current) => current === modalOpen ? current : modalOpen);
      if (modalOpen || !expanded) {
        releaseTarget();
        target = null;
        setAnchor((current) => current === null ? current : null);
        return;
      }
      const found = findTourTarget(href);
      if (!found) {
        releaseTarget();
        target = null;
        setAnchor((current) => current === null ? current : null);
        return;
      }
      const viewport = window.visualViewport;
      const bounds = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
      if (target !== found.target) {
        releaseTarget();
        target = found.target;
        fallbackViewport = '';
        previousDescription = target.getAttribute('aria-describedby');
        target.setAttribute('aria-describedby', [previousDescription, descriptionId].filter(Boolean).join(' '));
        resize.observe(target);
        const rect = target.getBoundingClientRect();
        if (rect.top < bounds.top + 8 || rect.bottom > bounds.top + bounds.height - 8) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      }
      const measured = target.getBoundingClientRect();
      const rect = { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
      const navigation = target.closest<HTMLElement>('[role="dialog"][aria-label="Workspace navigation"]');
      const viewportKey = `${bounds.width}:${bounds.height}`;
      const placement = fallbackViewport === viewportKey ? null : placeTour(rect, { width: 352, height: panel.current?.scrollHeight ?? 300 }, bounds);
      const inline = !placement && Boolean(navigation);
      if (inline && fallbackViewport !== viewportKey) {
        fallbackViewport = viewportKey;
        revealFallback = true;
      }
      // In a short drawer the guide participates in its existing scroll flow,
      // after the links, instead of escaping into the inert workspace or covering them.
      const host = inline
        ? target.closest<HTMLElement>('nav[aria-label="Workspace navigation"]') ?? target.parentElement!
        : navigation ?? document.body;
      if (revealFallback && panel.current?.parentElement === host) {
        panel.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        revealFallback = false;
      }
      setAnchor((current) => current?.target === target && current.host === host && current.opensNavigation === found.opensNavigation
        && JSON.stringify(current.rect) === JSON.stringify(rect) && JSON.stringify(current.placement) === JSON.stringify(placement)
        ? current : { target: target!, host, rect, placement, opensNavigation: found.opensNavigation, inline });
    }

    function schedule() {
      if (!disposed && !frame) frame = requestAnimationFrame(measure);
    }
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element && record.target.closest('[data-tutorial-ui]')))) schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'open', 'aria-modal', 'role'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      releaseTarget();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [href, expanded, panel, descriptionId]);

  return { anchor: expanded && !suspended ? anchor : null, suspended };
}

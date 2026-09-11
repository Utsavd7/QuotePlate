import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { ProductDemoVideo } from '@/components/public/ProductDemoVideo';

it('introduces the 2:45 first-purchase journey with fictional records', () => {
  const root = parse(renderToStaticMarkup(<ProductDemoVideo />));
  expect(root.querySelector('h2')?.text).toBe('Your first purchase, step by step.');
  expect(root.text).toContain('2:45');
  expect(root.text).toMatch(/fictional restaurant/i);
  expect(root.text).toMatch(/verified Google email/i);
  expect(root.text).toMatch(/Google/);
  expect(root.text).toMatch(/phone photo/i);
  expect(root.text).toMatch(/upload/i);
  expect(root.text).toMatch(/typed or pasted text/i);
  expect(root.text).toMatch(/permitted website link/i);
  expect(root.text).not.toMatch(/internal demo|public map listings/i);
});

it('preserves native controls, muted inline playback and optional captions before completion', () => {
  const root = parse(renderToStaticMarkup(<ProductDemoVideo />));
  const video = root.querySelector('video')!;
  expect(video.hasAttribute('controls')).toBe(true);
  expect(video.hasAttribute('muted')).toBe(true);
  expect(video.hasAttribute('playsInline')).toBe(true);
  expect(video.getAttribute('preload')).toBe('none');
  expect(video.getAttribute('width')).toBe('3840');
  expect(video.getAttribute('height')).toBe('2400');
  expect(video.querySelector('track')?.hasAttribute('default')).toBe(false);
  expect(root.querySelector('[aria-pressed]')?.getAttribute('aria-pressed')).toBe('false');
  expect(root.querySelector('a[href="/start"]')).toBeNull();
  expect(root.text).not.toContain('Replay video');
});

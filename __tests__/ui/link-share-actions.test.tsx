import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'node-html-parser';
import { LinkShareActions } from '@/components/shared/LinkShareActions';

const message = 'Please quote: https://quoteplate.example/quote#token=private-token\nTomato & dairy';
const subject = 'Quote request: Tomato & dairy';

it('prepares app links with the intact private URL and makes no send or copy call', () => {
  const onCopy = jest.fn();
  const document = parse(renderToStaticMarkup(<LinkShareActions message={message} subject={subject} email="Orders+quotes@example.com" onCopy={onCopy} />));
  const [whatsapp, email] = document.querySelectorAll('a');
  expect(new URL(whatsapp.getAttribute('href')!).searchParams.get('text')).toBe(message);
  expect(whatsapp.getAttribute('target')).toBe('_blank');
  expect(whatsapp.getAttribute('rel')).toBe('noopener noreferrer');
  expect(whatsapp.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  const draft = new URL(email.getAttribute('href')!);
  expect(draft.protocol).toBe('mailto:');
  expect(decodeURIComponent(draft.pathname)).toBe('orders+quotes@example.com');
  expect(draft.searchParams.get('subject')).toBe(subject);
  expect(draft.searchParams.get('body')).toBe(message);
  expect(onCopy).not.toHaveBeenCalled();
  expect(document.querySelector('button')?.text).toContain('Copy link');
});

it.each([null, '', 'orders@example.com?bcc=other@example.com', 'orders@example.com\r\nBcc: other@example.com'])('leaves the email recipient for the user when it is missing or unsafe: %s', email => {
  const document = parse(renderToStaticMarkup(<LinkShareActions message={message} subject={subject} email={email} onCopy={jest.fn()} />));
  const draft = new URL(document.querySelectorAll('a')[1].getAttribute('href')!);
  expect(draft.pathname).toBe('');
  expect(draft.searchParams.has('bcc')).toBe(false);
  expect(draft.searchParams.get('body')).toBe(message);
});

it('prevents sharing or copying a link while it is being replaced or revoked', () => {
  const document = parse(renderToStaticMarkup(<LinkShareActions message={message} subject={subject} disabled onCopy={jest.fn()} />));
  for (const anchor of document.querySelectorAll('a')) {
    expect(anchor.hasAttribute('href')).toBe(false);
    expect(anchor.getAttribute('aria-disabled')).toBe('true');
    expect(anchor.getAttribute('tabindex')).toBe('-1');
  }
  expect(document.querySelector('button')?.hasAttribute('disabled')).toBe(true);
});

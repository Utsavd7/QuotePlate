import { normalizeSupplierContactEmail } from '@/lib/suppliers/contact-email';

test.each([
 [' Orders.Team+Kitchen@Sub.Example.COM ', 'orders.team+kitchen@sub.example.com'],
 ["o'brien@example.com", "o'brien@example.com"],
 ['orders@xn--bcher-kva.de', 'orders@xn--bcher-kva.de'],
 ['orders@example.xn--p1ai', 'orders@example.xn--p1ai'],
])('normalizes a single ASCII mailbox %s', (input, expected) => {
 expect(normalizeSupplierContactEmail(input)).toBe(expected);
});
test.each([
 null, undefined, 123, {}, '', '   ', 'mailto:orders@example.com',
 'one@example.com,two@example.com', 'one,two@example.com',
 'Name <orders@example.com>', 'orders@example.com?subject=Order',
 'orders@example.com\r\nBcc:other@example.com', 'orders@bad_domain.com',
 'orders@-bad.com', 'orders@bad-.com', 'first..last@example.com',
 '.orders@example.com', 'orders.@example.com', 'orders@example.123',
 'Kitchen@example.com', 'orders@éxample.com',
])('rejects non-mailboxes and unsafe or non-ASCII values %j', input => {
 expect(normalizeSupplierContactEmail(input)).toBeNull();
});
test('bounds mailbox, local part, domain labels and untrimmed input', () => {
 const longest = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
 expect(longest).toHaveLength(254);
 expect(normalizeSupplierContactEmail(longest)).toBe(longest);
 expect(normalizeSupplierContactEmail(longest + 'd')).toBeNull();
 expect(normalizeSupplierContactEmail(`${'a'.repeat(65)}@example.com`)).toBeNull();
 expect(normalizeSupplierContactEmail(`orders@${'b'.repeat(64)}.com`)).toBeNull();
 expect(normalizeSupplierContactEmail(' '.repeat(321) + 'orders@example.com')).toBeNull();
});

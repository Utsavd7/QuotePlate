'use client';

import { useState, type FormEvent } from 'react';

import type { ProcurementCategory } from '@/lib/domain/procurement-categories';

import styles from './supplier-application.module.css';

const categoryOptions: Array<{
  key: ProcurementCategory;
  label: string;
}> = [
  { key: 'VEGETABLES', label: 'Vegetables' },
  { key: 'FRUITS', label: 'Fruits' },
  { key: 'DAIRY', label: 'Dairy' },
  { key: 'GRAINS_PULSES', label: 'Grains and pulses' },
  { key: 'FLOUR_BAKERY', label: 'Flour and bakery' },
  { key: 'OILS_FATS', label: 'Oils and fats' },
  { key: 'SPICES_SEASONINGS', label: 'Spices and seasonings' },
  { key: 'DRY_GOODS', label: 'Dry goods' },
  { key: 'BEVERAGES', label: 'Beverages' },
  { key: 'COFFEE_TEA', label: 'Coffee and tea' },
  { key: 'MEAT_POULTRY', label: 'Meat and poultry' },
  { key: 'SEAFOOD', label: 'Seafood' },
  { key: 'EGGS', label: 'Eggs' },
  { key: 'FROZEN_FOODS', label: 'Frozen foods' },
  { key: 'READY_MADE_OUTSOURCED', label: 'Ready made food' },
  { key: 'SWEETS_DESSERTS', label: 'Sweets and desserts' },
  { key: 'SAUCES_CONDIMENTS', label: 'Sauces and condiments' },
  { key: 'PACKAGING_DISPOSABLES', label: 'Packaging and disposables' },
  { key: 'CLEANING_HYGIENE', label: 'Cleaning and hygiene' },
  { key: 'GAS_FUEL', label: 'Gas and fuel' },
  { key: 'KITCHEN_SUPPLIES', label: 'Kitchen supplies' },
  { key: 'OTHER', label: 'Other' },
];

type ProblemFields = Partial<Record<
  'businessName' | 'contact' | 'phone' | 'whatsappNumber' | 'email' | 'categories',
  true
>>;

function text(form: FormData, field: string) {
  return String(form.get(field) ?? '').trim();
}

function safeProblem(body: unknown, status: number) {
  if (status === 410) return 'This application link is no longer available. Ask the restaurant for a new link.';
  if (status === 429) return 'Too many attempts were made. Please wait and try again.';
  if (body && typeof body === 'object') {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.length <= 180) {
      return detail.replaceAll('-', ' ');
    }
  }
  return 'We could not send your application. Please try again.';
}

function problemFields(body: unknown): ProblemFields {
  if (!body || typeof body !== 'object') return {};
  const errors = (body as { errors?: unknown }).errors;
  if (!errors || typeof errors !== 'object') return {};
  return Object.fromEntries(
    Object.keys(errors as Record<string, unknown>)
      .filter((key) => [
        'businessName',
        'contact',
        'phone',
        'whatsappNumber',
        'email',
        'categories',
      ].includes(key))
      .map((key) => [key, true]),
  ) as ProblemFields;
}

export function SupplierApplicationForm({ token }: { token: string }) {
  const [categories, setCategories] = useState<ProcurementCategory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<ProblemFields>({});

  function toggleCategory(category: ProcurementCategory) {
    setCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
    setErrors((current) => ({ ...current, categories: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const businessName = text(form, 'businessName');
    const phone = text(form, 'phone');
    const whatsappNumber = text(form, 'whatsappNumber');
    const email = text(form, 'email');
    const nextErrors: ProblemFields = {};
    if (!businessName) nextErrors.businessName = true;
    if (!phone && !whatsappNumber && !email) nextErrors.contact = true;
    if (categories.length === 0) nextErrors.categories = true;
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setMessage('Complete the marked details before sending.');
      return;
    }

    setSubmitting(true);
    setErrors({});
    setMessage('');
    try {
      const response = await fetch('/api/public/supplier-application', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          businessName,
          contactName: text(form, 'contactName') || null,
          phone: phone || null,
          whatsappNumber: whatsappNumber || null,
          email: email || null,
          categories,
        }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setErrors(problemFields(body));
        setMessage(safeProblem(body, response.status));
        return;
      }
      setSubmitted(true);
    } catch {
      setMessage('We could not send your application. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <section className={styles.success} aria-labelledby="application-sent-heading">
        <p className={styles.eyebrow}>Application received</p>
        <h1 id="application-sent-heading">Application sent.</h1>
        <p>
          The restaurant can now review your details. They will contact you if your supply matches this request.
        </p>
        <div className={styles.successMark} aria-hidden="true">✓</div>
      </section>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={submitting} noValidate>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>Supplier application</p>
        <h1>Become a supplier.</h1>
        <p>
          Tell the restaurant what you supply and how to reach you. They will review your details before sending a price request.
        </p>
        <div className={styles.assurance} aria-label="Application facts">
          <span>No account needed</span>
          <span>No supplier fee</span>
          <span>Private application</span>
        </div>
      </header>

      <section className={styles.section} aria-labelledby="business-details-heading">
        <div className={styles.sectionTitle}>
          <span aria-hidden="true">01</span>
          <div>
            <h2 id="business-details-heading">Business details</h2>
            <p>Tell the restaurant who they should contact.</p>
          </div>
        </div>

        <div className={styles.fields}>
          <label className={styles.wideField}>
            <span>Business name</span>
            <input
              name="businessName"
              type="text"
              autoComplete="organization"
              maxLength={160}
              aria-invalid={errors.businessName || undefined}
              required
            />
            {errors.businessName ? <small>Enter your business name.</small> : null}
          </label>
          <label>
            <span>Contact person (optional)</span>
            <input name="contactName" type="text" autoComplete="name" maxLength={120} />
          </label>
          <label>
            <span>Phone number</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              aria-invalid={errors.phone || errors.contact || undefined}
            />
            {errors.phone && <small>Check your phone number, including the country code if needed.</small>}
          </label>
          <label>
            <span>WhatsApp number</span>
            <input
              name="whatsappNumber"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              aria-invalid={errors.whatsappNumber || errors.contact || undefined}
            />
            {errors.whatsappNumber && <small>Check your WhatsApp number, including the country code if needed.</small>}
          </label>
          <label>
            <span>Email address</span>
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={320}
              placeholder="orders@example.com"
              aria-invalid={errors.email || errors.contact || undefined}
            />
            {errors.email && <small>Enter a complete email address, such as orders@example.com.</small>}
          </label>
        </div>
        <p className={errors.contact ? styles.fieldError : styles.fieldHint}>
          Add at least one phone, WhatsApp number, or email address.
        </p>
      </section>

      <fieldset className={styles.section} aria-describedby="category-help category-error">
        <legend className={styles.categoryLegend}>What can you supply?</legend>
        <p id="category-help" className={styles.fieldHint}>Choose every category your business can supply.</p>
        <div className={styles.categories}>
          {categoryOptions.map(({ key, label }) => (
            <label key={key} className={styles.category}>
              <input
                type="checkbox"
                name="categories"
                value={key}
                checked={categories.includes(key)}
                onChange={() => toggleCategory(key)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p
          id="category-error"
          className={errors.categories ? styles.fieldError : styles.fieldHint}
          aria-live="polite"
        >
          {errors.categories ? 'Choose at least one category.' : `${categories.length} selected`}
        </p>
      </fieldset>

      <footer className={styles.submitRow}>
        <p>
          Sending this form does not guarantee an order. The restaurant decides which suppliers to approve.
        </p>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending application' : 'Send application'}
        </button>
      </footer>
      {message ? (
        <p className={styles.message} role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}

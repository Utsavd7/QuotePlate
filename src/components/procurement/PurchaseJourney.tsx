import styles from './purchase-ui.module.css';
import Link from 'next/link';

const steps = ['Choose ingredients', 'Compare prices', 'Choose supplier', 'Check delivery'] as const;

export function PurchaseJourney({ current, links = {} }: {
  current?: number;
  links?: Partial<Record<number, string>>;
}) {
  return (
    <ol className={styles.journey} aria-label="Purchase steps">
      {steps.map((label, index) => (
        <li key={label} aria-current={current === index ? 'step' : undefined}>
          {links[index] ? <Link href={links[index]}><span>{index + 1}</span>{label}</Link> : <span><span>{index + 1}</span>{label}</span>}
        </li>
      ))}
    </ol>
  );
}

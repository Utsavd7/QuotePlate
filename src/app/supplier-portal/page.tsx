import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/Wordmark';
import { SupplierPortalAccess } from './SupplierPortalAccess';
import styles from '@/components/supplier-portal/supplier-portal-public.module.css';
export const metadata: Metadata = {title:'Supplier workspace',description:'Your private QuotePlate orders, delivery responses and shared demand estimates.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function SupplierPortalPage(){return <main className={styles.page}><div className={styles.shell}><Link className={styles.brand} href="/" aria-label="QuotePlate home"><Wordmark/></Link><SupplierPortalAccess/><p className={styles.footer}>Shared directly by your restaurant. Keep this link private. No automatic orders, payments or supplier messages.</p></div></main>;}

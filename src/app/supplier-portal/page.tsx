import type { Metadata } from 'next';
import { PublicSupplierShell } from '@/components/supplier-portal/PublicSupplierShell';
import { SupplierPortalAccess } from './SupplierPortalAccess';
import styles from '@/components/supplier-portal/supplier-portal-public.module.css';
export const metadata: Metadata = {title:'Supplier workspace',description:'Your private QuotePlate orders, delivery responses and shared demand estimates.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function SupplierPortalPage(){return <PublicSupplierShell className={styles.shell} footer="Shared directly by your restaurant. Keep this link private. No automatic orders, payments or supplier messages."><SupplierPortalAccess/></PublicSupplierShell>;}

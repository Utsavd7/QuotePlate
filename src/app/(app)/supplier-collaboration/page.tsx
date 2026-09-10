import { RestaurantSupplierPortal } from '@/components/supplier-portal/RestaurantSupplierPortal';

export const metadata = { title: 'Orders & messages' };

export default async function SupplierCollaborationPage({ searchParams }: {
  searchParams: Promise<{ supplier?: string | string[] }>;
}) {
  const { supplier } = await searchParams;
  const supplierId = typeof supplier === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(supplier) ? supplier : '';
  return <RestaurantSupplierPortal key={supplierId} initialSupplierId={supplierId} />;
}

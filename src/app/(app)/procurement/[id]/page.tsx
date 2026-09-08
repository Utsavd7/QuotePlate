import { RequestDetail } from '@/components/procurement/RequestDetail';
import { pageRecordId } from '@/lib/page-record-id';

export const metadata = { title: 'Procurement request · QuotePlate' };

export default async function ProcurementRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetail requestId={pageRecordId(id)} />;
}

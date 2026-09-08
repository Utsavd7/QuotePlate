import { PageSkeleton } from '@/components/Skeleton';

export default function WorkspaceLoading() {
  return <div role="status" aria-label="Loading workspace page"><PageSkeleton /></div>;
}

export type TourRect = { left: number; top: number; width: number; height: number };
export type TourPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: 'right' | 'left' | 'below' | 'above';
  arrow: number;
};

const margin = 12;
const gap = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Place beside the real control, never over it, within the visible viewport. */
export function placeTour(target: TourRect, panel: { width: number; height: number }, viewport: TourRect): TourPlacement | null {
  const left = viewport.left + margin;
  const top = viewport.top + margin;
  const right = viewport.left + viewport.width - margin;
  const bottom = viewport.top + viewport.height - margin;
  const width = Math.min(panel.width, right - left);
  const height = Math.min(panel.height, bottom - top);
  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;
  if (targetRight < left || target.left > right || targetBottom < top || target.top > bottom) return null;

  if (right - targetRight - gap >= width || target.left - left - gap >= width) {
    const side = right - targetRight - gap >= width ? 'right' : 'left';
    const y = clamp(target.top, top, bottom - height);
    return {
      side, left: side === 'right' ? targetRight + gap : target.left - gap - width,
      top: y, width, maxHeight: bottom - top,
      arrow: clamp(target.top + target.height / 2 - y, 18, height - 18),
    };
  }

  const below = bottom - targetBottom - gap;
  const above = target.top - gap - top;
  const side = below >= height || below >= above ? 'below' : 'above';
  const maxHeight = side === 'below' ? below : above;
  // At extreme zoom/short heights use the inline guide instead of covering the target.
  if (maxHeight < 128) return null;
  const x = clamp(target.left, left, right - width);
  return {
    side, left: x, top: side === 'below' ? targetBottom + gap : target.top - gap - Math.min(height, maxHeight),
    width, maxHeight,
    arrow: clamp(target.left + target.width / 2 - x, 18, width - 18),
  };
}

import { placeTour, type TourRect } from '@/components/tutorial/tour-position';

const panel = { width: 352, height: 320 };
const laptop = { left: 0, top: 0, width: 1366, height: 768 };
const phone = { left: 0, top: 0, width: 390, height: 844 };

function expectAdjacent(target: TourRect, viewport: TourRect) {
  const result = placeTour(target, panel, viewport);
  expect(result).not.toBeNull();
  const { left, top, width, maxHeight } = result!;
  const height = Math.min(panel.height, maxHeight);
  expect(left).toBeGreaterThanOrEqual(viewport.left + 12);
  expect(top).toBeGreaterThanOrEqual(viewport.top + 12);
  expect(left + width).toBeLessThanOrEqual(viewport.left + viewport.width - 12);
  expect(top + height).toBeLessThanOrEqual(viewport.top + viewport.height - 12);
  expect(left >= target.left + target.width || left + width <= target.left || top >= target.top + target.height || top + height <= target.top).toBe(true);
  return result!;
}

describe('anchored setup guide placement', () => {
  it('sits to the right of desktop navigation without covering it', () => {
    expect(expectAdjacent({ left: 16, top: 260, width: 184, height: 44 }, laptop).side).toBe('right');
  });
  it('flips left for controls near the right edge', () => {
    expect(expectAdjacent({ left: 1180, top: 260, width: 160, height: 44 }, laptop).side).toBe('left');
  });
  it('sits below the mobile navigation opener', () => {
    expect(expectAdjacent({ left: 12, top: 8, width: 44, height: 44 }, phone).side).toBe('below');
  });
  it('moves above low controls in the mobile drawer', () => {
    expect(expectAdjacent({ left: 16, top: 600, width: 252, height: 44 }, phone).side).toBe('above');
  });
  it('repositions after a control moves and a viewport resizes', () => {
    const before = expectAdjacent({ left: 16, top: 260, width: 184, height: 44 }, laptop);
    const after = expectAdjacent({ left: 16, top: 160, width: 252, height: 44 }, phone);
    expect(after.side).not.toBe(before.side);
    expect(after.top).not.toBe(before.top);
  });
  it('uses visual viewport offsets when zoomed or the keyboard is open', () => {
    expectAdjacent({ left: 85, top: 130, width: 180, height: 44 }, { left: 60, top: 90, width: 320, height: 430 });
  });
  it('constrains tall instructions to the available space on short screens', () => {
    const result = expectAdjacent({ left: 16, top: 170, width: 252, height: 44 }, { ...phone, height: 480 });
    expect(result.maxHeight).toBeLessThan(panel.height);
  });
  it('falls back instead of obscuring a control at extreme zoom', () => {
    expect(placeTour({ left: 16, top: 85, width: 230, height: 44 }, panel, { left: 0, top: 0, width: 260, height: 210 })).toBeNull();
  });
  it('does not show an orphan highlight for an offscreen target', () => {
    expect(placeTour({ left: 16, top: 1200, width: 180, height: 44 }, panel, phone)).toBeNull();
  });
});

export function makeMovablePanel(panel: HTMLElement, handle: HTMLElement) {
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
  const place = (left: number, top: number) => {
    const bounds = panel.getBoundingClientRect();
    const padding = 12;
    panel.style.left = `${Math.max(padding, Math.min(left, window.innerWidth - bounds.width - padding))}px`;
    panel.style.top = `${Math.max(padding, Math.min(top, window.innerHeight - bounds.height - padding))}px`;
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    const bounds = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault(); handle.focus();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  const finish = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', () => { drag = null; });
  handle.addEventListener('keydown', event => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const bounds = panel.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
    place(bounds.left + direction[0] * step, bounds.top + direction[1] * step);
  });
  window.addEventListener('resize', () => {
    const bounds = panel.getBoundingClientRect();
    place(bounds.left, bounds.top);
  });
}

/**
 * Owner for async event subscriptions (Tauri `listen`, `onDragDropEvent`, …).
 *
 * `listen()` resolves its unlisten function asynchronously. If the owner is
 * disposed first — React StrictMode unmounts effects immediately in dev, and a
 * StageRuntime can be destroyed while its listeners are still registering — a
 * naive `.then(u => list.push(u))` leaks the listener forever, so every event is
 * handled twice (found as duplicated chat lines). Here a subscription that
 * resolves after `dispose()` is unsubscribed on arrival.
 */
export class Subscriptions {
  private fns: Array<() => void> = [];
  private disposed = false;

  add(p: Promise<() => void> | (() => void)): void {
    if (typeof p === "function") {
      if (this.disposed) p();
      else this.fns.push(p);
      return;
    }
    void p.then((un) => {
      if (this.disposed) un();
      else this.fns.push(un);
    });
  }

  dispose(): void {
    this.disposed = true;
    const fns = this.fns;
    this.fns = [];
    fns.forEach((f) => f());
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

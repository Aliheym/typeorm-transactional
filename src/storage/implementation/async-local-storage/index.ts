import { AsyncLocalStorage } from 'node:async_hooks';

import { StorageKey, StorageValue, StorageLayerContext } from '../interface';

export class AsyncLocalStorageContext implements StorageLayerContext {
  private context: AsyncLocalStorage<StorageLayerContext['store']>;

  constructor() {
    this.context = new AsyncLocalStorage();
  }

  get store() {
    return this.context.getStore();
  }

  public get<T>(key: StorageKey): T {
    return this.store?.get(key) as T;
  }

  public set(key: StorageKey, value: StorageValue): void {
    this.store?.set(key, value);
  }

  public run<T>(cb: () => T): T {
    return this.context.run(new Map(), cb);
  }
}

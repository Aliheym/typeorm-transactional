import { AsyncLocalStorage } from 'async_hooks';

import { StorageKey, StorageValue, StorageDriver, Storage } from '../interface';

class Store {
  // Ref: https://github.com/Jeff-Lewis/cls-hooked/blob/master/context.js#L24
  // AsyncLocalStorage behaves differently from cls-hooked, as it expects
  // store to be passed on each `.run` call. cls-hooked manages the storage
  // and it's layers for the user. This class replicates cls-hooked behavior.

  private layers: (Storage | undefined)[] = [];
  private storage: Storage | undefined;

  get active() {
    return !!this.storage;
  }

  public get<T>(key: StorageKey): T {
    return this.storage?.get(key) as T;
  }

  public set(key: StorageKey, value: StorageValue): void {
    this.storage?.set(key, value);
  }

  public enter() {
    // Ref: https://github.com/Jeff-Lewis/cls-hooked/blob/master/context.js#L184-L195

    const newStorage = new Map(this.storage);
    this.layers.push(this.storage);
    this.storage = newStorage;
    return newStorage;
  }

  public exit(storage: Storage) {
    // Ref: https://github.com/Jeff-Lewis/cls-hooked/blob/master/context.js#L197-L225

    if (this.storage === storage) {
      this.storage = this.layers.pop() ?? new Map();
      return;
    }

    const index = this.layers.lastIndexOf(storage);

    if (index >= 0) {
      this.layers.splice(index, 1);
    }
  }
}

export class AsyncLocalStorageDriver implements StorageDriver {
  private context: AsyncLocalStorage<Store>;

  constructor() {
    this.context = new AsyncLocalStorage();
  }

  get active() {
    return this.store.active;
  }

  private get store() {
    return this.context.getStore() || new Store();
  }

  public get<T>(key: StorageKey): T {
    return this.store?.get(key);
  }

  public set(key: StorageKey, value: StorageValue): void {
    this.store?.set(key, value);
  }

  public async run<T>(cb: () => Promise<T>): Promise<T> {
    const storage = this.store.enter();

    try {
      return await this.context.run(this.store, cb);
    } finally {
      this.store.exit(storage);
    }
  }
}

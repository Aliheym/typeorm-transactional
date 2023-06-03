import { Namespace, createNamespace, getNamespace } from 'cls-hooked';

import { StorageKey, StorageValue, StorageDriver } from '../interface';
import { NAMESPACE_TOKEN } from './constants';

export class ClsHookedDriver implements StorageDriver {
  private context: Namespace;

  constructor() {
    this.context = getNamespace(NAMESPACE_TOKEN) ?? createNamespace(NAMESPACE_TOKEN);
  }

  get active() {
    return !!this.context.active;
  }

  private get store() {
    return this.context.active;
  }

  public get<T>(key: StorageKey): T {
    return this.context.get(key) as T;
  }

  public set(key: StorageKey, value: StorageValue): void {
    this.context.set(key, value);
  }

  public run<T>(cb: () => T): T {
    return this.context.runAndReturn(cb);
  }
}

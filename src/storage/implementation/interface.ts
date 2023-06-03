export type StorageKey = string;
export type StorageValue = unknown;

export interface StorageLayerContext {
  store: Map<StorageKey, StorageValue> | undefined;
  get(key: StorageKey): StorageValue;
  set(key: StorageKey, value: StorageValue): void;
  run<T>(cb: () => T): T;
}

export interface StorageLayer {
  create(): StorageLayerContext;
  get(): StorageLayerContext;
}

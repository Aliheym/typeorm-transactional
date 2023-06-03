export type StorageKey = string;
export type StorageValue = unknown;
export type Storage = Map<StorageKey, StorageValue>;

export interface StorageLayerContext {
  active: boolean;
  get(key: StorageKey): StorageValue;
  set(key: StorageKey, value: StorageValue): void;
  run<T>(cb: () => Promise<T>): Promise<T>;
}

export interface StorageLayer {
  create(): StorageLayerContext;
  get(): StorageLayerContext;
}

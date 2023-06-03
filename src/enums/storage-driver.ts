/**
 * Enumeration that represents storage engines to use with {@link initializeTransactionalContext}
 */
export enum StorageDriver {
  /**
   * Uses AsyncLocalStorage when node >= 16 and cls-hooked otherwise
   */
  AUTO = 'AUTO',

  /**
   * Supports legacy node versions
   * Uses AcyncWrap for node < 8.2.1 and async_hooks otherwise
   */
  CLS_HOOKED = 'CLS_HOOKED',

  /**
   * Uses AsyncLocalStorage which is available sice node 16
   */
  ASYNC_LOCAL_STORAGE = 'ASYNC_LOCAL_STORAGE',
}

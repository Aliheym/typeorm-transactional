import { gte } from 'semver';

import { StorageDriver as StorageDriverEnum } from '../enums/storage-driver';
import { AsyncLocalStorageDriver } from './driver/async-local-storage';
import type { StorageDriver } from './driver/interface';
import { ClsHookedDriver } from './driver/cls-hooked';

interface StorageDriverConstructor {
  new (): StorageDriver;
}

export class Storage {
  private driver: StorageDriver;

  public create(storageDriverEnum?: StorageDriverEnum) {
    if (this.driver) {
      // We probably should not allow calling this function when driver is already defined
      return this.driver;
    }

    const DriverConstructor = this.getDriverConstructor(storageDriverEnum);
    this.driver = new DriverConstructor();

    return this.driver;
  }

  public get() {
    if (!this.driver) {
      throw new Error(
        'No storage driver defined in your app ... please call initializeTransactionalContext() before application start.',
      );
    }

    return this.driver;
  }

  private getDriverConstructor(storageDriverEnum?: StorageDriverEnum): StorageDriverConstructor {
    switch (storageDriverEnum) {
      case StorageDriverEnum.ASYNC_LOCAL_STORAGE:
        return AsyncLocalStorageDriver;
      case StorageDriverEnum.CLS_HOOKED:
        return ClsHookedDriver;
      case StorageDriverEnum.AUTO:
      default:
        return this.getBestSupportedDriverConstructor();
    }
  }

  private getBestSupportedDriverConstructor(): StorageDriverConstructor {
    if (process && gte(process.versions.node, '16.0.0')) {
      return AsyncLocalStorageDriver;
    }

    return ClsHookedDriver;
  }
}

import { gte } from 'semver';

import type { StorageLayerDriver } from './driver/interface';
import { AsyncLocalStorageDriver } from './driver/async-local-storage';
import { ClsHookedDriver } from './driver/cls-hooked';

export class StorageLayer {
  private context: StorageLayerDriver;

  public create() {
    if (this.context) {
      return this.context;
    }

    this.context = this.createSupportedContext();
    return this.context;
  }

  public get() {
    if (!this.context) {
      throw new Error(
        'You must initialize StorageLayer before accessing... TODO: use proper error',
      );
    }

    return this.context;
  }

  private createSupportedContext(): StorageLayerDriver {
    if (process && gte(process.versions.node, '16.0.0')) {
      return new AsyncLocalStorageDriver();
    }

    return new ClsHookedDriver();
  }
}

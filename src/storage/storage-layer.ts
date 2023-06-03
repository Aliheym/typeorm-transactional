import { gte } from 'semver';

import type { StorageLayerContext } from './implementation/interface';
import { AsyncLocalStorageContext } from './implementation/async-local-storage';
import { CslHookedContext } from './implementation/cls-hooked';

export class StorageLayer {
  private context: StorageLayerContext;

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

  private createSupportedContext(): StorageLayerContext {
    if (process && gte(process.versions.node, '16.0.0')) {
      return new AsyncLocalStorageContext();
    }

    return new CslHookedContext();
  }
}

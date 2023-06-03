import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

import { Post } from './entities/Post.entity';
import { PostRepository } from './repositories/post.repository';
import { extendPostRepository } from './repositories/extend-post-repository';

import {
  StorageDriver,
  addTransactionalDataSource,
  initializeTransactionalContext,
  runInTransaction,
  runOnTransactionRollback,
} from '../src';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const message = 'a simple message';

describe('Custom repositories tests', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5435,
      username: 'postgres',
      password: 'postgres',
      database: 'test',
      entities: [Post],
      synchronize: true,
    });

    const storageDriver = process.env.TEST_STORAGE_DRIVER && process.env.TEST_STORAGE_DRIVER in StorageDriver
      ? StorageDriver[process.env.TEST_STORAGE_DRIVER as keyof typeof StorageDriver]
      : StorageDriver.CLS_HOOKED;

    initializeTransactionalContext({ storageDriver });

    addTransactionalDataSource(dataSource);

    await dataSource.initialize();
  });

  afterEach(async () => {
    await dataSource.createEntityManager().clear(Post);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should not change database on rollback using runInTransaction with simple repository', async () => {
    const repo = dataSource.getRepository(Post);
    const slug = crypto.randomBytes(12).toString('hex');

    let rejectHookCalled = false;

    try {
      await runInTransaction(async () => {
        runOnTransactionRollback(() => (rejectHookCalled = true));

        const firstPost = await repo.save({ slug, message });
        const secondPost = await repo.save({ slug, message });

        return [firstPost, secondPost];
      });
    } catch {}

    const post = await repo.findOneBy({ slug });

    await sleep(100);

    expect(post).toBeNull();
    expect(rejectHookCalled).toBeTruthy();
  });

  it('should not change database on rollback using runInTransaction with custom repository', async () => {
    const repo = new PostRepository(dataSource);
    const slug = crypto.randomBytes(12).toString('hex');

    let rejectHookCalled = false;

    try {
      await runInTransaction(async () => {
        runOnTransactionRollback(() => (rejectHookCalled = true));

        const firstPost = await repo.saveWithSlug(slug);
        const secondPost = await repo.saveWithSlug(slug);

        return [firstPost, secondPost];
      });
    } catch {}

    const post = await repo.findOneBy({ slug });

    await sleep(100);

    expect(post).toBeNull();
    expect(rejectHookCalled).toBeTruthy();
  });

  it('should not change database on rollback using runInTransaction with extend', async () => {
    const repo = extendPostRepository(dataSource.getRepository(Post));
    const slug = crypto.randomBytes(12).toString('hex');

    let rejectHookCalled = false;

    try {
      await runInTransaction(async () => {
        runOnTransactionRollback(() => (rejectHookCalled = true));

        const firstPost = await repo.saveWithSlug(slug);
        const secondPost = await repo.saveWithSlug(slug);

        return [firstPost, secondPost];
      });
    } catch {}

    const post = await repo.findOneBy({ slug });

    await sleep(100);

    expect(post).toBeNull();
    expect(rejectHookCalled).toBeTruthy();
  });
});

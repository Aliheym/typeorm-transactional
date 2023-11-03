import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserReaderService } from './user-reader.service';

import { User } from '../entities/User.entity';
import { runOnTransactionCommit, runOnTransactionRollback, Transactional } from '../../src';
import { Either, fail, ok } from '../../src/utils/result';
import { UnexpectedError } from '../../src/errors/unexpected';

type CreateUserResponse = Either<User, UnexpectedError>;

@Injectable()
export class UserWriterService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,

    private readonly readerService: UserReaderService,
  ) {}

  @Transactional()
  async createUser(name: string, hookHandler?: (isCommitted: boolean) => any): Promise<User> {
    if (hookHandler) {
      runOnTransactionCommit(() => hookHandler(true));
      runOnTransactionRollback(() => hookHandler(false));
    }

    const user = new User(name, 0);
    await this.repository.save(user);

    return user;
  }

  @Transactional()
  async createUserAndThrow(
    name: string,
    hookHandler?: (isCommitted: boolean) => any,
  ): Promise<User> {
    if (hookHandler) {
      runOnTransactionCommit(() => hookHandler(true));
      runOnTransactionRollback(() => hookHandler(false));
    }

    const user = new User(name, 0);
    await this.repository.save(user);

    throw new Error('Some error');
  }

  @Transactional()
  async createUserAndReturnResultOk(
    name: string,
    hookHandler?: (isCommitted: boolean) => any,
  ): Promise<CreateUserResponse> {
    if (hookHandler) {
      runOnTransactionCommit(() => hookHandler(true));
      runOnTransactionRollback(() => hookHandler(false));
    }

    const user = new User(name, 0);
    await this.repository.save(user);

    return ok(user);
  }

  @Transactional()
  async createUserAndReturnResultFail(
    name: string,
    hookHandler?: (isCommitted: boolean) => any,
  ): Promise<CreateUserResponse> {
    if (hookHandler) {
      runOnTransactionCommit(() => hookHandler(true));
      runOnTransactionRollback(() => hookHandler(false));
    }

    const user = new User(name, 0);
    await this.repository.save(user);

    return fail(new UnexpectedError('Some error'));
  }

  @Transactional()
  async createUserAndThrowDueToSubServiceThrow(
    name: string,
    hookHandler?: (isCommitted: boolean) => any,
  ): Promise<CreateUserResponse> {
    if (hookHandler) {
      runOnTransactionCommit(() => hookHandler(true));
      runOnTransactionRollback(() => hookHandler(false));
    }
    const user = new User(name, 0);
    await this.repository.save(user);

    // sub service return failed
    await this.createUserAndThrow(name + '123');

    return ok(user);
  }

  @Transactional()
  async createUserAndReturnResultFailDueToSubServiceReturnFail(
    name: string,
    hookHandler?: (isCommitted: boolean) => any,
  ): Promise<CreateUserResponse> {
    if (hookHandler) {
      runOnTransactionCommit(() => hookHandler(true));
      runOnTransactionRollback(() => hookHandler(false));
    }
    const user = new User(name, 0);
    await this.repository.save(user);

    // sub service return failed
    await this.createUserAndReturnResultFail(name + '123');

    return ok(user);
  }
}

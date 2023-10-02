import { Repository } from 'typeorm';

import { User } from '../entities/User.entity';

export const extendUserRepository = <T extends {}>(repository: Repository<T>) => {
  return repository.extend({
    async insertUser(name: string, money: number = 0): Promise<User> {
      return this.insert(new User(name, money));
    },
  });
};

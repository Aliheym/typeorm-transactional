import { DataSource, Repository } from 'typeorm';

import { User } from '../entities/User.entity';

export class UserRepository extends Repository<User> {
  constructor(private readonly dataSource: DataSource) {
    super(User, dataSource.manager);
  }

  async createUser(name: string, money: number = 0): Promise<User> {
    const user = new User(name, money);

    return this.save(user);
  }

  async findUserByName(name: string): Promise<User | null> {
    return this.findOne({ where: { name } });
  }
}

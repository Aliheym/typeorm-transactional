import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn()
  name: string;

  @Column({ type: 'integer' })
  money: number;

  constructor(name: string, money: number) {
    this.name = name;
    this.money = money;
  }
}

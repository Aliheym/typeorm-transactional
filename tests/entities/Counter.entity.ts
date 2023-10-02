import { Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('counters')
export class Counter {
  @PrimaryGeneratedColumn()
  value: number;
}

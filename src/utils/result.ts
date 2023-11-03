// eslint-disable-next-line no-use-before-define
export type Either<A, L> = Fail<A, L> | Ok<A, L>;

export class Fail<A, L> {
  public readonly value: L;

  constructor(value: L) {
    this.value = value;
  }

  public isFail(): this is Fail<A, L> {
    return true;
  }

  public isOk(): this is Ok<A, L> {
    return false;
  }
}

export class Ok<A, L> {
  public readonly value: A;

  constructor(value?: A) {
    this.value = value || (undefined as unknown as A);
  }

  public isFail(): this is Fail<A, L> {
    return false;
  }

  public isOk(): this is Ok<A, L> {
    return true;
  }
}

export const fail = <A, L>(l: L): Either<A, L> => {
  return new Fail(l);
};

export const ok = <A, L>(a?: A): Either<A, L> => {
  return new Ok<A, L>(a);
};

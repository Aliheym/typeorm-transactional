export class UnexpectedError {
  public message: string;
  public errorId = 'UNEXPECTED_ERROR';

  constructor(msg?: string) {
    this.message = msg ?? 'An unexpected error occurred';
  }
}

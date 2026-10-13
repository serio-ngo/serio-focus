export class Blocked extends Error {
  constructor(message, ask = false) {
    super(message);
    this.ask = ask;
  }
}

export class Blocked extends Error {
  constructor(message, held = false) {
    super(message);
    this.held = held;
  }
}

export class SourceUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SourceUnavailableError";
  }
}

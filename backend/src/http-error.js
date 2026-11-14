// An error that is safe to show to the client: `status` and `code` are sent
// as-is, `message` becomes the response's `error` text.
export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

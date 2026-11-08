export type PodcastParseErrorCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'DOCTYPE'
  | 'MALFORMED_XML'
  | 'NOT_A_FEED'
  | 'UNSUPPORTED_XML';

export class PodcastParseError extends Error {
  constructor(
    readonly code: PodcastParseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PodcastParseError';
  }
}

export class SourceParseError extends Error {
  override readonly name: string = "SourceParseError";
}

export class ChallengePageError extends SourceParseError {
  override readonly name: string = "ChallengePageError";
}

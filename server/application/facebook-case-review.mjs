import { reviewFacebookCases } from "../domain/facebook-case-review.mjs";
import { facebookCaseVersion } from "../domain/facebook-case.mjs";
import { bangkokDay } from "../domain/catalog.mjs";

export function createFacebookCaseReview({
  repository,
  clock = () => new Date(),
}) {
  return async () => {
    const [properties, library, indexes] = await Promise.all([
      repository.allProperties(),
      repository.getState("facebook_public_posts", { albums: [] }),
      repository.facebookCaseIndexes(facebookCaseVersion),
    ]);
    const now = clock();
    return {
      ...reviewFacebookCases(
        properties,
        library.albums || [],
        indexes,
        bangkokDay(now),
      ),
      checkedAt: now.toISOString(),
      version: facebookCaseVersion,
    };
  };
}

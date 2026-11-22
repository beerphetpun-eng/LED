import {
  auctionISO,
  bangkokDay,
  facebookPostDetails,
  selectFacebookPosts,
} from "./catalog.mjs";

export function facebookLibraryGroups(index, properties, today = bangkokDay()) {
  const groups = new Map();
  const albums = index.albums || [];
  const captionDates = albums
    .map(facebookPostDetails)
    .filter(Boolean)
    .map(({ date }) => date.split("-").reverse().join("/"));
  const eligible = new Set(
    selectFacebookPosts(albums, captionDates, today).map(
      (album) => album.albumKey || album.url,
    ),
  );
  const groupFor = (date) => {
    if (!groups.has(date))
      groups.set(date, { date, propertyIds: new Set(), posts: [] });
    return groups.get(date);
  };
  for (const property of properties) {
    for (const raw of property.auctionDates || []) {
      const date = auctionISO(raw);
      if (date) groupFor(date).propertyIds.add(property.id);
    }
  }
  const seen = new Set();
  for (const album of albums) {
    const details = facebookPostDetails(album);
    const key = album.albumKey || album.url;
    if (seen.has(key)) continue;
    seen.add(key);
    const date = details?.date || null;
    groupFor(date).posts.push({
      ...album,
      kind: details?.kind || null,
      eligible: eligible.has(key),
      complete:
        Number.isSafeInteger(album.expectedPhotos) &&
        album.expectedPhotos > 0 &&
        album.images.length >= album.expectedPhotos,
    });
  }
  return [...groups.values()]
    .map(({ propertyIds, ...group }) => ({
      ...group,
      checkedAt: index.discovery?.[group.date]?.checkedAt || null,
      properties: propertyIds.size,
      available: group.posts.some(
        (post) => post.eligible && post.images.length,
      ),
      awaitingAnnouncement: Boolean(group.date && group.date > today),
    }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

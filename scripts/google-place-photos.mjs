export function getGoogleApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    ""
  );
}

/**
 * @returns {{ all: string[], logo: string, photos: string[], provider: "google", displayName?: string, rating?: number|null, userRatingCount?: number|null }}
 */
export async function searchGooglePlacePhotos(
  { name, address, city, state, lat, lng },
  apiKey
) {
  const textQuery = [name, address, city, state].filter(Boolean).join(", ").trim();
  if (!textQuery) {
    return { all: [], logo: "", photos: [], provider: "google" };
  }

  const latitude = Number(lat);
  const longitude = Number(lng);
  const body = {
    textQuery,
    maxResultCount: 1,
    locationBias:
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? {
            circle: {
              center: { latitude, longitude },
              radius: 250.0,
            },
          }
        : undefined,
  };

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.photos,places.displayName,places.rating,places.userRatingCount",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Places search failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const place = data.places?.[0];
  const photoNames = (place?.photos || []).slice(0, 10).map((p) => p.name).filter(Boolean);

  const all = photoNames.map(
    (ref) => `/api/google-photo?ref=${encodeURIComponent(ref)}`
  );

  return {
    logo: all[0] || "",
    photos: all.slice(1),
    all,
    provider: "google",
    displayName: place?.displayName?.text || "",
    rating:
      typeof place?.rating === "number" ? place.rating : null,
    userRatingCount:
      typeof place?.userRatingCount === "number" ? place.userRatingCount : null,
  };
}

export function isValidGooglePhotoRef(ref) {
  return /^places\/[^/]+\/photos\/[^/]+$/.test(ref);
}

export async function fetchGooglePhotoBytes(photoRef, apiKey) {
  const mediaUrl = `https://places.googleapis.com/v1/${photoRef}/media?maxHeightPx=720&maxWidthPx=1080`;
  const response = await fetch(mediaUrl, {
    headers: { "X-Goog-Api-Key": apiKey },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Google photo media failed (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";
  return { buffer, contentType };
}

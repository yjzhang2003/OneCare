// The cache tag every VOC read shares, so a write can invalidate all of them at
// once. It lives in its own module rather than in either the reader or the
// writer: both sides must name the identical string, and a tag that only one
// side gets right fails silently — the write succeeds, the read stays stale, and
// the operator sees a success toast over a row that still shows the old state.
//
// Before this existed the cached reads were time-based only (cacheLife
// "minutes"), which is correct for a read-only page and wrong the moment the
// page can write: minutes of staleness after your own click reads as "the
// button did nothing".
export const VOC_RECORDS_CACHE_TAG = "voc-records";

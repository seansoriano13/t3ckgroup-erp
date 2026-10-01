// Matches `.../image/upload/` followed by the version (`v123/`) or the public
// id — i.e. an image delivery URL with no transformation segment yet.
const IMAGE_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?![a-z]{1,3}_[^/]*\/)/;

/**
 * A small copy of a Cloudinary image for a preview or an avatar, so a list
 * does not download the full upload (about 300 KB) to fill a small box.
 * Cloudinary resizes on the fly and caches the result. `q_auto,f_auto` lets it
 * pick the quality and serve WebP/AVIF where the browser takes them.
 *
 * With only `width`, the image keeps its shape (never upscaled); with a
 * `height` too, it is cropped to fill that box. Anything that is not a plain
 * Cloudinary image URL (videos, raw files, Supabase signed URLs, blob/data
 * URLs, Google photos, an already-transformed URL) comes back unchanged.
 */
export function cloudinaryThumb(url, { width, height } = {}) {
  if (!url || !IMAGE_UPLOAD.test(url)) return url;
  const transform = height
    ? `c_fill,w_${width},h_${height},q_auto,f_auto`
    : `c_limit,w_${width},q_auto,f_auto`;
  return url.replace(IMAGE_UPLOAD, `$1${transform}/`);
}

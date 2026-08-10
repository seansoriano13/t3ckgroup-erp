import imageCompression from "browser-image-compression"

export const storageService = {
  /**
   * Compresses and uploads an image to Cloudinary (formerly Supabase Storage).
   *Offloading media to Cloudinary eliminates Supabase Egress costs.
   */
  async uploadTaskAttachment(userId, taskId, file) {
    if (!userId || !taskId || !file)
      throw new Error("Missing required fields for upload.")

    // Switch to Cloudinary for all task attachments to save Supabase Egress
    return this.uploadToCloudinary(file)
  },

  async getSignedUrls(paths = []) {
    if (!paths || paths.length === 0) return []

    // Completely bypass Supabase to prevent Egress.
    // We assume all new paths are Cloudinary URLs (starting with http).
    // Old Supabase paths will be returned as-is (which may break them in the UI,
    // but this guarantees zero Supabase storage usage).
    return paths.map((path) => ({
      path: path,
      signedUrl: path.startsWith("http")
        ? path
        : "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", // Transparent pixel for old supabase images
    }))
  },

  async deleteAttachment(path) {
    if (!path) return

    // Completely bypass Supabase to prevent Egress.
    // We do not delete from Cloudinary client-side for security reasons without signatures.
    return true
  },

  /**
   * Upload a profile image (avatar/banner) for an employee to Cloudinary.
   */
  async uploadProfileImage(userId, kind, file) {
    if (!userId || !kind || !file)
      throw new Error("Missing required upload fields.")
    if (!["avatar", "banner"].includes(kind))
      throw new Error("Invalid upload kind.")

    // Redirect profile media to Cloudinary to save Supabase Egress
    return this.uploadToCloudinary(file)
  },

  async getSignedUrl(path, expiresIn = 3600) {
    if (!path) return null

    // Completely bypass Supabase to prevent Egress.
    if (path.startsWith("http")) {
      return path
    }

    // Old Supabase images will return a transparent pixel to prevent Egress
    return "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
  },

  /**
   * Upload an image directly to Cloudinary using an unsigned preset.
   */
  async uploadToCloudinary(file) {
    if (!file) throw new Error("No file provided.")

    // Compress client side first to save time and bandwidth
    const options = {
      maxSizeMB: 1, // 1 MB limit
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    }

    let fileToUpload = file
    try {
      if (file.type?.startsWith("image/")) {
        fileToUpload = await imageCompression(file, options)
      }
    } catch (error) {
      console.warn("Compression failed, uploading original.", error)
    }

    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

    if (!cloudName || !uploadPreset) {
      throw new Error("Missing Cloudinary configuration in .env")
    }

    const formData = new FormData()
    formData.append("file", fileToUpload)
    formData.append("upload_preset", uploadPreset)

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      {
        method: "POST",
        body: formData,
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData?.error?.message || "Cloudinary upload failed")
    }

    const data = await response.json()
    return data.secure_url
  },

  /**
   * Upload any file — image or document — to Cloudinary, returning the
   * descriptor shape stored in log metadata.
   *
   * Images reuse uploadToCloudinary() so they still get compressed; everything
   * else goes to /auto/upload, which the same unsigned preset serves. Cloudinary
   * mangles the public id of raw uploads, so the original filename is carried in
   * the descriptor rather than parsed back out of the URL.
   */
  async uploadFileToCloudinary(file) {
    if (!file) throw new Error("No file provided.")

    if (file.type?.startsWith("image/")) {
      const url = await this.uploadToCloudinary(file)
      return { url, name: file.name, type: file.type, bytes: file.size }
    }

    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

    if (!cloudName || !uploadPreset) {
      throw new Error("Missing Cloudinary configuration in .env")
    }

    const formData = new FormData()
    formData.append("file", file)
    formData.append("upload_preset", uploadPreset)

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      {
        method: "POST",
        body: formData,
      },
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(errorData?.error?.message || "Cloudinary upload failed")
    }

    const data = await response.json()
    return {
      url: data.secure_url,
      name: file.name,
      type: file.type || "",
      bytes: data.bytes ?? file.size,
    }
  },
}

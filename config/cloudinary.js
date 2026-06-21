import './loadEnv.js';
import { v2 as cloudinary } from 'cloudinary';

let configured = false;

export function configureCloudinary() {
  if (configured) return cloudinary;

  if (process.env.CLOUDINARY_URL) {
    cloudinary.config();
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  configured = true;
  return cloudinary;
}

export default cloudinary;

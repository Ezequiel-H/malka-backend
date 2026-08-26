import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import cloudinary, { configureCloudinary } from '../config/cloudinary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Sin credenciales de Cloudinary (entorno local), los comprobantes se
   guardan en uploads/ —que ya se sirve estático— en vez de reventar el
   flujo de inscripción con "Must supply api_key". En producción, con las
   credenciales presentes, este camino no se toca. */
const hasCloudinary = () =>
  Boolean(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_API_KEY);

let warnedLocal = false;
const uploadToLocalDisk = (buffer, originalName, mimetype) => {
  if (!warnedLocal) {
    console.warn('⚠️  Cloudinary sin configurar: guardando comprobantes en uploads/ (solo dev)');
    warnedLocal = true;
  }
  const dir = path.join(__dirname, '..', 'uploads', 'comprobantes');
  fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(originalName || '') || (mimetype === 'application/pdf' ? '.pdf' : '.png');
  const name = `${randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);

  const base = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5001}`;
  return {
    url: `${base}/uploads/comprobantes/${name}`,
    publicId: `local/${name}`,
    formato: mimetype,
    originalName: originalName || 'comprobante',
  };
};

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

const storage = multer.memoryStorage();

export const uploadComprobante = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPEG, PNG, WebP, GIF) o PDF'));
    }
  },
});

export const uploadToCloudinary = (buffer, originalName, mimetype) => {
  if (!hasCloudinary()) {
    return Promise.resolve(uploadToLocalDisk(buffer, originalName, mimetype));
  }

  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'malka/comprobantes',
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          formato: result.format || mimetype,
          originalName: originalName || 'comprobante',
        });
      }
    );
    stream.end(buffer);
  });
};

export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'El archivo no puede superar 5MB' });
    }
    return res.status(400).json({ message: err.message });
  }
  if (err) {
    return res.status(400).json({ message: err.message });
  }
  next();
};

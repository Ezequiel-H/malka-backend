import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { generateToken } from '../../utils/generateToken.js';

describe('generateToken', () => {
  it('encodes userId verifiable with JWT_SECRET', () => {
    const id = new mongoose.Types.ObjectId();
    const token = generateToken(id);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(String(id));
  });
});

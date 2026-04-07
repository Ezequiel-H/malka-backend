import { describe, it, expect, vi } from 'vitest';
import { requireAdmin, requireApproved } from '../../middleware/auth.middleware.js';

describe('requireAdmin', () => {
  it('responds 403 when user is not admin', () => {
    const req = { user: { role: 'participant' } };
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json };
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when user is admin', () => {
    const req = { user: { role: 'admin' } };
    const res = { status: vi.fn(), json: vi.fn() };
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('requireApproved', () => {
  it('responds 403 when estado is not approved', () => {
    const req = { user: { estado: 'pending' } };
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json };
    const next = vi.fn();

    requireApproved(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when approved', () => {
    const req = { user: { estado: 'approved' } };
    const res = { status: vi.fn(), json: vi.fn() };
    const next = vi.fn();

    requireApproved(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
